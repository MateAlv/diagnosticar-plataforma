import { z } from 'zod';

/**
 * Client for the question agent's `POST /v1/rounds`.
 *
 * The agent's contract is `src/diagnosticar_preguntas/api/schemas.py` in
 * MarBL00126/diagnosticar-question-agent. Its responses are validated here
 * before anything is stored or shown, because they are LLM-assisted output and
 * end up in a clinical record.
 *
 * Callers only ever see the typed errors below. Their messages are for the log;
 * the upstream body is never included, so it cannot reach a browser. Of an
 * error body only the short `error` code is kept, and only when it looks like
 * one.
 */

export const MAX_ROUNDS = 3;
export const QUESTIONS_PER_ROUND = 3;
export const MAX_NOTE_LENGTH = 280;
export const MAX_GENES_PER_ANSWER = 5;
export const HPO_ID_RE = /^HP:\d{7}$/;

const MAX_RESPONSE_BYTES = 1_000_000;
const MAX_ERROR_BYTES = 4_096;
const ERROR_CODE_RE = /^[a-z][a-z0-9-]{0,63}$/;

export const modeSchema = z.enum(['paciente', 'medico']);
export const answerValueSchema = z.enum(['si', 'no', 'no_se']);
const hpoIdSchema = z.string().regex(HPO_ID_RE);

export type Mode = z.infer<typeof modeSchema>;
export type AnswerValue = z.infer<typeof answerValueSchema>;

/** Absent and null both arrive as null, so stored and fresh responses share one type. */
export function nullable<T extends z.ZodTypeAny>(schema: T) {
    return schema.nullish().transform((value): z.output<T> | null => value ?? null);
}

/** How the agent read an answer in an earlier round, echoed so it reads each note once. */
export type UpstreamReading = { effective_answer: AnswerValue; note_summary: string | null };

export type UpstreamAnswer = {
    hpo_id: string;
    answer: AnswerValue;
    note: string | null;
    reading: UpstreamReading | null;
};

export type UpstreamRoundRequest = {
    mode: Mode;
    round: number;
    present_hpo_ids: string[];
    absent_hpo_ids: string[];
    sex?: 'male' | 'female';
    age_years?: number;
    onset_years?: number;
    answers: UpstreamAnswer[];
    finish: boolean;
};

const geneListSchema = nullable(z.array(z.string().min(1).max(64)).max(MAX_GENES_PER_ANSWER));

const questionSchema = z.object({
    id: z.string().min(1).max(200),
    hpo_id: hpoIdSchema,
    label: z.string().min(1).max(500),
    text: z.string().min(1).max(2_000),
    help: nullable(z.string().max(2_000)),
    genes_if_yes: geneListSchema,
    genes_if_no: geneListSchema,
    rationale: nullable(z.string().max(4_000)),
});

const rankedGeneSchema = z.object({
    gene_id: z.string().min(1).max(64),
    gene_symbol: z.string().min(1).max(64),
    score: z.number().finite(),
    model_score: z.number().finite(),
    model_rank: z.number().int(),
});

const interpretedAnswerSchema = z.object({
    hpo_id: hpoIdSchema,
    answer: answerValueSchema,
    effective_answer: answerValueSchema,
    note_summary: nullable(z.string().max(1_000)),
});

export const roundResponseSchema = z
    .object({
        round: z.number().int().min(1).max(MAX_ROUNDS + 1),
        mode: modeSchema,
        status: z.enum(['questions', 'finished']),
        finish_reason: nullable(z.enum(['max_rounds', 'user_finished', 'confident', 'no_useful_questions'])),
        questions: z.array(questionSchema).max(QUESTIONS_PER_ROUND).default([]),
        ranking: z.array(rankedGeneSchema).max(500),
        specialties: nullable(z.record(z.string(), z.unknown())),
        confidence: nullable(z.number().finite()),
        interpreted_answers: z
            .array(interpretedAnswerSchema)
            .max(MAX_ROUNDS * QUESTIONS_PER_ROUND)
            .default([]),
        summary: nullable(z.string().max(4_000)),
        warnings: z.array(z.string().max(1_000)).max(20).default([]),
        versions: z.object({
            agent: z.string().max(100),
            knowledge_base: z.string().max(100),
            llm_model: z.string().max(100).nullable(),
        }),
    })
    .superRefine((response, ctx) => {
        // The session logic relies on these: a round that asks nothing cannot be
        // answered, and a finished round with questions could never be closed.
        if (response.status === 'questions') {
            if (response.questions.length === 0) {
                ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'questions status without questions' });
            }
            if (response.round > MAX_ROUNDS) {
                ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'questions past the last round' });
            }
        } else if (response.questions.length > 0) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'finished status with questions' });
        }
        const ids = response.questions.map((q) => q.hpo_id);
        if (new Set(ids).size !== ids.length) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'duplicate question hpo_id' });
        }
    });

export type UpstreamRoundResponse = z.infer<typeof roundResponseSchema>;

export class QuestionAgentError extends Error {
    constructor(message: string) {
        super(message);
        this.name = new.target.name;
    }
}

/** The agent could not be reached or refused the call. */
export class QuestionAgentUnavailableError extends QuestionAgentError {}

/**
 * The agent answered with an HTTP error. `code` is its short `error` field
 * (`busy`, `no-known-hpo-ids`, ...), or null when the body had none.
 */
export class QuestionAgentHttpError extends QuestionAgentUnavailableError {
    constructor(
        readonly status: number,
        readonly code: string | null,
        readonly retryAfterSeconds: number | null,
    ) {
        super(`upstream answered HTTP ${status}${code ? ` (${code})` : ''}`);
    }
}

/** No complete answer within the configured timeout. */
export class QuestionAgentTimeoutError extends QuestionAgentError {}

/** The agent answered 200 with something that does not honour the contract. */
export class QuestionAgentInvalidResponseError extends QuestionAgentError {}

export type QuestionAgentClient = {
    requestRound(request: UpstreamRoundRequest): Promise<UpstreamRoundResponse>;
};

export type QuestionAgentClientOptions = {
    baseUrl: string;
    token?: string;
    timeoutMs: number;
};

function isTimeout(error: unknown): boolean {
    return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
}

/**
 * The body as text, or null when it is larger than `maxBytes`. Checked against
 * Content-Length first and again while streaming, so an oversized answer is
 * dropped without being buffered.
 */
async function readCapped(response: globalThis.Response, maxBytes: number): Promise<string | null> {
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) {
        await response.body?.cancel().catch(() => undefined);
        return null;
    }
    if (!response.body) return '';

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) {
            await reader.cancel().catch(() => undefined);
            return null;
        }
        chunks.push(value);
    }
    return Buffer.concat(chunks).toString('utf8');
}

function errorCode(body: string | null): string | null {
    if (!body) return null;
    try {
        const code = (JSON.parse(body) as { error?: unknown } | null)?.error;
        return typeof code === 'string' && ERROR_CODE_RE.test(code) ? code : null;
    } catch {
        return null;
    }
}

function retryAfterSeconds(header: string | null): number | null {
    if (!header || !/^\d{1,6}$/.test(header.trim())) return null;
    return Number(header.trim());
}

export function createQuestionAgentClient(options: QuestionAgentClientOptions): QuestionAgentClient {
    const endpoint = `${options.baseUrl.replace(/\/+$/, '')}/v1/rounds`;

    return {
        async requestRound(request) {
            const headers: Record<string, string> = {
                'Content-Type': 'application/json',
                Accept: 'application/json',
            };
            if (options.token) {
                headers['X-Internal-Token'] = options.token;
            }

            let status: number;
            let retryAfter: string | null;
            let text: string | null;
            try {
                // One signal covers the body as well as the headers, so a slow
                // trickle of bytes cannot outlast the timeout.
                const response = await fetch(endpoint, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify(request),
                    signal: AbortSignal.timeout(options.timeoutMs),
                    redirect: 'error',
                });
                status = response.status;
                retryAfter = response.headers.get('retry-after');
                const ok = status >= 200 && status < 300;
                text = await readCapped(response, ok ? MAX_RESPONSE_BYTES : MAX_ERROR_BYTES);
            } catch (error) {
                if (isTimeout(error)) {
                    throw new QuestionAgentTimeoutError(`no answer within ${options.timeoutMs} ms`);
                }
                const cause = error instanceof Error ? error.message : 'unknown error';
                throw new QuestionAgentUnavailableError(`request failed: ${cause}`);
            }

            if (status < 200 || status >= 300) {
                throw new QuestionAgentHttpError(status, errorCode(text), retryAfterSeconds(retryAfter));
            }
            if (text === null) {
                throw new QuestionAgentInvalidResponseError('response body too large');
            }

            let json: unknown;
            try {
                json = JSON.parse(text);
            } catch {
                throw new QuestionAgentInvalidResponseError('response is not JSON');
            }

            const parsed = roundResponseSchema.safeParse(json);
            if (!parsed.success) {
                const paths = parsed.error.issues
                    .map((issue) => issue.path.join('.') || issue.message)
                    .slice(0, 5)
                    .join(', ');
                throw new QuestionAgentInvalidResponseError(`response breaks the contract at: ${paths}`);
            }
            if (parsed.data.round !== request.round) {
                throw new QuestionAgentInvalidResponseError(
                    `asked for round ${request.round}, got round ${parsed.data.round}`,
                );
            }
            if (parsed.data.mode !== request.mode) {
                throw new QuestionAgentInvalidResponseError(
                    `asked for ${request.mode} mode, got ${parsed.data.mode}`,
                );
            }
            return parsed.data;
        },
    };
}
