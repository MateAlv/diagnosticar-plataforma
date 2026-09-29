"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
    buildAnswers,
    canSubmitRound,
    fetchQuestionSession,
    postQuestionRound,
    type DraftAnswer,
    type QuestionMode,
    type QuestionSession,
    type RoundRequest,
    type RoundResponse,
    type RoundResult,
} from "@/lib/questions-api";
import {
    INITIAL_STATE,
    ROUND_TIMEOUT_MS,
    afterAnswers,
    afterFailure,
    afterFinish,
    afterReconcile,
    afterStart,
    beginRequest,
    fromSession,
    planFailure,
    type QuestionPending,
    type QuestionSessionState,
} from "@/lib/question-session";

export type { QuestionPhase, QuestionPending, QuestionSessionState } from "@/lib/question-session";

type Attempt = {
    pending: Exclude<QuestionPending, null>;
    request: Omit<RoundRequest, "diagnosisId" | "mode">;
    apply: (state: QuestionSessionState, data: RoundResponse) => QuestionSessionState;
};

const NO_DRAFTS: Record<string, DraftAnswer> = {};
const EMPTY_DRAFT: DraftAnswer = { answer: null, note: "" };

/** Which round a set of drafts belongs to, down to its questions, so an adopted round never inherits them. */
function roundKey(diagnosisId: string | null, round: RoundResponse | null): string | null {
    if (!diagnosisId || !round || round.status !== "questions") return null;
    return `${diagnosisId}:${round.round}:${round.questions.map((question) => question.id).join(",")}`;
}

/**
 * The question agent's session for one saved diagnosis.
 *
 * The session lives on the server, keyed by the diagnosis, so the only thing
 * kept here is what the screen needs: the round on show, what the reader has
 * answered so far, and the latest ranking that took those answers into
 * account. A failure never touches the original result.
 *
 * The answers still being written live here too, not in the panel: the panel
 * can be hidden in the middle of a round, which unmounts it, and coming back
 * must find every answer and note where it was left.
 *
 * `refreshAuth` renews an expired access token and says whether it worked;
 * a round rejected for auth is sent once more after it.
 */
export function useQuestionSession(diagnosisId: string | null, refreshAuth: () => Promise<boolean>) {
    const [state, setState] = useState<QuestionSessionState>(INITIAL_STATE);
    const [draftBook, setDraftBook] = useState<{ key: string | null; drafts: Record<string, DraftAnswer> }>({
        key: null,
        drafts: NO_DRAFTS,
    });
    // When the request now out began, so a wait shown again after the panel
    // was hidden keeps counting from its real start.
    const [pendingSince, setPendingSince] = useState<number | null>(null);
    const busy = state.pending !== null;
    useEffect(() => {
        setPendingSince(busy ? Date.now() : null);
    }, [busy]);

    const currentKey = roundKey(diagnosisId, state.latest);
    const drafts = draftBook.key !== null && draftBook.key === currentKey ? draftBook.drafts : NO_DRAFTS;

    const updateDraft = useCallback(
        (questionId: string, patch: Partial<DraftAnswer>) => {
            setDraftBook((prev) => {
                const base = prev.key === currentKey ? prev.drafts : NO_DRAFTS;
                return {
                    key: currentKey,
                    drafts: { ...base, [questionId]: { ...(base[questionId] ?? EMPTY_DRAFT), ...patch } },
                };
            });
        },
        [currentKey],
    );
    // Aborted when the diagnosis changes, the screen unmounts, or a newer
    // request replaces this one; every await below checks it before writing.
    const life = useRef<AbortController | null>(null);
    const activeId = useRef<string | null>(diagnosisId);
    const lastAttempt = useRef<Attempt | null>(null);

    useEffect(() => {
        activeId.current = diagnosisId;
        lastAttempt.current = null;
        setState(INITIAL_STATE);
        if (!diagnosisId) return;

        const controller = new AbortController();
        fetchQuestionSession(diagnosisId, controller.signal).then((read) => {
            if (read.ok && read.session && !controller.signal.aborted) setState(fromSession(read.session));
        });
        return () => {
            controller.abort();
            life.current?.abort();
        };
    }, [diagnosisId]);

    /** A fresh lifetime for one user action, cancelling whatever was still running. */
    const begin = useCallback(() => {
        life.current?.abort();
        const controller = new AbortController();
        life.current = controller;
        const id = diagnosisId;
        return { signal: controller.signal, live: () => !controller.signal.aborted && activeId.current === id };
    }, [diagnosisId]);

    const post = useCallback(
        async (request: RoundRequest, signal: AbortSignal): Promise<{ result: RoundResult; timedOut: boolean }> => {
            const controller = new AbortController();
            const cancel = () => controller.abort();
            signal.addEventListener("abort", cancel);
            let timedOut = false;
            const timer = setTimeout(() => {
                timedOut = true;
                controller.abort();
            }, ROUND_TIMEOUT_MS);
            const result = await postQuestionRound(request, controller.signal);
            clearTimeout(timer);
            signal.removeEventListener("abort", cancel);
            return { result, timedOut };
        },
        [],
    );

    const run = useCallback(
        async (attempt: Attempt, mode: QuestionMode) => {
            if (!diagnosisId) return;
            const { signal, live } = begin();
            lastAttempt.current = attempt;
            const request: RoundRequest = { diagnosisId, mode, ...attempt.request };

            setState((prev) => beginRequest(prev, attempt.pending));
            let { result, timedOut } = await post(request, signal);
            if (!live()) return;

            if (!result.ok && (result.status === 401 || result.status === 403)) {
                const refreshed = await refreshAuth();
                if (!live()) return;
                if (refreshed) {
                    ({ result, timedOut } = await post(request, signal));
                    if (!live()) return;
                }
            }

            if (result.ok) {
                lastAttempt.current = null;
                const data = result.data;
                setState((prev) => attempt.apply(prev, data));
                return;
            }

            const plan = planFailure(result, timedOut);
            let read: QuestionSession | null | undefined;
            if (plan.recover) {
                const session = await fetchQuestionSession(diagnosisId, signal);
                if (!live()) return;
                read = session.ok ? session.session : undefined;
            }
            // An adopted session is never retryable, so a stale attempt kept
            // here cannot be sent again from the screen.
            if (!plan.retryable) lastAttempt.current = null;
            setState((prev) => afterFailure(prev, plan, read));
        },
        [begin, diagnosisId, post, refreshAuth],
    );

    const start = useCallback(
        (mode: QuestionMode) => {
            void run({ pending: "start", request: {}, apply: afterStart }, mode);
        },
        [run],
    );

    const submitRound = useCallback(
        (mode: QuestionMode, drafts: Record<string, DraftAnswer>, finish: boolean) => {
            const round = state.latest;
            if (!round || !canSubmitRound(round.questions, drafts)) return;
            const answers = buildAnswers(round.questions, drafts);
            const answered = { mode: round.mode, questions: round.questions };
            void run(
                {
                    pending: finish ? "finish" : "answers",
                    request: finish ? { answers, finish } : { answers },
                    apply: (prev, data) => afterAnswers(prev, answered, answers, data),
                },
                mode,
            );
        },
        [run, state.latest],
    );

    const submit = useCallback(
        (mode: QuestionMode, drafts: Record<string, DraftAnswer>) => submitRound(mode, drafts, false),
        [submitRound],
    );

    /**
     * Ends the loop. A fully answered round is sent with it, since the reader
     * plainly meant those answers; a partial one is dropped rather than sent
     * half-filled.
     *
     * After a request whose outcome is still unknown, the saved session is
     * read first: if the server already moved past this round, its answers
     * are stale and only the finish is sent.
     */
    const finish = useCallback(
        async (mode: QuestionMode, drafts: Record<string, DraftAnswer>) => {
            if (!diagnosisId) return;
            let current = state;
            if (state.uncertain) {
                const { signal, live } = begin();
                setState((prev) => beginRequest(prev, "finish"));
                const read = await fetchQuestionSession(diagnosisId, signal);
                if (!live()) return;
                if (!read.ok) {
                    setState((prev) => ({
                        ...prev,
                        pending: null,
                        error: "No pudimos conectarnos. Tu resultado no cambió; probá de nuevo en un rato.",
                        retryable: false,
                    }));
                    return;
                }
                current = afterReconcile(state, read.session);
                setState(current);
                if (current.phase === "finished") return;
                if (current.latest !== state.latest) {
                    void run({ pending: "finish", request: { finish: true }, apply: afterFinish }, mode);
                    return;
                }
            }
            if (current.latest && canSubmitRound(current.latest.questions, drafts)) {
                submitRound(mode, drafts, true);
                return;
            }
            void run({ pending: "finish", request: { finish: true }, apply: afterFinish }, mode);
        },
        [begin, diagnosisId, run, state, submitRound],
    );

    /** Sends the failed request again, worded for the view on screen now. */
    const retry = useCallback(
        (mode: QuestionMode) => {
            const attempt = lastAttempt.current;
            if (attempt) void run(attempt, mode);
        },
        [run],
    );

    return { state, start, submit, finish, retry, drafts, updateDraft, pendingSince };
}
