/**
 * What the launcher says while the question panel is hidden, as a pure
 * function of the session, so each state can be tested without a browser.
 */

import type { QuestionSessionState } from "./question-session";
import { MAX_ROUNDS } from "./questions-api";

export type LauncherKind = "start" | "continue" | "preparing" | "ready" | "finished";

export type LauncherState = {
    kind: LauncherKind;
    label: string;
    /** The smaller second line, or null. */
    detail: string | null;
    /** The round the progress segments show; null when there is none on show. */
    round: number | null;
};

/** Said under the label when the last request failed while the panel was out of sight. */
export const LAUNCHER_ERROR_DETAIL = "Hubo un problema · tu resultado no cambió";

/**
 * `unseen` is whether a round arrived while the panel was hidden and has not
 * been looked at since. The launcher says so and stops there: opening by
 * itself would take the screen from a reader who chose to look elsewhere.
 */
export function launcherState(
    state: Pick<QuestionSessionState, "phase" | "pending" | "latest" | "error">,
    unseen: boolean,
): LauncherState {
    if (state.pending !== null) {
        return {
            kind: "preparing",
            label: state.pending === "finish" ? "Armando el resumen…" : "Preparando preguntas…",
            detail: null,
            round: null,
        };
    }

    const failed = state.error !== null;

    if (state.phase === "finished") {
        return { kind: "finished", label: "Ver el resumen para la consulta", detail: failed ? LAUNCHER_ERROR_DETAIL : null, round: null };
    }

    if (state.phase === "questions" && state.latest) {
        const round = Math.min(Math.max(state.latest.round, 1), MAX_ROUNDS);
        const detail = failed ? LAUNCHER_ERROR_DETAIL : `Ronda ${round} de ${MAX_ROUNDS}`;
        return unseen && !failed
            ? { kind: "ready", label: "Preguntas listas", detail, round }
            : { kind: "continue", label: "Seguir con las preguntas", detail, round };
    }

    return { kind: "start", label: "Afinar la lista", detail: failed ? LAUNCHER_ERROR_DETAIL : "3 preguntas por ronda", round: null };
}
