"use client";

import { useId, useRef, useState } from "react";
import {
    MAX_NOTE_LENGTH,
    questionWording,
    type AnswerValue,
    type DraftAnswer,
    type Question,
    type QuestionMode,
} from "@/lib/questions-api";
import { AnswerSegmented } from "./answer-segmented";
import { GeneChip } from "./gene-chip";
import { CheckIcon, PlusIcon } from "./icons";
import { GHOST } from "./panel-styles";

/**
 * One question of a round: a divided row of the panel, not a card inside it.
 *
 * The medical view adds, under the question, the HPO term it probes, why it
 * is asked and which genes the finding is associated with. The family view shows none
 * of that, whatever arrives: a question framed around a gene reads to a
 * parent as a verdict about their child.
 */
export function QuestionRow({
    index,
    question,
    writtenIn,
    draft,
    professional,
    missing,
    onAnswer,
    onNote,
    geneRanks,
    onOpenGene,
}: {
    index: number;
    question: Question;
    writtenIn: QuestionMode;
    draft: DraftAnswer;
    professional: boolean;
    /** Sending was tried with this one unanswered. */
    missing: boolean;
    onAnswer: (value: AnswerValue, viaPointer: boolean) => void;
    onNote: (note: string) => void;
    geneRanks: Map<string, number>;
    onOpenGene: (symbol: string) => void;
}) {
    const baseId = useId();
    const textId = `${baseId}-texto`;
    const helpId = `${baseId}-ayuda`;
    const missingId = `${baseId}-falta`;
    const wording = questionWording(question, writtenIn, professional);
    const answered = Boolean(draft.answer);
    const describedBy = [wording.help ? helpId : null, missing ? missingId : null].filter(Boolean).join(" ") || undefined;

    return (
        <li
            data-question={question.hpoId}
            data-missing={missing || undefined}
            className="relative scroll-mb-32 scroll-mt-32 px-5 py-6"
        >
            {missing && (
                <span
                    aria-hidden="true"
                    className="absolute inset-y-5 left-0 w-[3px] rounded-r-full bg-[var(--lu-accent-text)]"
                />
            )}
            <div
                role="group"
                aria-labelledby={textId}
                className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 @lg:gap-x-4"
            >
                <span
                    aria-hidden="true"
                    className={`flex h-7 w-7 items-center justify-center rounded-full text-[13px] font-semibold motion-safe:transition-colors ${
                        answered
                            ? "bg-[var(--lu-accent-text)] text-white"
                            : "border border-[var(--lu-border-strong)] bg-white text-[var(--lu-subtle)]"
                    }`}
                >
                    {answered ? <CheckIcon className="h-3.5 w-3.5" /> : index + 1}
                </span>

                <div className="min-w-0 pt-0.5">
                    <p id={textId} className="text-[17px] font-semibold leading-snug text-[var(--lu-text)]">
                        <span className="sr-only">Pregunta {index + 1}: </span>
                        {wording.text}
                    </p>
                    {wording.help && (
                        <p id={helpId} className="mt-1.5 text-sm leading-relaxed text-[var(--lu-subtle)]">
                            {wording.help}
                        </p>
                    )}
                    {missing && (
                        <p id={missingId} className="mt-2 text-sm font-semibold text-[var(--lu-accent-text)]">
                            Falta responder esta
                        </p>
                    )}
                </div>

                <div className="col-span-2 mt-4 flex flex-col gap-4 @lg:col-span-1 @lg:col-start-2">
                    {professional && (
                        <ClinicianLayer question={question} geneRanks={geneRanks} onOpenGene={onOpenGene} />
                    )}
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                        <AnswerSegmented
                            name={`respuesta-${question.id}`}
                            value={draft.answer}
                            onChange={onAnswer}
                            labelledBy={textId}
                            describedBy={describedBy}
                            invalid={missing}
                        />
                        <NoteControl note={draft.note} onChange={onNote} />
                    </div>
                </div>
            </div>
        </li>
    );
}

function ClinicianLayer({
    question,
    geneRanks,
    onOpenGene,
}: {
    question: Question;
    geneRanks: Map<string, number>;
    onOpenGene: (symbol: string) => void;
}) {
    // Only the genes a «Sí» points to. A «No» reaches no list, so whatever
    // the agent names against it would describe an effect that does not
    // happen, even on a round saved before it stopped sending them.
    const associated = question.genesIfYes ?? [];
    const rankOf = (symbol: string) => geneRanks.get(symbol.trim().toUpperCase()) ?? null;

    return (
        <div data-clinician className="flex flex-col gap-2.5 rounded-2xl bg-[var(--lu-surface)] px-4 py-3">
            {/* The id in a pill, as the gene detail shows HPO ids; the label
                beside it as text, since a long one would wrap inside a pill. */}
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="whitespace-nowrap rounded-full border border-[var(--lu-border-strong)] bg-white px-2.5 py-1 font-mono text-[11px] leading-none text-[var(--lu-text)]">
                    {question.hpoId}
                </span>
                <span className="text-sm font-medium text-[var(--lu-text)]">{question.label}</span>
            </p>
            {question.rationale && (
                <p className="text-sm leading-relaxed text-[var(--lu-text)]">
                    <span className="font-semibold">Por qué preguntamos: </span>
                    {question.rationale}
                </p>
            )}
            {associated.length > 0 && (
                <div data-associated-genes className="flex flex-col gap-0.5">
                    <dl className="flex min-h-[44px] flex-wrap items-center gap-x-3 gap-y-1">
                        <dt className="shrink-0 text-sm text-[var(--lu-subtle)]">Asociado a</dt>
                        <dd className="flex flex-wrap gap-1.5">
                            {associated.map((symbol) => (
                                <GeneChip key={symbol} symbol={symbol} rank={rankOf(symbol)} onOpen={onOpenGene} />
                            ))}
                        </dd>
                    </dl>
                    <p className="text-xs leading-relaxed text-[var(--lu-subtle)]">
                        Un «Sí» se suma a los síntomas que usa el modelo.
                    </p>
                </div>
            )}
        </div>
    );
}

/**
 * The optional note: a quiet button until it is wanted, then a box with a
 * counter, then the note itself as a quote that can be edited.
 */
function NoteControl({ note, onChange }: { note: string; onChange: (note: string) => void }) {
    const [editing, setEditing] = useState(false);
    const noteId = useId();
    const counterId = `${noteId}-cuenta`;
    const fieldRef = useRef<HTMLTextAreaElement | null>(null);
    const editRef = useRef<HTMLButtonElement | null>(null);
    const addRef = useRef<HTMLButtonElement | null>(null);

    const open = () => {
        setEditing(true);
        requestAnimationFrame(() => fieldRef.current?.focus());
    };
    const close = () => {
        setEditing(false);
        const written = note.trim().length > 0;
        requestAnimationFrame(() => (written ? editRef.current : addRef.current)?.focus());
    };

    if (editing) {
        return (
            <div className="flex max-w-2xl basis-full flex-col gap-1.5">
                <label htmlFor={noteId} className="text-sm font-semibold text-[var(--lu-text)]">
                    Comentario (opcional)
                </label>
                <textarea
                    ref={fieldRef}
                    id={noteId}
                    value={note}
                    maxLength={MAX_NOTE_LENGTH}
                    rows={3}
                    aria-describedby={counterId}
                    onChange={(event) => onChange(event.target.value)}
                    placeholder="Por ejemplo: desde cuándo, o si alguien te lo dijo."
                    className="w-full rounded-xl border border-[var(--lu-border-strong)] bg-white px-3 py-2.5 text-[15px] leading-relaxed text-[var(--lu-text)] placeholder:text-[var(--lu-subtle)] focus:border-[var(--lu-accent-text)] focus:outline-none focus:ring-2 focus:ring-[var(--lu-accent-light)]"
                />
                <div className="flex items-center gap-3">
                    <span id={counterId} className="font-mono text-[11px] text-[var(--lu-subtle)]">
                        {note.length}/{MAX_NOTE_LENGTH}
                        <span className="sr-only"> caracteres</span>
                    </span>
                    <span className="flex-grow" />
                    <button type="button" onClick={close} className={GHOST}>
                        Listo
                    </button>
                </div>
            </div>
        );
    }

    if (note.trim()) {
        return (
            <div className="flex basis-full items-start gap-3">
                <blockquote className="min-w-0 flex-1 border-l-2 border-[var(--lu-border-strong)] py-1 pl-3 text-[15px] leading-relaxed text-[var(--lu-text)]">
                    <span className="sr-only">Tu comentario: </span>«{note.trim()}»
                </blockquote>
                <button ref={editRef} type="button" onClick={open} className={`${GHOST} -my-2 shrink-0`}>
                    Editar<span className="sr-only"> el comentario</span>
                </button>
            </div>
        );
    }

    return (
        <button ref={addRef} type="button" onClick={open} className={GHOST}>
            <PlusIcon className="h-4 w-4" />
            Agregar un comentario
        </button>
    );
}
