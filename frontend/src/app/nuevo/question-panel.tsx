"use client";

import { useEffect, useRef, useState, type FocusEvent, type ReactElement, type ReactNode, type RefObject } from "react";
import { originsIn, sessionChanges, symbolOf } from "@/lib/question-insights";
import {
    MAX_ROUNDS,
    describeWarning,
    isSimpleMode,
    type DraftAnswer,
    type FinishReason,
    type QuestionMode,
    type RankedGeneRow,
} from "@/lib/questions-api";
import { ChangeReceipt } from "./change-receipt";
import { ConsultSummary, type SheetGene } from "./consult-summary";
import { AlertIcon, ChevronIcon, ClockIcon, InfoIcon, QuestionIcon, RoundsIcon, ShieldIcon } from "./icons";
import { ACTION_BAR, EYEBROW, PRIMARY, SECONDARY } from "./panel-styles";
import { RoundForm } from "./round-form";
import { RoundProgress } from "./round-progress";
import { WaitSkeleton, WaitStatus } from "./round-wait";
import type { QuestionSessionState } from "./use-question-session";

/**
 * What the question panel shows: the optional loop that refines a ranking
 * with yes/no questions. Where it shows it — docked beside the genes, or in
 * a drawer or a sheet over them — is the frame's business
 * (question-dock.tsx); this file is the same in all three.
 *
 * A stepped surface: an entry that says what it costs and that nothing is
 * lost, rounds of three questions with what the last answers changed at the
 * top, and at the end the summary to take to the consultation.
 *
 * Both audiences use it. The medical view adds, per question, the HPO term,
 * why it is asked and which genes each answer moves up; the family view never
 * shows those, because a question framed around a gene reads to a parent as a
 * verdict about their child.
 *
 * Each round is written in the view that was on when it was asked, and the
 * view can change between rounds. The family view therefore never shows a
 * text written for the medical one, whatever it says: it falls back to the
 * HPO label, and to a neutral note in place of a medical summary.
 */

const FINISH_COPY: Record<FinishReason, string> = {
    max_rounds: "Ya se hicieron todas las rondas de preguntas previstas para esta búsqueda.",
    user_finished: "Terminaste las preguntas antes de completar las rondas.",
    confident: "Las preguntas que quedaban ya no cambiaban el orden de la lista.",
    no_useful_questions: "No encontramos más preguntas que ayuden a ordenar la lista.",
};

/** The panel's title for where the session stands. */
export function panelTitle(state: Pick<QuestionSessionState, "phase" | "pending" | "error" | "blocked">): string {
    if (state.phase === "finished") return "Para conversar en la consulta";
    const inviting = state.phase === "idle" && state.pending === null && !state.error && !state.blocked;
    return inviting ? "¿Querés afinar la lista?" : "Afinar la lista con preguntas";
}

/**
 * The part of the panel that never scrolls away: where the reader is, the
 * way to put the panel aside, and the disclaimer, which has to be in view
 * whenever the questions are.
 *
 * "Ocultar", never "Cerrar": closing sounds like ending, and the loop goes on
 * while the panel is out of sight. The eyebrow above the title is what makes
 * that safe to do, so the button is described by it.
 */
export function QuestionPanelHeader({
    state,
    disclaimer,
    titleId,
    titleRef,
    roundHeadingRef,
    wrapTitle = (title) => title,
    onHide,
    hideToward,
    handle = false,
}: {
    state: QuestionSessionState;
    disclaimer: string;
    /** Set where the frame labels itself by id; a dialog title gets its own. */
    titleId?: string;
    titleRef: RefObject<HTMLHeadingElement | null>;
    roundHeadingRef: RefObject<HTMLHeadingElement | null>;
    /** Wraps the title, so a dialog frame can make it the dialog's own. */
    wrapTitle?: (title: ReactElement) => ReactNode;
    onHide: () => void;
    /** Where the panel goes when hidden, for the button's arrow. */
    hideToward: "right" | "down";
    /** A grab handle, for the sheet on a phone. */
    handle?: boolean;
}) {
    const captionId = "preguntas-guardadas";
    return (
        <div className="shrink-0 border-b border-[var(--lu-border)] bg-[var(--lu-surface)] px-5 pb-4 pt-3 print:border-0 print:bg-white print:px-0">
            {handle && (
                <span aria-hidden="true" className="mx-auto mb-2 block h-1.5 w-10 rounded-full bg-[var(--lu-border-strong)] print:hidden" />
            )}
            <div className="flex items-center gap-3">
                <p id={captionId} className={`${EYEBROW} flex min-w-0 flex-1 items-center gap-1.5 print:hidden`}>
                    <ShieldIcon className="h-3.5 w-3.5 shrink-0 text-[var(--lu-accent-text)]" />
                    Tus respuestas quedan guardadas
                </p>
                <button
                    type="button"
                    onClick={onHide}
                    aria-describedby={captionId}
                    data-panel-hide
                    className="relative inline-flex h-9 shrink-0 items-center gap-1 rounded-full border border-[var(--lu-border-strong)] bg-white pl-3.5 pr-2.5 text-sm font-medium text-[var(--lu-text)] after:absolute after:inset-x-0 after:-inset-y-1 after:content-[''] hover:bg-[var(--lu-surface)] hover:text-[var(--lu-accent-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lu-accent-text)] motion-safe:transition-colors print:hidden"
                >
                    Ocultar
                    <ChevronIcon direction={hideToward} className="h-4 w-4" />
                </button>
            </div>
            {wrapTitle(
                <h3
                    // Left off entirely, not set to undefined, when absent: a
                    // dialog title takes its id from Radix, and an undefined
                    // one here would overwrite it.
                    {...(titleId ? { id: titleId } : {})}
                    ref={titleRef}
                    tabIndex={-1}
                    className="mt-1.5 text-xl font-semibold leading-snug text-[var(--lu-text)] focus:outline-none"
                >
                    {panelTitle(state)}
                </h3>,
            )}
            {state.phase === "questions" && state.latest && (
                <div className="mt-2">
                    <RoundProgress round={state.latest.round} headingRef={roundHeadingRef} />
                </div>
            )}
            {/* The icon sits in the first line and the text wraps under it: a
                phone gets a whole line back from the icon's column. */}
            <p className="mt-3 rounded-xl border border-amber-100 bg-amber-50 px-3 py-1.5 text-xs leading-snug text-amber-700">
                <InfoIcon className="mr-1.5 inline-block h-3.5 w-3.5 -translate-y-px align-middle" />
                <span>{disclaimer}</span>
            </p>
        </div>
    );
}

export type QuestionPanelBodyProps = {
    state: QuestionSessionState;
    professional: boolean;
    drafts: Record<string, DraftAnswer>;
    onDraft: (questionId: string, patch: Partial<DraftAnswer>) => void;
    /** When the request now out began, for the wait's seconds. */
    pendingSince: number | null;
    onStart: () => void;
    onSubmit: (drafts: Record<string, DraftAnswer>) => void;
    onFinish: (drafts: Record<string, DraftAnswer>) => void;
    onRetry: () => void;
    /** The results disclaimer, word for word, for the copied summary. */
    disclaimer: string;
    /**
     * The model's list the page showed before the questions, in order: the
     * one the summary lists first, and what every move is measured from.
     */
    originalGenes: string[];
    /** Whether the reader chose the order adjusted by the answers; the summary then adds it, labelled. */
    showAdjusted: boolean;
    /** The place of each gene in the list on screen, by upper-cased symbol. */
    geneRanks: Map<string, number>;
    onOpenGene: (symbol: string) => void;
    /** Puts the refined list in the grid and takes the reader there; null while the panel already offers it above. */
    onShowList: (() => void) | null;
    /** Which way the list lies from the panel, as an arrow; null when the panel covers it. */
    listCue: string | null;
};

/**
 * Puts focus back after a failed request. Sending hides the control that had
 * focus, which drops it to the page; when the request fails and the form comes
 * back, the reader lands where they were, or on the retry, or on the message.
 *
 * The last focused control is tracked as focus moves rather than read when
 * the wait starts: by then it is already hidden and focus has left it.
 */
function useFocusBack(
    busy: boolean,
    failed: boolean,
    retryRef: RefObject<HTMLButtonElement | null>,
    alertRef: RefObject<HTMLDivElement | null>,
) {
    const lastFocused = useRef<HTMLElement | null>(null);
    useEffect(() => {
        if (busy || !failed) return;
        const active = document.activeElement;
        if (active && active !== document.body) return;
        const target = lastFocused.current;
        const usable = (element: HTMLElement | null | undefined): element is HTMLElement =>
            Boolean(element?.isConnected && !element.matches(":disabled") && element.getClientRects().length > 0);
        const next = [target, retryRef.current, alertRef.current].find(usable);
        next?.focus();
    }, [busy, failed, retryRef, alertRef]);
    return (event: FocusEvent<HTMLElement>) => {
        if (event.target instanceof HTMLElement) lastFocused.current = event.target;
    };
}

/**
 * Whether a retry can help yet. A limit that says when to come back holds the
 * button back until then, instead of offering a retry that only earns the
 * same refusal.
 */
function useRetryReady(error: string | null, hold: number | null): boolean {
    const [releasedFor, setReleasedFor] = useState<string | null>(null);
    useEffect(() => {
        setReleasedFor(null);
        if (!error || !hold) return;
        const timer = setTimeout(() => setReleasedFor(error), hold * 1000);
        return () => clearTimeout(timer);
    }, [error, hold]);
    return !hold || releasedFor === error;
}

export function QuestionPanelBody({
    state,
    professional,
    drafts,
    onDraft,
    pendingSince,
    onStart,
    onSubmit,
    onFinish,
    onRetry,
    disclaimer,
    originalGenes,
    showAdjusted,
    geneRanks,
    onOpenGene,
    onShowList,
    listCue,
}: QuestionPanelBodyProps) {
    const { phase, pending, latest, history, error, retryable, retryHold, blocked, refined } = state;
    const busy = pending !== null;
    const retryRef = useRef<HTMLButtonElement | null>(null);
    const alertRef = useRef<HTMLDivElement | null>(null);
    const trackFocus = useFocusBack(busy, error !== null, retryRef, alertRef);
    const retryReady = useRetryReady(error, retryHold);
    const viewMode: QuestionMode = professional ? "medico" : "paciente";
    const warnings = professional ? [...new Set((latest?.warnings ?? []).map(describeWarning))] : [];

    const errorNotice = (withRetry: boolean) =>
        error && !busy ? (
            <ErrorNotice
                message={error}
                alertRef={alertRef}
                retry={
                    withRetry && retryable && retryReady ? (
                        <button ref={retryRef} type="button" onClick={onRetry} className={`${SECONDARY} mt-3`}>
                            Probar de nuevo
                        </button>
                    ) : null
                }
            />
        ) : null;

    // Shown to everyone, unlike the per-warning detail below: a family should
    // know the questions are generic right now, not wonder why they read alike.
    const simpleMode = isSimpleMode(latest?.warnings) ? (
        <div role="status" className="rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3">
            <p className="flex items-center gap-2 text-sm font-semibold text-[var(--lu-text)]">
                <InfoIcon className="h-4 w-4 shrink-0 text-amber-700" />
                Preguntas en modo simple
            </p>
            <p className="mt-1 text-xs leading-relaxed text-[var(--lu-subtle)]">
                Estamos recibiendo muchas consultas, así que por un rato las preguntas se arman con un
                formato estándar en lugar de redactarse para este caso. Siguen siendo válidas y tus
                respuestas se usan igual. Si preferís preguntas más a medida, probá de nuevo más tarde.
            </p>
        </div>
    ) : null;

    const warningList =
        warnings.length > 0 ? (
            <ul className="flex flex-col gap-1">
                {warnings.map((warning) => (
                    <li key={warning} className="flex items-start gap-2 text-xs leading-relaxed text-[var(--lu-subtle)]">
                        <InfoIcon className="mt-px h-3.5 w-3.5 shrink-0" />
                        <span>
                            <span className="font-semibold">Origen del texto:</span> {warning}
                        </span>
                    </li>
                ))}
            </ul>
        ) : null;

    const notices =
        simpleMode || warningList ? (
            <div className="flex flex-col gap-3">
                {simpleMode}
                {warningList}
            </div>
        ) : null;

    // A column at least as tall as the panel, so each state's action bar
    // rests at the panel's foot even when there is little above it.
    return (
        <div onFocus={trackFocus} className="flex flex-1 flex-col">
            <WaitStatus pending={pending} since={pendingSince} />
            {busy && <WaitSkeleton />}

            {phase === "idle" && !blocked && <EntryBody hidden={busy || error !== null} onStart={onStart} />}
            {phase === "idle" && error && !busy && <div className="px-5 py-5">{errorNotice(true)}</div>}

            {phase === "questions" && latest && (
                <RoundForm
                    key={latest.round}
                    round={latest.round}
                    writtenIn={latest.mode}
                    questions={latest.questions}
                    drafts={drafts}
                    onDraft={onDraft}
                    professional={professional}
                    hidden={busy}
                    lead={
                        <>
                            {simpleMode && <div className="px-5 pt-4">{simpleMode}</div>}
                            <RoundLead
                                receipt={
                                    latest.round >= 2 ? (
                                        <RoundReceipt
                                            state={state}
                                            originalGenes={originalGenes}
                                            geneRanks={geneRanks}
                                            onOpenGene={onOpenGene}
                                            onShowList={onShowList}
                                            listCue={listCue}
                                        />
                                    ) : null
                                }
                                modeNote={
                                    latest.mode !== viewMode
                                        ? professional
                                            ? "Esta ronda se escribió para la vista de familias. La próxima ya va a venir con el detalle médico."
                                            : "Esta ronda se escribió para la vista médica, así que te mostramos solo el nombre de cada signo. La próxima se va a escribir para vos."
                                        : null
                                }
                            />
                        </>
                    }
                    notices={warningList ? <div className="px-5 pt-4">{warningList}</div> : null}
                    // No retry here: sending again is the retry, and two buttons
                    // for one thing read as two different things.
                    error={errorNotice(false)}
                    onSubmit={onSubmit}
                    onFinish={onFinish}
                    geneRanks={geneRanks}
                    onOpenGene={onOpenGene}
                />
            )}

            {phase === "finished" && latest && (
                <>
                    {error && <div className="px-5 pt-5">{errorNotice(false)}</div>}
                    <ConsultSummary
                        title={panelTitle(state)}
                        summary={finishedSummary(latest.summary, latest.mode, professional, history.length)}
                        finishNote={
                            latest.finishReason && !(latest.finishReason === "user_finished" && history.length === 0)
                                ? FINISH_COPY[latest.finishReason]
                                : null
                        }
                        changes={sessionChanges(state, "session", originalGenes)}
                        history={history}
                        professional={professional}
                        sheetGenes={sheetGenes(null, originalGenes)}
                        adjustedGenes={showAdjusted && refined && history.length > 0 ? sheetGenes(refined.ranking, originalGenes) : null}
                        notices={notices}
                        disclaimer={disclaimer}
                        geneRanks={geneRanks}
                        onOpenGene={onOpenGene}
                        onShowList={onShowList}
                        listCue={listCue}
                    />
                </>
            )}
        </div>
    );
}

function finishedSummary(summary: string | null, writtenIn: QuestionMode, professional: boolean, answered: number) {
    // Not an invitation to switch views: a parent steered into the clinical
    // text would meet exactly what the family view keeps from them.
    if (summary && writtenIn === "medico" && !professional) {
        return "El resumen se escribió para la vista médica, así que acá no lo mostramos. Llevá la lista y lo que respondiste a la consulta.";
    }
    if (summary) return summary;
    return answered > 0
        ? "Tus respuestas quedaron registradas con esta búsqueda. Llevá la lista de genes y lo que respondiste a la consulta."
        : "No respondiste preguntas, así que la lista quedó como estaba.";
}

/** The model's list as is, or the list with the answers with each gene's place in the model's list. */
function sheetGenes(ranking: RankedGeneRow[] | null, original: string[]): SheetGene[] {
    if (ranking) {
        const symbols = ranking.map(symbolOf);
        const origins = originsIn(original, symbols);
        return symbols.map((symbol, index) => ({ symbol, rank: index + 1, from: origins.get(symbol.toUpperCase()) ?? null }));
    }
    return original.map((symbol, index) => ({ symbol, rank: index + 1 }));
}

function RoundLead({ receipt, modeNote }: { receipt: ReactNode; modeNote: string | null }) {
    return (
        <div className="flex flex-col gap-4 px-5 pt-5">
            {receipt}
            {modeNote && (
                <p data-mode-note className="flex items-start gap-2 text-sm leading-relaxed text-[var(--lu-subtle)]">
                    <InfoIcon className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{modeNote}</span>
                </p>
            )}
            <p className="text-[15px] leading-relaxed text-[var(--lu-text)]">
                Respondé con lo que sepas. No hace falta estar seguro: «No sé» es una respuesta válida.
            </p>
        </div>
    );
}

function RoundReceipt({
    state,
    originalGenes,
    geneRanks,
    onOpenGene,
    onShowList,
    listCue,
}: {
    state: QuestionSessionState;
    originalGenes: string[];
    geneRanks: Map<string, number>;
    onOpenGene: (symbol: string) => void;
    onShowList: (() => void) | null;
    listCue: string | null;
}) {
    const changes = sessionChanges(state, "round", originalGenes);
    if (!changes) return null;
    return (
        <ChangeReceipt
            changes={changes.result}
            caption={changes.caption}
            heading="h5"
            geneRanks={geneRanks}
            onOpenGene={onOpenGene}
            onShowList={onShowList}
            listCue={listCue}
        />
    );
}

function EntryBody({ hidden, onStart }: { hidden: boolean; onStart: () => void }) {
    const facts = [
        { icon: QuestionIcon, text: "3 preguntas por ronda" },
        { icon: RoundsIcon, text: `hasta ${MAX_ROUNDS} rondas` },
        { icon: ClockIcon, text: "≈ 30 s por ronda" },
    ];
    return (
        <div hidden={hidden} className="flex flex-1 flex-col">
            <div className="flex flex-col gap-5 px-5 py-5">
                <p className="text-[15px] leading-relaxed text-[var(--lu-text)]">
                    Te hacemos preguntas de sí o no sobre otras señales. Lo que confirmes con un «Sí» se suma a lo
                    que analiza el modelo; los «No» y los «No sé» quedan anotados para la consulta. Si no sabés algo,
                    «No sé» también es una respuesta.
                </p>
                <ul className="flex flex-wrap gap-1.5" aria-label="Cómo son las preguntas">
                    {facts.map(({ icon: Icon, text }) => (
                        <li
                            key={text}
                            className="inline-flex items-center gap-1.5 rounded-full border border-[var(--lu-border)] bg-[var(--lu-surface)] px-3 py-1 text-[13px] text-[var(--lu-text)]"
                        >
                            <Icon className="h-3.5 w-3.5 text-[var(--lu-subtle)]" />
                            {text}
                        </li>
                    ))}
                </ul>
                <p className="flex items-start gap-2 text-sm leading-relaxed text-[var(--lu-subtle)]">
                    <ShieldIcon className="mt-0.5 h-4 w-4 shrink-0 text-[var(--lu-accent-text)]" />
                    Tu resultado original queda guardado y podés volver a él.
                </p>
            </div>
            <div className={ACTION_BAR}>
                <button type="button" className={`${PRIMARY} w-full`} onClick={onStart}>
                    Empezar las preguntas
                </button>
            </div>
        </div>
    );
}

/**
 * A failure, in slate with an amber mark: its own treatment, so it is never
 * read as the regulatory notice, which owns the amber box.
 */
function ErrorNotice({
    message,
    retry,
    alertRef,
}: {
    message: string;
    retry: ReactNode;
    alertRef: RefObject<HTMLDivElement | null>;
}) {
    return (
        <div
            ref={alertRef}
            role="alert"
            tabIndex={-1}
            className="flex items-start gap-3 rounded-2xl border border-[var(--lu-border)] bg-[var(--lu-surface)] px-4 py-3 focus:outline-none"
        >
            <AlertIcon className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
            <div className="min-w-0 flex-1">
                <p className="text-sm leading-relaxed text-[var(--lu-text)]">{message}</p>
                {retry}
            </div>
        </div>
    );
}
