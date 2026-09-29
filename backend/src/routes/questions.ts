import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import {
    authenticate,
    requireFreshAccessToken,
    blockUntilPasswordChanged,
    type AuthRequest,
} from '../middleware/authMiddleware.js';
import { userRateLimit } from '../middleware/rateLimit.js';
import {
    QUESTION_AGENT_GLOBAL_ROUNDS_PER_5H,
    QUESTION_AGENT_ROUNDS_PER_HOUR,
    QUESTION_AGENT_TIMEOUT_MS,
    QUESTION_AGENT_TOKEN,
    QUESTION_AGENT_URL,
} from '../config.js';
import { getQuestionContext, saveQuestionSession } from '../repositories/diagnosisRepository.js';
import { chargeQuestionRound, refundQuestionRound, type RoundLimits } from '../repositories/questionRoundRepository.js';
import {
    HPO_ID_RE,
    MAX_NOTE_LENGTH,
    QUESTIONS_PER_ROUND,
    QuestionAgentHttpError,
    QuestionAgentInvalidResponseError,
    QuestionAgentTimeoutError,
    QuestionAgentUnavailableError,
    answerValueSchema,
    createQuestionAgentClient,
    modeSchema,
} from '../services/questionAgentClient.js';
import {
    CorruptSessionError,
    deriveEvidence,
    latestResponse,
    parseStoredSession,
    planRound,
    toBrowserRound,
    toBrowserSession,
    type RejectReason,
} from '../services/questionSession.js';
import { createKeyedLock } from '../utils/keyedLock.js';
import { stripNullBytes } from '../utils/sanitize.js';

/**
 * Follow-up questions that refine a saved gene ranking.
 *
 * The browser never reaches the question agent: every round costs LLM calls, so
 * it goes through here, where it is authenticated, capped per account and for
 * the whole deployment, tied to a diagnosis the caller owns, and persisted with
 * that diagnosis. The agent's own errors and bodies never pass through; the
 * browser gets one of the coded failures below.
 */
const router = Router();

const agent = QUESTION_AGENT_URL
    ? createQuestionAgentClient({
          baseUrl: QUESTION_AGENT_URL,
          token: QUESTION_AGENT_TOKEN,
          timeoutMs: QUESTION_AGENT_TIMEOUT_MS,
      })
    : null;

/**
 * Every error body is `{ error, code }`: `error` is for the reader, `code` is
 * what the browser branches on, so the wording can change without breaking it.
 */
const FAILURES = {
    invalid_request: { status: 400, error: 'La solicitud no es válida.' },
    answers_mismatch: { status: 400, error: 'Las respuestas no corresponden a las preguntas pendientes.' },
    no_usable_symptoms: { status: 400, error: 'No pudimos usar los síntomas de esta búsqueda para hacer preguntas.' },
    not_found: { status: 404, error: 'Diagnóstico no encontrado.' },
    finished: { status: 409, error: 'Las preguntas de este diagnóstico ya terminaron.' },
    conflict: {
        status: 409,
        error: 'Las preguntas de esta búsqueda cambiaron en otra pestaña. Recargá la página para continuar.',
    },
    unreadable_session: { status: 409, error: 'No pudimos recuperar las preguntas de esta búsqueda.' },
    rate_limited: { status: 429, error: 'Hiciste muchas consultas seguidas. Esperá un rato y volvé a intentar.' },
    global_limit: {
        status: 429,
        error: 'diagnostic.ar llegó al máximo de preguntas por ahora. Tu resultado no cambió; podés volver a intentarlo más tarde.',
    },
    round_in_flight: { status: 429, error: 'Ya hay una ronda de preguntas en curso. Esperá a que termine.' },
    internal: { status: 500, error: 'No pudimos procesar las preguntas.' },
    disabled: { status: 503, error: 'Las preguntas de seguimiento no están disponibles en este momento.' },
    unavailable: { status: 503, error: 'El servicio de preguntas no está disponible. Probá de nuevo en unos minutos.' },
    timeout: { status: 504, error: 'El servicio de preguntas tardó demasiado en responder. Probá de nuevo.' },
} as const;

type QuestionErrorCode = keyof typeof FAILURES;

function fail(res: Response, code: QuestionErrorCode) {
    const { status, error } = FAILURES[code];
    return res.status(status).json({ error, code });
}

const REJECTIONS: Record<RejectReason, QuestionErrorCode> = {
    answers_mismatch: 'answers_mismatch',
    no_evidence: 'no_usable_symptoms',
    finished: 'finished',
};

const auth = [authenticate, requireFreshAccessToken, blockUntilPasswordChanged] as const;
const limited = { message: FAILURES.rate_limited.error, code: 'rate_limited' } as const;
const readLimit = userRateLimit({ windowMs: 60_000, max: 120, ...limited });
// Placed after authentication so it keys on the account itself rather than on
// a token, which a refresh would replace with a fresh budget.
const postLimit = userRateLimit({ windowMs: 60_000, max: 60, ...limited });
// The round caps count only rounds that reach the agent: a replay, a rejected
// request or an agent that was too busy to start spends no LLM quota.
const roundLimits: RoundLimits = {
    perAccountPerHour: QUESTION_AGENT_ROUNDS_PER_HOUR,
    globalPer5h: QUESTION_AGENT_GLOBAL_ROUNDS_PER_5H,
};
// A round holds an LLM call for up to a minute and a half; a double click or a
// second tab must not start another one for the same account in parallel.
// In-process only; across processes the compare-and-set save is what holds.
const inFlight = createKeyedLock();
const BUSY_RETRY_AFTER_SECONDS = 10;
const MAX_RETRY_AFTER_SECONDS = 60;

const uuidSchema = z.string().uuid();

router.param('diagnosisId', (req: Request, res: Response, next: NextFunction, value: string) => {
    if (!uuidSchema.safeParse(value).success) {
        return fail(res, 'not_found');
    }
    return next();
});

const noteSchema = z
    .string()
    .transform((value) => stripNullBytes(value).trim())
    .pipe(z.string().max(MAX_NOTE_LENGTH));

const roundBodySchema = z.object({
    diagnosisId: z.string(),
    mode: modeSchema,
    answers: z
        .array(
            z.object({
                hpoId: z.string().regex(HPO_ID_RE),
                answer: answerValueSchema,
                note: noteSchema.nullish(),
            }),
        )
        .max(QUESTIONS_PER_ROUND)
        .default([]),
    finish: z.boolean().default(false),
});

router.get('/status', readLimit, ...auth, (_req, res) => {
    res.json({ enabled: agent !== null });
});

router.post('/rounds', ...auth, postLimit, async (req: AuthRequest, res: Response) => {
    if (!agent) {
        return fail(res, 'disabled');
    }

    const parsed = roundBodySchema.safeParse(req.body);
    if (!parsed.success) {
        return fail(res, 'invalid_request');
    }
    const { diagnosisId, mode, answers, finish } = parsed.data;
    if (!uuidSchema.safeParse(diagnosisId).success) {
        return fail(res, 'not_found');
    }

    const userId = req.userRecord!.id;
    const release = inFlight.tryAcquire(userId);
    if (!release) {
        res.setHeader('Retry-After', String(BUSY_RETRY_AFTER_SECONDS));
        return fail(res, 'round_in_flight');
    }

    let roundId: string | null = null;
    try {
        const diagnosis = await getQuestionContext(diagnosisId, userId);
        if (!diagnosis) {
            return fail(res, 'not_found');
        }

        const session = parseStoredSession(diagnosis.preguntas_respuestas);
        const plan = planRound(session, deriveEvidence(diagnosis), { mode, answers, finish });

        if (plan.action === 'reject') {
            return fail(res, REJECTIONS[plan.reason]);
        }
        if (plan.action === 'replay') {
            return res.json(toBrowserRound(plan.response));
        }

        const charge = await chargeQuestionRound(userId, roundLimits);
        if (charge.status !== 'charged') {
            res.setHeader('Retry-After', String(charge.retryAfterSeconds));
            return fail(res, charge.status === 'global_limit' ? 'global_limit' : 'rate_limited');
        }
        roundId = charge.roundId;

        const response = await agent.requestRound(plan.request);
        const next = stripNullBytes(plan.apply(response));
        const outcome = await saveQuestionSession(diagnosisId, userId, next, diagnosis.preguntas_respuestas);
        if (outcome === 'missing') {
            // Deleted while the agent was thinking.
            return fail(res, 'not_found');
        }
        if (outcome === 'conflict') {
            console.error('[questions] session changed during the round; not saved');
            return fail(res, 'conflict');
        }
        return res.json(toBrowserRound(latestResponse(next)));
    } catch (error) {
        if (roundId !== null && spentNothing(error)) {
            await refundQuestionRound(roundId).catch((refundError: unknown) => {
                console.error('[questions] refund failed:', refundError instanceof Error ? refundError.message : 'unknown error');
            });
        }
        return sendFailure(res, error);
    } finally {
        release();
    }
});

router.get('/:diagnosisId', readLimit, ...auth, async (req: AuthRequest, res: Response) => {
    try {
        const diagnosis = await getQuestionContext(req.params.diagnosisId, req.userRecord!.id);
        if (!diagnosis) {
            return fail(res, 'not_found');
        }
        const session = parseStoredSession(diagnosis.preguntas_respuestas);
        return res.json({ session: session ? toBrowserSession(session) : null });
    } catch (error) {
        return sendFailure(res, error);
    }
});

/** The agent refused before doing any work, so the round costs the account nothing. */
function spentNothing(error: unknown): boolean {
    return (
        error instanceof QuestionAgentHttpError &&
        (error.code === 'busy' || (error.status === 422 && error.code === 'no-known-hpo-ids'))
    );
}

function sendFailure(res: Response, error: unknown) {
    // Logged by class and message only: the client's messages carry at most the
    // upstream status and error code, and nothing here logs answers or notes.
    const label = error instanceof Error ? `${error.name}: ${error.message}` : 'unknown error';
    console.error('[questions]', label);

    if (error instanceof CorruptSessionError) {
        return fail(res, 'unreadable_session');
    }
    if (error instanceof QuestionAgentTimeoutError) {
        return fail(res, 'timeout');
    }
    if (error instanceof QuestionAgentHttpError) {
        if (error.status === 422 && error.code === 'no-known-hpo-ids') {
            return fail(res, 'no_usable_symptoms');
        }
        if (error.status === 503 && error.retryAfterSeconds !== null) {
            res.setHeader('Retry-After', String(Math.min(error.retryAfterSeconds, MAX_RETRY_AFTER_SECONDS)));
        }
        return fail(res, 'unavailable');
    }
    // An answer that breaks the contract is reported as the agent being
    // unavailable: to the reader the outcome is the same, and it keeps the
    // browser-facing error set closed.
    if (error instanceof QuestionAgentUnavailableError || error instanceof QuestionAgentInvalidResponseError) {
        return fail(res, 'unavailable');
    }
    return fail(res, 'internal');
}

export default router;
