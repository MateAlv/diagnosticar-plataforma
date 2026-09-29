"use client";

import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from "react";
import {
    canSubmitRound,
    type AnswerValue,
    type DraftAnswer,
    type Question,
    type QuestionMode,
} from "@/lib/questions-api";
import { InfoIcon } from "./icons";
import { ACTION_BAR, PRIMARY, SECONDARY, GHOST, panelScroller, scrollInPanel } from "./panel-styles";
import { QuestionRow } from "./question-row";

const EMPTY: DraftAnswer = { answer: null, note: "" };

/**
 * One round's questions and the bar that sends them.
 *
 * Sending never looks disabled. Tried with a gap, it takes the reader to the
 * first unanswered question and marks every one still open, which a pointer
 * user can see and a screen reader hears.
 *
 * The bar sticks to the bottom of the panel while the round is in it, and
 * holds only the send button: the panel is phone-narrow at every width, so
 * "Terminar acá" follows the last question instead.
 *
 * The answers are kept by the caller, not here: hiding the panel unmounts
 * the form, and they have to be where the reader left them when it is back.
 */
export function RoundForm({
    round,
    writtenIn,
    questions,
    drafts,
    onDraft,
    professional,
    hidden,
    lead,
    notices,
    error,
    onSubmit,
    onFinish,
    geneRanks,
    onOpenGene,
}: {
    round: number;
    writtenIn: QuestionMode;
    questions: Question[];
    drafts: Record<string, DraftAnswer>;
    onDraft: (questionId: string, patch: Partial<DraftAnswer>) => void;
    professional: boolean;
    /** While a request is out the round steps aside for the wait, keeping its answers. */
    hidden: boolean;
    /** What opens the round: what changed, how to answer. */
    lead: ReactNode;
    /** Shown after the questions: where the round's text came from, for the medical view. */
    notices: ReactNode;
    /** A failed send, shown in the bar where the reader pressed. */
    error: ReactNode;
    onSubmit: (drafts: Record<string, DraftAnswer>) => void;
    onFinish: (drafts: Record<string, DraftAnswer>) => void;
    geneRanks: Map<string, number>;
    onOpenGene: (symbol: string) => void;
}) {
    const [showMissing, setShowMissing] = useState(false);
    const [confirming, setConfirming] = useState(false);
    const [announcement, setAnnouncement] = useState("");
    const listRef = useRef<HTMLOListElement | null>(null);
    const barRef = useRef<HTMLDivElement | null>(null);
    const markerRef = useRef<HTMLDivElement | null>(null);
    const stuck = useStuck(markerRef);
    const answeredCount = questions.filter((question) => drafts[question.id]?.answer).length;
    const ready = canSubmitRound(questions, drafts);

    const rowOf = (question: Question) =>
        listRef.current?.querySelector<HTMLElement>(`[data-question="${CSS.escape(question.hpoId)}"]`) ?? null;

    const answer = (index: number, value: AnswerValue, viaPointer: boolean) => {
        const question = questions[index];
        const first = !drafts[question.id]?.answer;
        onDraft(question.id, { answer: value });
        if (!first || !viaPointer) return;
        const next = questions.slice(index + 1).find((q) => !drafts[q.id]?.answer);
        if (next) requestAnimationFrame(() => revealIfHidden(rowOf(next), barRef.current));
    };

    const flagMissing = () => {
        const missing = questions.filter((question) => !drafts[question.id]?.answer);
        const first = missing[0];
        if (!first) return;
        setShowMissing(true);
        // Emptied first so the same sentence is announced again on a second try.
        setAnnouncement("");
        requestAnimationFrame(() => {
            setAnnouncement(
                missing.length === 1
                    ? "Te falta responder 1 pregunta."
                    : `Te falta responder ${missing.length} preguntas.`,
            );
            const row = rowOf(first);
            if (row) scrollInPanel(row, "center");
            row?.querySelector<HTMLInputElement>('input[type="radio"]')?.focus({ preventScroll: true });
        });
    };

    const terminate = (
        <TerminateControl
            confirming={confirming}
            detail={
                answeredCount === 0
                    ? null
                    : ready
                      ? " Esta ronda también se envía."
                      : " Esta ronda quedó incompleta, así que no se envía."
            }
            onAsk={() => setConfirming(true)}
            onCancel={() => setConfirming(false)}
            onConfirm={() => {
                setConfirming(false);
                onFinish(drafts);
            }}
        />
    );

    return (
        <form
            hidden={hidden}
            aria-label={`Preguntas de la ronda ${round}`}
            className="flex flex-1 flex-col"
            onSubmit={(event) => {
                event.preventDefault();
                if (ready) onSubmit(drafts);
                else flagMissing();
            }}
        >
            {lead}

            <ol ref={listRef} className="divide-y divide-[var(--lu-border)] border-b border-[var(--lu-border)]">
                {questions.map((question, index) => (
                    <QuestionRow
                        key={question.id}
                        index={index}
                        question={question}
                        writtenIn={writtenIn}
                        draft={drafts[question.id] ?? EMPTY}
                        professional={professional}
                        missing={showMissing && !drafts[question.id]?.answer}
                        onAnswer={(value, viaPointer) => answer(index, value, viaPointer)}
                        onNote={(note) => onDraft(question.id, { note })}
                        geneRanks={geneRanks}
                        onOpenGene={onOpenGene}
                    />
                ))}
            </ol>

            {notices}

            <div className="px-5 py-4">{terminate}</div>

            <div
                ref={barRef}
                data-action-bar
                className={`${ACTION_BAR} flex flex-col gap-3 motion-safe:transition-shadow ${
                    stuck ? "shadow-[0_-12px_24px_-18px_rgba(15,23,42,0.45)]" : ""
                }`}
            >
                {error}
                <div className="flex items-center gap-3">
                    <button type="submit" className={`${PRIMARY} w-full`}>
                        Enviar respuestas
                        <span aria-hidden="true" className="font-normal text-white/80">
                            ·
                        </span>
                        <span className="sr-only">,</span>
                        <span className="font-normal tabular-nums">
                            {answeredCount} de {questions.length}
                        </span>
                    </button>
                </div>
            </div>
            <div ref={markerRef} aria-hidden="true" />

            <p aria-live="polite" className="sr-only">
                {announcement}
            </p>
        </form>
    );
}

/**
 * "Terminar acá", which asks once in place before ending: ending is final,
 * and an accidental tap in round 1 would otherwise close the loop for good.
 */
function TerminateControl({
    confirming,
    detail,
    onAsk,
    onCancel,
    onConfirm,
}: {
    confirming: boolean;
    detail: string | null;
    onAsk: () => void;
    onCancel: () => void;
    onConfirm: () => void;
}) {
    const promptId = useId();
    const promptRef = useRef<HTMLParagraphElement | null>(null);
    const askRef = useRef<HTMLButtonElement | null>(null);
    const wasConfirming = useRef(false);

    useEffect(() => {
        if (confirming) promptRef.current?.focus();
        else if (wasConfirming.current) askRef.current?.focus();
        wasConfirming.current = confirming;
    }, [confirming]);

    if (!confirming) {
        return (
            <button ref={askRef} type="button" className={`${SECONDARY} w-full`} onClick={onAsk}>
                Terminar acá
            </button>
        );
    }

    return (
        <div role="group" aria-labelledby={promptId} className="flex flex-col gap-3">
            <p
                ref={promptRef}
                id={promptId}
                tabIndex={-1}
                className="flex items-start gap-2 text-sm leading-snug text-[var(--lu-text)] focus:outline-none"
            >
                <InfoIcon className="mt-0.5 h-4 w-4 shrink-0 text-[var(--lu-subtle)]" />
                <span>
                    <strong className="font-semibold">¿Terminar ahora?</strong> Vas a ver el resumen con lo que
                    respondiste.{detail}
                </span>
            </p>
            <div className="grid grid-cols-2 gap-2">
                <button type="button" className={`${SECONDARY} whitespace-nowrap px-3`} onClick={onConfirm}>
                    Sí, terminar
                </button>
                <button type="button" className={`${GHOST} justify-center whitespace-nowrap`} onClick={onCancel}>
                    Seguir respondiendo
                </button>
            </div>
        </div>
    );
}

/**
 * Brings the next question into the panel's view when it is not, clear of the
 * sticky bar. Judged by its answers, which are what the reader needs to reach.
 */
function revealIfHidden(row: HTMLElement | null, bar: HTMLElement | null) {
    if (!row) return;
    const target = row.querySelector<HTMLElement>('[role="radiogroup"]') ?? row;
    const rect = target.getBoundingClientRect();
    const view = panelScroller(row)?.getBoundingClientRect() ?? { top: 0, bottom: window.innerHeight };
    const top = Math.max(view.top, 0);
    const bottom = Math.min(view.bottom, window.innerHeight) - (bar?.getBoundingClientRect().height ?? 0);
    if (rect.top >= top && rect.bottom <= bottom) return;
    scrollInPanel(row, "center");
}

/**
 * Whether the bar is pinned to the bottom of the panel, which is when it
 * needs a shadow to separate it from the questions scrolling under it. Read
 * off a marker at the bar's own place in the round: below the panel's view,
 * the bar is pinned.
 */
function useStuck(markerRef: RefObject<HTMLDivElement | null>) {
    const [stuck, setStuck] = useState(false);
    useEffect(() => {
        const marker = markerRef.current;
        if (!marker || typeof IntersectionObserver === "undefined") return;
        const root = panelScroller(marker);
        const observer = new IntersectionObserver(
            ([entry]) => {
                const below = entry.boundingClientRect.top > (entry.rootBounds?.bottom ?? window.innerHeight);
                setStuck(!entry.isIntersecting && below);
            },
            { root },
        );
        observer.observe(marker);
        return () => observer.disconnect();
    }, [markerRef]);
    return stuck;
}
