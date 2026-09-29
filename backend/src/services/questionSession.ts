import { z } from 'zod';
import {
    HPO_ID_RE,
    MAX_NOTE_LENGTH,
    answerValueSchema,
    modeSchema,
    nullable,
    type AnswerValue,
    type Mode,
    type UpstreamReading,
    type UpstreamRoundRequest,
    type UpstreamRoundResponse,
} from './questionAgentClient.js';

/**
 * The follow-up question session of one diagnosis, stored in
 * `diagnoses.preguntas_respuestas`.
 *
 * The agent is stateless: every call carries all the evidence so far. This
 * module is therefore where a session lives — which round is pending, which
 * answers it accepts, what the next call must contain — and it is pure, so all
 * of that is testable without a database or a network.
 */

const MAX_HPO_IDS = 100;
export const SESSION_VERSION = 2;

// --- What is stored ---------------------------------------------------------
//
// Deliberately more lenient than the agent's contract in questionAgentClient:
// a session outlives the agent version that wrote it, so fields added since are
// defaulted, fields dropped since are ignored, and bounds are not re-checked.
// Only what the session logic itself needs is required.

const storedAnswerSchema = z.object({
    hpoId: z.string().regex(HPO_ID_RE),
    answer: answerValueSchema,
    note: nullable(z.string().max(MAX_NOTE_LENGTH)),
});

const storedQuestionSchema = z
    .object({ id: z.string(), hpoId: z.string(), label: z.string().nullish(), text: z.string() })
    .transform(({ label, ...q }) => ({ ...q, label: label || q.text }));

const storedResponseSchema = z.object({
    round: z.number().int().min(1),
    mode: modeSchema.optional(),
    status: z.enum(['questions', 'finished']),
    finish_reason: nullable(z.string()),
    questions: z
        .array(
            z
                .object({
                    id: z.string(),
                    hpo_id: z.string(),
                    label: z.string().nullish(),
                    text: z.string(),
                    help: nullable(z.string()),
                    genes_if_yes: nullable(z.array(z.string())),
                    genes_if_no: nullable(z.array(z.string())),
                    rationale: nullable(z.string()),
                })
                .transform(({ label, ...q }) => ({ ...q, label: label || q.text })),
        )
        .default([]),
    ranking: z.array(
        z.object({
            gene_id: z.string(),
            gene_symbol: z.string(),
            score: z.number(),
            model_score: z.number(),
            model_rank: z.number(),
        }),
    ),
    specialties: nullable(z.record(z.string(), z.unknown())),
    confidence: nullable(z.number()),
    interpreted_answers: z
        .array(
            z.object({
                hpo_id: z.string(),
                answer: answerValueSchema,
                effective_answer: answerValueSchema,
                note_summary: nullable(z.string()),
            }),
        )
        .default([]),
    summary: nullable(z.string()),
    warnings: z.array(z.string()).default([]),
    versions: nullable(
        z.object({ agent: z.string(), knowledge_base: z.string(), llm_model: z.string().nullable() }),
    ),
});

const storedRoundFields = {
    round: z.number().int().min(1),
    questions: z.array(storedQuestionSchema),
    answers: z.array(storedAnswerSchema),
    response: storedResponseSchema,
};

// Version 1 kept one mode for the whole session.
const storedSessionV1Schema = z.object({
    version: z.literal(1),
    mode: modeSchema,
    finished: z.boolean(),
    rounds: z.array(z.object(storedRoundFields)).min(1),
});

const storedSessionV2Schema = z.object({
    version: z.literal(2),
    finished: z.boolean(),
    rounds: z.array(z.object({ ...storedRoundFields, mode: modeSchema })).min(1),
});

export type StoredAnswer = z.infer<typeof storedAnswerSchema>;
export type StoredQuestion = z.infer<typeof storedQuestionSchema>;
export type RoundResponse = Omit<z.infer<typeof storedResponseSchema>, 'mode'> & { mode: Mode };
export type StoredRound = {
    round: number;
    /** The mode this round's texts were written in. */
    mode: Mode;
    questions: StoredQuestion[];
    answers: StoredAnswer[];
    response: RoundResponse;
};
export type StoredSession = { version: typeof SESSION_VERSION; finished: boolean; rounds: StoredRound[] };

export class CorruptSessionError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'CorruptSessionError';
    }
}

/** Reads any stored version into the current shape; null when there is no session. */
export function parseStoredSession(raw: unknown): StoredSession | null {
    if (raw === null || raw === undefined) return null;

    const version = (raw as { version?: unknown }).version;
    let rounds: StoredRound[];
    let finished: boolean;
    if (version === 1) {
        const parsed = storedSessionV1Schema.safeParse(raw);
        if (!parsed.success) throw new CorruptSessionError('stored question session does not match version 1');
        finished = parsed.data.finished;
        rounds = parsed.data.rounds.map((r) => withMode(r, parsed.data.mode));
    } else if (version === 2) {
        const parsed = storedSessionV2Schema.safeParse(raw);
        if (!parsed.success) throw new CorruptSessionError('stored question session does not match version 2');
        finished = parsed.data.finished;
        rounds = parsed.data.rounds.map((r) => withMode(r, r.mode));
    } else {
        throw new CorruptSessionError('stored question session has an unknown version');
    }
    return { version: SESSION_VERSION, finished, rounds };
}

function withMode(
    round: Omit<StoredRound, 'mode' | 'response'> & { response: z.infer<typeof storedResponseSchema> },
    mode: Mode,
): StoredRound {
    return {
        round: round.round,
        mode,
        questions: round.questions,
        answers: round.answers,
        response: { ...round.response, mode: round.response.mode ?? mode },
    };
}

// --- Evidence -----------------------------------------------------------------

export type Evidence = { present: string[]; absent: string[] };

function normaliseHpoId(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const id = value.trim().toUpperCase();
    return HPO_ID_RE.test(id) ? id : null;
}

/**
 * What the model was told about the patient, rebuilt from the saved diagnosis.
 *
 * `symptoms_extracted` is the confirmed list the wizard sent to /rank-genes —
 * extracted terms the reader kept plus the ones added by hand — so it is the
 * present set. `phenotypes` is the raw extractor output; its negated entries
 * are the absent set, minus any the reader moved back to present, which is the
 * same rule the results screen uses to list them. The agent refuses a request
 * where the two overlap, so they never do.
 */
export function deriveEvidence(diagnosis: { symptoms_extracted: unknown; phenotypes: unknown }): Evidence {
    const present = new Set<string>();
    for (const symptom of Array.isArray(diagnosis.symptoms_extracted) ? diagnosis.symptoms_extracted : []) {
        const id = normaliseHpoId((symptom as { code?: unknown } | null)?.code);
        if (id) present.add(id);
    }

    const absent = new Set<string>();
    for (const phenotype of Array.isArray(diagnosis.phenotypes) ? diagnosis.phenotypes : []) {
        const item = phenotype as { hpo_id?: unknown; negated?: unknown } | null;
        if (item?.negated !== true) continue;
        const id = normaliseHpoId(item.hpo_id);
        if (id && !present.has(id)) absent.add(id);
    }

    return {
        present: [...present].slice(0, MAX_HPO_IDS),
        absent: [...absent].slice(0, MAX_HPO_IDS),
    };
}

// --- Rounds -------------------------------------------------------------------

/** The round whose questions are waiting for answers, if any. */
export function pendingRound(session: StoredSession): StoredRound | null {
    if (session.finished) return null;
    const last = session.rounds[session.rounds.length - 1];
    return last.questions.length > 0 && last.answers.length === 0 ? last : null;
}

export function latestResponse(session: StoredSession): RoundResponse {
    return session.rounds[session.rounds.length - 1].response;
}

export type AnswerInput = { hpoId: string; answer: AnswerValue; note?: string | null };
export type RoundInput = { mode: Mode; answers: AnswerInput[]; finish: boolean };

export type RejectReason = 'finished' | 'no_evidence' | 'answers_mismatch';

export type RoundPlan =
    | { action: 'reject'; reason: RejectReason }
    | { action: 'replay'; response: RoundResponse }
    | {
          action: 'call';
          request: UpstreamRoundRequest;
          apply: (response: UpstreamRoundResponse) => StoredSession;
      };

function normaliseAnswer(input: AnswerInput): StoredAnswer {
    const note = input.note?.trim();
    return { hpoId: input.hpoId, answer: input.answer, note: note ? note : null };
}

function answersMatch(pending: StoredRound, answers: StoredAnswer[]): boolean {
    const asked = new Set(pending.questions.map((q) => q.hpoId));
    const given = new Set(answers.map((a) => a.hpoId));
    if (given.size !== answers.length || given.size !== asked.size) return false;
    return [...given].every((id) => asked.has(id));
}

function sameAnswers(stored: StoredAnswer[], given: StoredAnswer[]): boolean {
    if (stored.length !== given.length) return false;
    const byId = new Map(stored.map((a) => [a.hpoId, a]));
    return given.every((a) => {
        const match = byId.get(a.hpoId);
        return match !== undefined && match.answer === a.answer && match.note === a.note;
    });
}

/**
 * Whether this POST repeats one the session already moved past — the browser
 * lost the response and sent the same thing again. Answers must equal those of
 * the last answered round and a later round must exist; a repeated `finish`
 * matches a finished session.
 */
function isResend(session: StoredSession, answers: StoredAnswer[], finish: boolean): boolean {
    if (finish && !session.finished) return false;
    if (answers.length === 0) return finish;
    let last = -1;
    session.rounds.forEach((r, i) => {
        if (r.answers.length > 0) last = i;
    });
    return last >= 0 && last < session.rounds.length - 1 && sameAnswers(session.rounds[last].answers, answers);
}

/**
 * The first reading the agent gave of each answer. Sent back with the answer
 * on every later round, so a note is interpreted once and not re-read with a
 * different outcome each time.
 */
function readings(session: StoredSession): Map<string, { answer: AnswerValue; reading: UpstreamReading }> {
    const found = new Map<string, { answer: AnswerValue; reading: UpstreamReading }>();
    for (const round of session.rounds) {
        for (const item of round.response.interpreted_answers) {
            if (found.has(item.hpo_id)) continue;
            found.set(item.hpo_id, {
                answer: item.answer,
                reading: { effective_answer: item.effective_answer, note_summary: item.note_summary },
            });
        }
    }
    return found;
}

function toStoredRound(response: UpstreamRoundResponse): StoredRound {
    return {
        round: response.round,
        mode: response.mode,
        questions: response.questions.map((q) => ({ id: q.id, hpoId: q.hpo_id, label: q.label, text: q.text })),
        answers: [],
        response,
    };
}

/**
 * Decides what one POST does to a session.
 *
 * - No session yet: start round 1.
 * - A pending round and no answers: return it again without calling the agent,
 *   so a reload or a retried request costs nothing.
 * - The same answers (or `finish`) as a request the session already moved past:
 *   return the latest round, for a browser that lost the first response.
 * - Answers: they must cover exactly the pending round's questions ("no_se" is
 *   how one question is skipped). The agent then gets every answer so far,
 *   each earlier one with the reading the agent already gave it.
 * - `finish`: close the session now, with or without answers. Without answers
 *   the closing round takes the pending round's place.
 *
 * Every call uses the mode of this request, so the wording can change between
 * rounds; each stored round remembers the mode it was written in.
 */
export function planRound(session: StoredSession | null, evidence: Evidence, input: RoundInput): RoundPlan {
    const newAnswers = input.answers.map(normaliseAnswer);
    const answering = newAnswers.length > 0;

    if (session && isResend(session, newAnswers, input.finish)) {
        return { action: 'replay', response: latestResponse(session) };
    }
    if (session?.finished) return { action: 'reject', reason: 'finished' };

    const pending = session ? pendingRound(session) : null;
    if (answering && (!pending || !answersMatch(pending, newAnswers))) {
        return { action: 'reject', reason: 'answers_mismatch' };
    }
    if (session && !answering && !input.finish) {
        return { action: 'replay', response: latestResponse(session) };
    }
    if (evidence.present.length === 0) return { action: 'reject', reason: 'no_evidence' };

    const known = session ? readings(session) : new Map<string, { answer: AnswerValue; reading: UpstreamReading }>();
    const previous = session ? session.rounds.flatMap((r) => r.answers) : [];
    const answeredRounds = (session ? session.rounds.filter((r) => r.answers.length > 0).length : 0)
        + (answering ? 1 : 0);

    const request: UpstreamRoundRequest = {
        mode: input.mode,
        round: answeredRounds + 1,
        present_hpo_ids: evidence.present,
        absent_hpo_ids: evidence.absent,
        answers: [
            ...previous.map((a) => {
                const read = known.get(a.hpoId);
                return {
                    hpo_id: a.hpoId,
                    answer: a.answer,
                    note: a.note,
                    reading: read && read.answer === a.answer ? read.reading : null,
                };
            }),
            ...newAnswers.map((a) => ({ hpo_id: a.hpoId, answer: a.answer, note: a.note, reading: null })),
        ],
        finish: input.finish,
    };

    const apply = (response: UpstreamRoundResponse): StoredSession => {
        const rounds = session ? [...session.rounds] : [];
        const entry = toStoredRound(response);
        if (pending && !answering) {
            rounds[rounds.length - 1] = entry;
        } else {
            if (pending) rounds[rounds.length - 1] = { ...pending, answers: newAnswers };
            rounds.push(entry);
        }
        return { version: SESSION_VERSION, finished: response.status === 'finished', rounds };
    };

    return { action: 'call', request, apply };
}

// --- What the browser sees ------------------------------------------------------

export type BrowserQuestion = {
    id: string;
    hpoId: string;
    /** The official Spanish HPO label of the probed term. */
    label: string;
    text: string;
    help: string | null;
    /** Up to five genes a "sí" would favour; clinician mode only. */
    genesIfYes: string[] | null;
    /** Up to five genes a "no" would favour; clinician mode only. */
    genesIfNo: string[] | null;
    rationale: string | null;
};

export type BrowserRound = {
    round: number;
    /** The mode the texts of this round were written in. */
    mode: Mode;
    status: 'questions' | 'finished';
    finishReason: string | null;
    questions: BrowserQuestion[];
    ranking: { geneId: string; geneSymbol: string; score: number; modelScore: number; modelRank: number }[];
    specialties: Record<string, unknown> | null;
    confidence: number | null;
    interpretedAnswers: { hpoId: string; answer: AnswerValue; effectiveAnswer: AnswerValue; noteSummary: string | null }[];
    summary: string | null;
    warnings: string[];
};

export type BrowserSession = {
    finished: boolean;
    rounds: { round: number; mode: Mode; questions: BrowserQuestion[]; answers: StoredAnswer[] }[];
    latest: BrowserRound;
};

function toBrowserQuestion(q: RoundResponse['questions'][number], mode: Mode): BrowserQuestion {
    // Gene names and the clinical rationale are for the clinician. The agent
    // only sends them in that mode; this keeps a patient-mode round free of
    // them whatever it sends.
    const clinician = mode === 'medico';
    return {
        id: q.id,
        hpoId: q.hpo_id,
        label: q.label,
        text: q.text,
        help: q.help,
        genesIfYes: clinician ? q.genes_if_yes : null,
        genesIfNo: clinician ? q.genes_if_no : null,
        rationale: clinician ? q.rationale : null,
    };
}

/**
 * The agent's snake_case answer as the browser sees it. `versions` stays
 * server-side: it is for auditing a stored session, not for the reader.
 * `specialties` passes through unchanged because it has the same shape as the
 * `/rank-genes` specialties the results screen already renders.
 */
export function toBrowserRound(response: RoundResponse): BrowserRound {
    return {
        round: response.round,
        mode: response.mode,
        status: response.status,
        finishReason: response.finish_reason,
        questions: response.questions.map((q) => toBrowserQuestion(q, response.mode)),
        ranking: response.ranking.map((g) => ({
            geneId: g.gene_id,
            geneSymbol: g.gene_symbol,
            score: g.score,
            modelScore: g.model_score,
            modelRank: g.model_rank,
        })),
        specialties: response.specialties,
        confidence: response.confidence,
        interpretedAnswers: response.interpreted_answers.map((a) => ({
            hpoId: a.hpo_id,
            answer: a.answer,
            effectiveAnswer: a.effective_answer,
            noteSummary: a.note_summary,
        })),
        summary: response.summary,
        warnings: response.warnings,
    };
}

export function toBrowserSession(session: StoredSession): BrowserSession {
    return {
        finished: session.finished,
        rounds: session.rounds.map((r) => ({
            round: r.round,
            mode: r.mode,
            questions: r.response.questions.map((q) => toBrowserQuestion(q, r.response.mode)),
            answers: r.answers,
        })),
        latest: toBrowserRound(latestResponse(session)),
    };
}
