"use client";

/**
 * Typed client for /api/questions, and the pure rules the question panel
 * runs on.
 *
 * The question agent is optional on top of a result that already exists, so
 * nothing here throws: every failure resolves to a value the panel can show
 * while the original ranking stays on screen untouched.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api";

export type QuestionMode = "paciente" | "medico";
export type AnswerValue = "si" | "no" | "no_se";
export type FinishReason = "max_rounds" | "user_finished" | "confident" | "no_useful_questions";

export const ANSWER_VALUES: readonly AnswerValue[] = ["si", "no", "no_se"];
export const MAX_NOTE_LENGTH = 280;
/** The agent's own ceiling. Shown to the reader so "ronda 2" has a horizon. */
export const MAX_ROUNDS = 3;

export type Question = {
    id: string;
    hpoId: string;
    /** The official Spanish HPO label of the probed term, e.g. "Situs inversus totalis". */
    label: string;
    text: string;
    help: string | null;
    /** Genes that move up if the answer is yes. Filled for the medical view only. */
    genesIfYes: string[] | null;
    /** Genes that move up if the answer is no. Filled for the medical view only. */
    genesIfNo: string[] | null;
    /** Why it is being asked, in clinical terms. Filled for the medical view only. */
    rationale: string | null;
};

export type RankedGeneRow = {
    geneId: string;
    geneSymbol: string;
    /** The refined score: a normalised posterior, never shown as a number. */
    score: number;
    /**
     * The gene's place in this ranking itself, 1-based: the agent re-runs the
     * model with the confirmed findings each round. Not read by the screen,
     * which measures moves against the list it showed first.
     */
    modelRank: number;
};

export type SpecialtiesPayload = {
    top_specialty: string | null;
    top_specialties: string[];
    specialty_ranking: Array<{
        specialty: string;
        matched_genes_count: number;
        probability_mass: number;
        genes: string[];
        fraction_of_selected_genes: number;
    }>;
    selected_gene_count: number;
    unmapped_genes: string[];
    unmapped_gene_count: number;
};

export type InterpretedAnswer = {
    hpoId: string;
    answer: AnswerValue;
    /** What the agent took the answer to mean once the note was read. */
    effectiveAnswer: AnswerValue;
    noteSummary: string | null;
};

export type RoundResponse = {
    round: number;
    /** The wording the questions and the summary were written in. */
    mode: QuestionMode;
    status: "questions" | "finished";
    finishReason: FinishReason | null;
    questions: Question[];
    ranking: RankedGeneRow[];
    specialties: SpecialtiesPayload | null;
    confidence: number | null;
    /** Every answer of the session so far, not just this round's. */
    interpretedAnswers: InterpretedAnswer[];
    summary: string | null;
    warnings: string[];
};

export type AnswerInput = { hpoId: string; answer: AnswerValue; note?: string };

/** An answer as the server stored it: a blank note is null, never missing. */
export type SessionAnswer = { hpoId: string; answer: AnswerValue; note: string | null };

/**
 * One round of a saved session. A round that was never answered keeps its
 * questions and an empty `answers`; the round that closed the session has
 * neither.
 */
export type SessionRound = {
    round: number;
    mode: QuestionMode;
    questions: Question[];
    answers: SessionAnswer[];
};

export type QuestionSession = {
    finished: boolean;
    rounds: SessionRound[];
    latest: RoundResponse;
};

export type RoundRequest = {
    diagnosisId: string;
    mode: QuestionMode;
    answers?: AnswerInput[];
    finish?: boolean;
};

/**
 * The `code` of an /api/questions error body, which is what failures are told
 * apart by: several share a status and need their own handling, such as a
 * search with no usable symptoms (a 400 no retry can fix), a round already
 * running for the account (a 429 that clears in seconds) or the platform-wide
 * cap on rounds (a 429 that is nobody's own doing).
 */
export type QuestionErrorCode =
    | "invalid_request"
    | "answers_mismatch"
    | "no_usable_symptoms"
    | "not_found"
    | "finished"
    | "conflict"
    | "unreadable_session"
    | "rate_limited"
    | "global_limit"
    | "round_in_flight"
    | "internal"
    | "disabled"
    | "unavailable"
    | "timeout";

const QUESTION_ERROR_CODES: ReadonlySet<string> = new Set<QuestionErrorCode>([
    "invalid_request",
    "answers_mismatch",
    "no_usable_symptoms",
    "not_found",
    "finished",
    "conflict",
    "unreadable_session",
    "rate_limited",
    "global_limit",
    "round_in_flight",
    "internal",
    "disabled",
    "unavailable",
    "timeout",
]);

export type RoundFailure = {
    ok: false;
    status: number;
    /** Null when the body had no known code: a proxy's error page, a dropped connection. */
    code: QuestionErrorCode | null;
    retryAfterSeconds: number | null;
};

export type RoundResult = { ok: true; data: RoundResponse } | RoundFailure;

export type SessionRead = { ok: true; session: QuestionSession | null } | { ok: false };

/** The shape the gene grid already renders, so a refined ranking reuses every card. */
export type GeneRow = {
    gene_id: string;
    gene_symbol: string;
    score: number;
    matched_hpo_ids: string[];
    matched_count: number;
    input_count: number;
    coverage: number;
    precision: number;
};

/** A draft answer while the round is still open. */
export type DraftAnswer = { answer: AnswerValue | null; note: string };

/** One question the reader answered, as the panel and the chips show it. */
export type AnsweredQuestion = {
    question: Question;
    /** The wording the question was written in, which decides how it may be shown. */
    mode: QuestionMode;
    answer: AnswerValue;
    note: string | null;
    effectiveAnswer: AnswerValue;
};

/** What a search with no symptom the agent can ask around is told. */
export const NO_SYMPTOMS_MESSAGE = "No pudimos usar los síntomas de esta búsqueda para hacer preguntas.";

function readCookie(name: string): string | null {
    if (typeof document === "undefined") return null;
    const escaped = name.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
    const match = document.cookie.match(new RegExp(`(?:^|; )${escaped}=([^;]*)`));
    return match ? decodeURIComponent(match[1]) : null;
}

/**
 * "en 5 minutos", "en un minuto", "en unos segundos". A family has no use for
 * "3540 segundos", and the header is an upper bound anyway.
 */
export function humanizeWait(seconds: number | null): string {
    if (!seconds || seconds <= 0) return "en un rato";
    if (seconds <= 20) return "en unos segundos";
    const minutes = Math.ceil(seconds / 60);
    if (minutes <= 1) return "en un minuto";
    if (minutes < 50) return `en ${minutes} minutos`;
    if (minutes < 90) return "en alrededor de una hora";
    return `en unas ${Math.round(minutes / 60)} horas`;
}

/**
 * The failure's code, or the one its status most likely means when the body
 * carried none, as when a proxy in front of the backend answered instead.
 */
export function failureCode(failure: { status: number; code: QuestionErrorCode | null }): QuestionErrorCode | null {
    if (failure.code) return failure.code;
    switch (failure.status) {
        case 400:
            return "invalid_request";
        case 404:
            return "not_found";
        case 409:
            return "conflict";
        case 429:
            return "rate_limited";
        case 500:
            return "internal";
        case 503:
            return "unavailable";
        case 504:
            return "timeout";
        default:
            return null;
    }
}

/**
 * The reader-facing message for a failed round.
 *
 * Our own copy rather than the server's: every one of these leaves the
 * original result in place, and the message has to say so in the same calm
 * voice whatever the upstream wording is.
 */
export function roundErrorMessage(
    status: number,
    retryAfterSeconds: number | null = null,
    code: QuestionErrorCode | null = null,
): string {
    if (status === 401 || status === 403) {
        return "Tu sesión expiró. Tu resultado no cambió; volvé a iniciar sesión para seguir con las preguntas.";
    }
    switch (failureCode({ status, code })) {
        case "no_usable_symptoms":
            return `${NO_SYMPTOMS_MESSAGE} Tu resultado no cambió.`;
        case "invalid_request":
        case "answers_mismatch":
            return "No pudimos procesar tus respuestas. Tu resultado no cambió.";
        case "not_found":
            return "No encontramos esta búsqueda para hacerte preguntas. Tu resultado no cambió.";
        case "finished":
        case "conflict":
        case "unreadable_session":
            return "No pudimos seguir con estas preguntas. Tu resultado no cambió.";
        case "round_in_flight":
            return `Ya hay una ronda en curso en otra pestaña o ventana. Tu resultado no cambió; esperá a que termine y probá de nuevo ${humanizeWait(retryAfterSeconds)}.`;
        case "rate_limited":
            return `Llegaste al límite de preguntas por ahora. Tu resultado no cambió; podés seguir ${humanizeWait(retryAfterSeconds)}.`;
        // Not the reader's limit but the platform's, so nothing here may
        // suggest they asked too much.
        case "global_limit":
            return `Diagnostic.ar llegó al máximo de preguntas por ahora. Tu resultado no cambió; podés seguir ${humanizeWait(retryAfterSeconds)}.`;
        case "disabled":
        case "unavailable":
            return retryAfterSeconds
                ? `Las preguntas no están disponibles en este momento. Tu resultado no cambió; probá de nuevo ${humanizeWait(retryAfterSeconds)}.`
                : "Las preguntas no están disponibles en este momento. Tu resultado no cambió.";
        case "timeout":
            return "Pensar las preguntas tardó más de lo esperado. Tu resultado no cambió; podés probar de nuevo.";
        default:
            return "No pudimos conectarnos. Tu resultado no cambió; probá de nuevo en un rato.";
    }
}

function parseRetryAfter(value: string | null): number | null {
    if (!value) return null;
    const seconds = Number(value);
    return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : null;
}

function parseErrorCode(value: unknown): QuestionErrorCode | null {
    return typeof value === "string" && QUESTION_ERROR_CODES.has(value) ? (value as QuestionErrorCode) : null;
}

/** Whether the question agent is switched on. Anything but a clear yes is a no. */
export async function fetchQuestionsStatus(signal?: AbortSignal): Promise<boolean> {
    try {
        const res = await fetch(`${API_URL}/questions/status`, { credentials: "include", signal });
        if (!res.ok) return false;
        const body = (await res.json()) as { enabled?: unknown };
        return body.enabled === true;
    } catch {
        return false;
    }
}

export async function postQuestionRound(request: RoundRequest, signal?: AbortSignal): Promise<RoundResult> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const csrf = readCookie("csrf_token");
    if (csrf) headers["X-CSRF-Token"] = csrf;

    try {
        const res = await fetch(`${API_URL}/questions/rounds`, {
            method: "POST",
            credentials: "include",
            headers,
            signal,
            body: JSON.stringify(request),
        });
        if (!res.ok) {
            const body = (await res.json().catch(() => null)) as { code?: unknown } | null;
            return {
                ok: false,
                status: res.status,
                code: parseErrorCode(body?.code),
                retryAfterSeconds: parseRetryAfter(res.headers.get("Retry-After")),
            };
        }
        return { ok: true, data: (await res.json()) as RoundResponse };
    } catch {
        return { ok: false, status: 0, code: null, retryAfterSeconds: null };
    }
}

/** The saved session for a diagnosis. `ok: false` means it could not be read, not that there is none. */
export async function fetchQuestionSession(diagnosisId: string, signal?: AbortSignal): Promise<SessionRead> {
    try {
        const res = await fetch(`${API_URL}/questions/${encodeURIComponent(diagnosisId)}`, {
            credentials: "include",
            signal,
        });
        if (!res.ok) return { ok: false };
        const body = (await res.json()) as { session?: QuestionSession | null };
        return { ok: true, session: body.session ?? null };
    } catch {
        return { ok: false };
    }
}

/**
 * A refined ranking in the grid's own shape. The match fields are zeroed
 * exactly as the model returns them: the overlap on each card is computed by
 * us from the gene profile, never read off the ranking.
 */
export function toGeneRows(ranking: RankedGeneRow[], inputCount: number): GeneRow[] {
    return ranking.map((row) => ({
        gene_id: row.geneId,
        gene_symbol: row.geneSymbol || row.geneId,
        score: row.score,
        matched_hpo_ids: [],
        matched_count: 0,
        input_count: inputCount,
        coverage: 0,
        precision: 0,
    }));
}

/** Every pending question has an answer; notes stay optional. */
export function canSubmitRound(questions: Question[], drafts: Record<string, DraftAnswer>): boolean {
    return (
        questions.length > 0 &&
        questions.every((question) => {
            const draft = drafts[question.id];
            return Boolean(draft?.answer) && (draft?.note.length ?? 0) <= MAX_NOTE_LENGTH;
        })
    );
}

/** The request body's answers, in question order, with blank notes left out. */
export function buildAnswers(questions: Question[], drafts: Record<string, DraftAnswer>): AnswerInput[] {
    const answers: AnswerInput[] = [];
    for (const question of questions) {
        const draft = drafts[question.id];
        if (!draft?.answer) continue;
        const note = draft.note.trim().slice(0, MAX_NOTE_LENGTH);
        answers.push(note ? { hpoId: question.hpoId, answer: draft.answer, note } : { hpoId: question.hpoId, answer: draft.answer });
    }
    return answers;
}

const hpoKey = (hpoId: string) => hpoId.trim().toUpperCase();

/**
 * Folds a round's submitted answers into the running history, then takes the
 * agent's reading of every answer so far. A note like "sí, desde bebé" under
 * "No sé" is read as a yes, and the chips should follow the reading rather
 * than the button.
 */
export function mergeAnswered(
    history: AnsweredQuestion[],
    round: { mode: QuestionMode; questions: Question[] },
    answers: Array<AnswerInput | SessionAnswer>,
    interpreted: InterpretedAnswer[],
): AnsweredQuestion[] {
    const given = new Set(answers.map((answer) => hpoKey(answer.hpoId)));
    const next = history.filter((item) => !given.has(hpoKey(item.question.hpoId)));
    for (const answer of answers) {
        const question = round.questions.find((q) => hpoKey(q.hpoId) === hpoKey(answer.hpoId));
        if (!question) continue;
        next.push({
            question,
            mode: round.mode,
            answer: answer.answer,
            note: answer.note?.trim() || null,
            effectiveAnswer: answer.answer,
        });
    }
    const readings = new Map(interpreted.map((item) => [hpoKey(item.hpoId), item.effectiveAnswer]));
    return next.map((item) => {
        const reading = readings.get(hpoKey(item.question.hpoId));
        return reading && reading !== item.effectiveAnswer ? { ...item, effectiveAnswer: reading } : item;
    });
}

/** Rebuilds the history of a saved session, for a reader coming back to it. */
export function historyFromSession(session: QuestionSession): AnsweredQuestion[] {
    let history: AnsweredQuestion[] = [];
    for (const round of session.rounds ?? []) {
        if (!Array.isArray(round?.answers) || round.answers.length === 0) continue;
        history = mergeAnswered(
            history,
            { mode: round.mode, questions: Array.isArray(round.questions) ? round.questions : [] },
            round.answers,
            [],
        );
    }
    return mergeAnswered(history, { mode: "paciente", questions: [] }, [], session.latest?.interpretedAnswers ?? []);
}

/** The phenotypes the answers confirm and rule out, by the agent's reading. */
export function answeredFindings(history: AnsweredQuestion[]): { present: AnsweredQuestion[]; absent: AnsweredQuestion[] } {
    return {
        present: history.filter((item) => item.effectiveAnswer === "si"),
        absent: history.filter((item) => item.effectiveAnswer === "no"),
    };
}

/**
 * The words a question may be shown with in a view.
 *
 * A question written for the medical view can name genes or read as a
 * clinical verdict, so the family view never shows its text or help: it
 * shows the HPO label behind a neutral lead-in instead. The medical view can
 * show either wording.
 */
export function questionWording(
    question: Question,
    writtenIn: QuestionMode,
    professional: boolean,
): { text: string; help: string | null; neutral: boolean } {
    if (writtenIn === "medico" && !professional) {
        return {
            text: `¿Se notó algo como «${question.label}»?`,
            help: "Si no sabés qué es, respondé «No sé».",
            neutral: true,
        };
    }
    return { text: question.text, help: question.help, neutral: false };
}

export function answerLabel(answer: AnswerValue): string {
    return answer === "si" ? "Sí" : answer === "no" ? "No" : "No sé";
}

/**
 * Warnings are shown as they come when they are already prose. A bare code
 * would mean nothing to a family, so it is replaced by the case the panel was
 * designed around: part of the round ran on the fallback, without the
 * language model.
 */
export function describeWarning(warning: string): string {
    return /\s/.test(warning.trim()) ? warning.trim() : "Algunas preguntas se generaron sin IA.";
}
