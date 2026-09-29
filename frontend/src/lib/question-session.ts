/**
 * The question session's state and every transition it can make, as pure
 * functions, so the rules can be tested without a browser.
 *
 * The rule the transitions exist for: after any failure whose outcome is
 * unknown, the server's saved session is the truth. A lost response, a
 * timeout or a conflict is settled by reading it back and adopting it when it
 * moved on, never by sending answers the server may already have applied to
 * a round that is no longer pending.
 */

import {
    failureCode,
    historyFromSession,
    mergeAnswered,
    roundErrorMessage,
    type AnswerInput,
    type AnsweredQuestion,
    type Question,
    type QuestionErrorCode,
    type QuestionMode,
    type QuestionSession,
    type RankedGeneRow,
    type RoundFailure,
    type RoundResponse,
    type SpecialtiesPayload,
} from "./questions-api";

/** The backend waits up to 100 s for the agent; this leaves room for its own 504 to arrive first. */
export const ROUND_TIMEOUT_MS = 110_000;

export type QuestionPhase = "idle" | "questions" | "finished";
export type QuestionPending = null | "start" | "answers" | "finish";

export type QuestionSessionState = {
    phase: QuestionPhase;
    pending: QuestionPending;
    latest: RoundResponse | null;
    history: AnsweredQuestion[];
    /** The latest round that applied answers. Null until the reader has answered something. */
    refined: RoundResponse | null;
    /** Specialties from the latest answered round, which re-runs the model with the confirmed findings; null keeps the original ones on screen. */
    refinedSpecialties: SpecialtiesPayload | null;
    /**
     * What the latest answers were measured against: the refined list on
     * screen before them (null when that was the model's own), and which
     * questions they answered. Null after a reload, when neither is known.
     */
    lastChange: { before: RankedGeneRow[] | null; hpoIds: string[] } | null;
    error: string | null;
    /** Whether the failed request can simply be sent again. */
    retryable: boolean;
    /** Seconds before sending it again can help, for a limit that clears on its own; null when it can go now. */
    retryHold: number | null;
    /** Nothing can be asked about this search, so the way in is withdrawn. */
    blocked: boolean;
    /**
     * A request's outcome is unknown and the saved session could not be read
     * to settle it. Finishing reads it first rather than resending answers.
     */
    uncertain: boolean;
    /** Bumped by the reader's own actions only, so a resumed session never steals focus. */
    focusToken: number;
};

export const INITIAL_STATE: QuestionSessionState = {
    phase: "idle",
    pending: null,
    latest: null,
    history: [],
    refined: null,
    refinedSpecialties: null,
    lastChange: null,
    error: null,
    retryable: false,
    retryHold: null,
    blocked: false,
    uncertain: false,
    focusToken: 0,
};

export function phaseOf(response: RoundResponse): QuestionPhase {
    return response.status === "finished" ? "finished" : "questions";
}

export function fromSession(session: QuestionSession): QuestionSessionState {
    const history = historyFromSession(session);
    const answered = history.length > 0;
    return {
        ...INITIAL_STATE,
        phase: session.finished ? "finished" : phaseOf(session.latest),
        latest: session.latest,
        history,
        refined: answered ? session.latest : null,
        refinedSpecialties: answered ? session.latest.specialties : null,
    };
}

/** Whether the saved session is ahead of what the screen shows. */
export function serverMovedOn(state: QuestionSessionState, session: QuestionSession | null): boolean {
    if (!session?.latest) return false;
    if (!state.latest) return true;
    if (session.finished && state.phase !== "finished") return true;
    return session.latest.round !== state.latest.round || session.latest.status !== state.latest.status;
}

export function beginRequest(state: QuestionSessionState, pending: Exclude<QuestionPending, null>): QuestionSessionState {
    return { ...state, pending, error: null, retryable: false, retryHold: null };
}

function settled(state: QuestionSessionState, next: QuestionSessionState): QuestionSessionState {
    return {
        ...next,
        pending: null,
        error: null,
        retryable: false,
        retryHold: null,
        uncertain: false,
        focusToken: state.focusToken + 1,
    };
}

export function afterStart(state: QuestionSessionState, data: RoundResponse): QuestionSessionState {
    return settled(state, { ...state, phase: phaseOf(data), latest: data });
}

/** The round that was on screen was answered (and maybe closed) with `answers`. */
export function afterAnswers(
    state: QuestionSessionState,
    answered: { mode: QuestionMode; questions: Question[] },
    answers: AnswerInput[],
    data: RoundResponse,
): QuestionSessionState {
    return settled(state, {
        ...state,
        phase: phaseOf(data),
        latest: data,
        history: mergeAnswered(state.history, answered, answers, data.interpretedAnswers ?? []),
        refined: data,
        refinedSpecialties: data.specialties ?? state.refinedSpecialties,
        lastChange: { before: state.refined?.ranking ?? null, hpoIds: answers.map((answer) => answer.hpoId) },
    });
}

/** Closed without new answers: a refinement already on screen takes the closing ranking. */
export function afterFinish(state: QuestionSessionState, data: RoundResponse): QuestionSessionState {
    const answered = state.history.length > 0;
    return settled(state, {
        ...state,
        phase: "finished",
        latest: data,
        refined: answered ? data : state.refined,
        refinedSpecialties: answered ? (data.specialties ?? state.refinedSpecialties) : state.refinedSpecialties,
    });
}

/** What to do about a failed round, decided before anything is read back. */
export type FailurePlan = {
    status: number;
    /** Read the saved session back: the server may have moved on without us seeing it. */
    recover: boolean;
    retryable: boolean;
    blocked: boolean;
    /** The request may have been applied; no reply says whether. */
    unknownOutcome: boolean;
    /** Seconds before a retry can help. */
    hold: number | null;
    message: string;
};

/** Refusals that may mean the saved session moved on without this page seeing it. */
const RECOVER_CODES: ReadonlySet<QuestionErrorCode> = new Set<QuestionErrorCode>([
    "invalid_request",
    "answers_mismatch",
    "finished",
    "conflict",
    "unreadable_session",
]);

const RETRYABLE_CODES: ReadonlySet<QuestionErrorCode> = new Set<QuestionErrorCode>([
    "rate_limited",
    "global_limit",
    "round_in_flight",
    "internal",
    "disabled",
    "unavailable",
    "timeout",
]);

/** Limits that clear on their own, whose retry waits for their Retry-After. */
const HELD_CODES: ReadonlySet<QuestionErrorCode | null> = new Set<QuestionErrorCode>(["rate_limited", "global_limit"]);

/** A client-side timeout is treated as the gateway timeout the reader would otherwise have waited for. */
export function planFailure(failure: RoundFailure, timedOut: boolean): FailurePlan {
    const status = timedOut ? 504 : failure.status;
    const code = timedOut ? "timeout" : failureCode(failure);
    const unknownOutcome = status === 0 || code === "timeout";
    return {
        status,
        recover: unknownOutcome || (code !== null && RECOVER_CODES.has(code)),
        retryable: unknownOutcome || (code === null ? status >= 500 : RETRYABLE_CODES.has(code)),
        blocked: code === "no_usable_symptoms",
        unknownOutcome,
        // A limit says when to come back; offering to retry before then only
        // earns the same refusal. A proxy's 429 is read as the hourly one.
        hold: HELD_CODES.has(code) ? (failure.retryAfterSeconds ?? RATE_LIMIT_HOLD_SECONDS) : null,
        message: roundErrorMessage(status, failure.retryAfterSeconds, code),
    };
}

/** How long a limit holds the retry back when no Retry-After came with it. */
export const RATE_LIMIT_HOLD_SECONDS = 60;

/**
 * Settles a failure, given the saved session read back after it (`undefined`
 * when it was not read or could not be).
 *
 * When the server is ahead, its state is adopted. That is silent after a lost
 * reply, which is simply our own round arriving late; after a 400 or a 409
 * someone else moved it (another tab, another window), and the reader is told.
 */
export function afterFailure(
    state: QuestionSessionState,
    plan: FailurePlan,
    read: QuestionSession | null | undefined,
): QuestionSessionState {
    if (read && serverMovedOn(state, read)) {
        const adopted = fromSession(read);
        return {
            ...adopted,
            error: plan.unknownOutcome ? null : movedOnMessage(adopted.phase),
            focusToken: state.focusToken + 1,
        };
    }
    return {
        ...state,
        pending: null,
        error: plan.message,
        retryable: plan.retryable,
        retryHold: plan.retryable ? plan.hold : null,
        blocked: state.blocked || plan.blocked,
        uncertain: plan.unknownOutcome && read === undefined,
    };
}

function movedOnMessage(phase: QuestionPhase): string {
    return phase === "finished"
        ? "Estas preguntas ya habían terminado, quizás en otra pestaña o ventana. Te mostramos cómo quedaron."
        : "Estas preguntas avanzaron en otra pestaña o ventana. Te mostramos dónde quedaron.";
}

/** The saved session was read back before finishing; adopt it if it is ahead. */
export function afterReconcile(state: QuestionSessionState, read: QuestionSession | null): QuestionSessionState {
    if (read && serverMovedOn(state, read)) {
        return { ...fromSession(read), focusToken: state.focusToken + 1 };
    }
    return { ...state, uncertain: false };
}
