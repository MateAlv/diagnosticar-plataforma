"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
    ADJUSTED_LIST_NOTE,
    GROUP_TITLES,
    associatedGenes,
    buildConsultText,
    describeMove,
    groupAnswers,
    type SessionChanges,
} from "@/lib/question-insights";
import { answerLabel, type AnsweredQuestion, type AnswerValue } from "@/lib/questions-api";
import { ChangeReceipt } from "./change-receipt";
import { GeneChip } from "./gene-chip";
import { CheckIcon, CopyIcon, PrintIcon } from "./icons";
import { ACTION_BAR, PRIMARY, SECONDARY } from "./panel-styles";

/**
 * The end of the questions, and the screen's output: what to bring to the
 * consultation. The summary, what changed, what was answered, and a way to
 * take it along — copied as plain text or printed on its own.
 *
 * The family view groups the answers by what was said and names each finding
 * by its label; the medical view is a table with the HPO id and, for each
 * «Sí», the genes the agent associates with the finding.
 */

/** `from` is its place in the model's list (null: not there); absent on the model's list itself. */
export type SheetGene = { symbol: string; rank: number; from?: number | null };


const CHIP: Record<AnswerValue, string> = {
    si: "bg-[var(--lu-accent-light)] text-[var(--lu-accent-text)]",
    no: "border border-[var(--lu-border-strong)] bg-white text-[var(--lu-text)]",
    no_se: "border border-dashed border-[var(--lu-border-strong)] bg-white text-[var(--lu-text)]",
};

export function ConsultSummary({
    title,
    summary,
    finishNote,
    changes,
    history,
    professional,
    sheetGenes,
    adjustedGenes,
    notices,
    disclaimer,
    geneRanks,
    onOpenGene,
    onShowList,
    listCue,
}: {
    title: string;
    summary: string;
    finishNote: string | null;
    changes: SessionChanges | null;
    history: AnsweredQuestion[];
    professional: boolean;
    /** The model's own list: the sheet's list, whatever the grid shows. */
    sheetGenes: SheetGene[];
    /** The order adjusted by the answers, only when the reader chose to see it. */
    adjustedGenes: SheetGene[] | null;
    notices: ReactNode;
    disclaimer: string;
    geneRanks: Map<string, number>;
    onOpenGene: (symbol: string) => void;
    onShowList: (() => void) | null;
    listCue: string | null;
}) {
    const date = new Date();
    const text = () =>
        buildConsultText({
            title,
            summary,
            finishNote,
            changes,
            history,
            professional,
            genes: sheetGenes.map((gene) => gene.symbol),
            adjustedGenes: adjustedGenes?.map((gene) => gene.symbol) ?? null,
            disclaimer,
            date,
        });

    return (
        <div className="flex flex-1 flex-col">
            <div className="flex flex-col gap-6 px-5 py-5">
                <p className="hidden text-xs text-[var(--lu-subtle)] print:block">
                    Diagnostic.ar · {date.toLocaleDateString("es-AR", { day: "numeric", month: "long", year: "numeric" })}
                </p>

                <div className="rounded-2xl border border-[var(--lu-accent-light)] bg-[color-mix(in_oklab,var(--lu-accent-light)_35%,white)] px-5 py-4">
                    <p data-summary className="text-base leading-relaxed text-[var(--lu-text)]">
                        {summary}
                    </p>
                    {finishNote && (
                        <p className="mt-2 text-sm leading-relaxed text-[var(--lu-subtle)]">{finishNote}</p>
                    )}
                </div>

                {changes && (
                    <ChangeReceipt
                        changes={changes.result}
                        caption={changes.caption}
                        heading="h4"
                        geneRanks={geneRanks}
                        onOpenGene={onOpenGene}
                        onShowList={onShowList}
                        listCue={listCue}
                    />
                )}

                {history.length > 0 && (
                    <section data-answers aria-labelledby="respuestas-titulo">
                        <h4 id="respuestas-titulo" className="text-[15px] font-semibold text-[var(--lu-text)]">
                            Lo que respondiste
                        </h4>
                        {professional ? (
                            <AnswerTable history={history} geneRanks={geneRanks} onOpenGene={onOpenGene} />
                        ) : (
                            <AnswerGroups history={history} />
                        )}
                    </section>
                )}

                <section data-print-genes className="hidden print:block">
                    <h4 className="text-[15px] font-semibold">Genes sugeridos para investigar</h4>
                    <p className="mt-1 text-sm">
                        En el orden original del modelo. El orden es orientativo: el primero no es una respuesta.
                    </p>
                    <PrintedGenes genes={sheetGenes} />
                </section>

                {adjustedGenes && (
                    <section data-print-adjusted className="hidden print:block">
                        <h4 className="text-[15px] font-semibold">Orden con tus respuestas</h4>
                        <p className="mt-1 text-sm">{ADJUSTED_LIST_NOTE}</p>
                        <PrintedGenes genes={adjustedGenes} />
                    </section>
                )}

                {notices}
            </div>

            <SheetActions text={text} />
        </div>
    );
}

function PrintedGenes({ genes }: { genes: SheetGene[] }) {
    return (
        <ol className={`mt-2 gap-8 text-sm ${genes.length > 8 ? "columns-3" : ""}`}>
            {genes.map((gene) => (
                <li key={gene.symbol} className="break-inside-avoid py-0.5">
                    <span className="font-mono">
                        {gene.rank}. {gene.symbol}
                    </span>
                    {gene.from !== undefined && gene.from !== gene.rank && (
                        <span className="text-[var(--lu-subtle)]"> ({describeMove(gene.from, gene.rank).text})</span>
                    )}
                </li>
            ))}
        </ol>
    );
}

function AnswerGroups({ history }: { history: AnsweredQuestion[] }) {
    const groups = groupAnswers(history);
    const order: AnswerValue[] = ["si", "no", "no_se"];
    return (
        <div className="mt-3 grid gap-5 @lg:grid-cols-3 @lg:gap-6">
            {order
                .filter((answer) => groups[answer].length > 0)
                .map((answer) => (
                    <div key={answer} className="min-w-0">
                        <h5 className="text-sm font-medium text-[var(--lu-subtle)]">
                            {GROUP_TITLES[answer]}
                            <span className="font-mono text-[11px]"> · {groups[answer].length}</span>
                        </h5>
                        <ul className="mt-2 flex flex-col items-start gap-2">
                            {groups[answer].map((item) => (
                                <li key={item.question.hpoId} className="flex max-w-full flex-col items-start gap-1">
                                    <span className={`rounded-full px-3 py-1.5 text-sm leading-tight ${CHIP[answer]}`}>
                                        {item.question.label}
                                    </span>
                                    {item.note && (
                                        <span className="border-l-2 border-[var(--lu-border-strong)] pl-2.5 text-sm leading-relaxed text-[var(--lu-text)]">
                                            <span className="sr-only">Tu comentario: </span>«{item.note}»
                                        </span>
                                    )}
                                    {item.effectiveAnswer !== item.answer && (
                                        <span className="text-xs leading-relaxed text-[var(--lu-subtle)]">
                                            Marcaste «{answerLabel(item.answer)}»; por tu comentario lo tomamos como «
                                            {answerLabel(item.effectiveAnswer)}».
                                        </span>
                                    )}
                                </li>
                            ))}
                        </ul>
                    </div>
                ))}
        </div>
    );
}

function AnswerTable({
    history,
    geneRanks,
    onOpenGene,
}: {
    history: AnsweredQuestion[];
    geneRanks: Map<string, number>;
    onOpenGene: (symbol: string) => void;
}) {
    const cell = "@lg:py-2.5 @lg:pr-4 @lg:align-middle";
    return (
        <div className="mt-3 rounded-2xl border border-[var(--lu-border)] px-4 @lg:px-5">
            <table className="w-full border-collapse text-left text-sm text-[var(--lu-text)]">
                <caption className="sr-only">Respuestas, con el término HPO y, para cada «Sí», los genes asociados</caption>
                <thead className="@max-lg:sr-only">
                    <tr className="border-b border-[var(--lu-border)] text-xs text-[var(--lu-subtle)]">
                        <th scope="col" className="py-2.5 pr-4 font-medium">HPO</th>
                        <th scope="col" className="py-2.5 pr-4 font-medium">Término</th>
                        <th scope="col" className="py-2.5 pr-4 font-medium">Respuesta</th>
                        <th scope="col" className="py-2.5 pr-4 font-medium">Nota</th>
                        <th scope="col" className="py-2.5 font-medium">Asociado a</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-[var(--lu-border)]">
                    {history.map((item) => {
                        const genes = associatedGenes(item);
                        return (
                            <tr
                                key={item.question.hpoId}
                                className="@max-lg:grid @max-lg:grid-cols-[minmax(0,1fr)_auto] @max-lg:gap-x-3 @max-lg:gap-y-1.5 @max-lg:py-3"
                            >
                                <td className={`${cell} whitespace-nowrap font-mono text-[12px] text-[var(--lu-subtle)] @max-lg:col-span-2`}>
                                    {item.question.hpoId}
                                </td>
                                <td className={`${cell} font-medium`}>{item.question.label}</td>
                                <td className={`${cell} whitespace-nowrap font-semibold @max-lg:text-right`}>
                                    {answerLabel(item.effectiveAnswer)}
                                    {item.effectiveAnswer !== item.answer && (
                                        <span className="block text-xs font-normal text-[var(--lu-subtle)]">
                                            marcó «{answerLabel(item.answer)}», leído por la nota
                                        </span>
                                    )}
                                </td>
                                <td className={`${cell} @max-lg:col-span-2`}>
                                    {item.note ? (
                                        <span className="leading-relaxed">«{item.note}»</span>
                                    ) : (
                                        <span className="text-[var(--lu-subtle)] @max-lg:hidden">—</span>
                                    )}
                                </td>
                                <td className="@max-lg:col-span-2 @lg:py-2 @lg:align-middle">
                                    {genes.length > 0 ? (
                                        <span className="flex flex-wrap gap-1.5">
                                            <span className="sr-only @lg:hidden">Asociado a: </span>
                                            {genes.map((symbol) => (
                                                <GeneChip
                                                    key={symbol}
                                                    symbol={symbol}
                                                    rank={geneRanks.get(symbol.toUpperCase()) ?? null}
                                                    onOpen={onOpenGene}
                                                />
                                            ))}
                                        </span>
                                    ) : (
                                        <span className="text-[var(--lu-subtle)] @max-lg:hidden">—</span>
                                    )}
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}

/** How long "Copiado" stays before the button goes back to what it was. */
const COPIED_MS = 6_000;

function SheetActions({ text }: { text: () => string }) {
    const [status, setStatus] = useState<"idle" | "copied" | "manual">("idle");
    const [manualText, setManualText] = useState("");
    const manualRef = useRef<HTMLTextAreaElement | null>(null);

    useEffect(() => {
        if (status !== "copied") return;
        const timer = setTimeout(() => setStatus("idle"), COPIED_MS);
        return () => clearTimeout(timer);
    }, [status]);

    useEffect(() => {
        if (status === "manual") manualRef.current?.select();
    }, [status]);

    const copy = async () => {
        const value = text();
        if (await writeClipboard(value)) {
            setStatus("copied");
            return;
        }
        setManualText(value);
        setStatus("manual");
    };

    return (
        <>
            {status === "manual" && (
                <div className="px-5 pb-5 print:hidden">
                    <textarea
                        ref={manualRef}
                        readOnly
                        value={manualText}
                        rows={8}
                        aria-label="Resumen para copiar"
                        className="w-full rounded-xl border border-[var(--lu-border-strong)] bg-[var(--lu-surface)] px-3 py-2 font-mono text-xs leading-relaxed text-[var(--lu-text)]"
                    />
                </div>
            )}
            {/* Pinned like the send bar: the summary is long, and taking it
                along is what the reader came to the end for. */}
            <div data-sheet-actions className={ACTION_BAR}>
                <div className="grid grid-cols-2 gap-2">
                    <button type="button" className={`${PRIMARY} px-3`} onClick={copy}>
                        {status === "copied" ? <CheckIcon className="h-4 w-4" /> : <CopyIcon className="h-4 w-4" />}
                        {status === "copied" ? "Resumen copiado" : "Copiar resumen"}
                    </button>
                    <button
                        type="button"
                        className={`${SECONDARY} px-3`}
                        onClick={(event) => {
                            const panel = event.currentTarget.closest<HTMLElement>("[data-question-panel]");
                            if (panel) printOnly(panel);
                        }}
                    >
                        <PrintIcon className="h-4 w-4" />
                        Imprimir
                    </button>
                </div>
                <p aria-live="polite" className="text-sm leading-snug text-[var(--lu-subtle)] [&:not(:empty)]:mt-2">
                    {status === "copied" && "Copiamos el resumen. Podés pegarlo en un mensaje o en tus notas."}
                    {status === "manual" && "No pudimos copiarlo solo. Está seleccionado arriba: copialo desde ahí."}
                </p>
            </div>
        </>
    );
}

/** The clipboard API where it is allowed, the older command where it is not. */
async function writeClipboard(value: string): Promise<boolean> {
    try {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(value);
            return true;
        }
    } catch {
        // Denied or unavailable (an insecure origin, an embedded frame): try the old way.
    }
    const scratch = document.createElement("textarea");
    scratch.value = value;
    scratch.setAttribute("readonly", "");
    scratch.style.position = "fixed";
    scratch.style.opacity = "0";
    document.body.appendChild(scratch);
    scratch.select();
    let copied = false;
    try {
        copied = document.execCommand("copy");
    } catch {
        copied = false;
    }
    scratch.remove();
    return copied;
}

/**
 * Prints `root` alone: everything beside it on the way up to <body> is marked
 * out of print, and the containers it sits in drop their own padding and
 * frame. The marks come off once the print dialog closes.
 */
function printOnly(root: HTMLElement) {
    const hidden: HTMLElement[] = [];
    const path: HTMLElement[] = [];
    let node: HTMLElement = root;
    while (node.parentElement && node !== document.body) {
        const parent: HTMLElement = node.parentElement;
        for (const sibling of Array.from(parent.children)) {
            if (sibling !== node && sibling instanceof HTMLElement) {
                sibling.setAttribute("data-print-hidden", "");
                hidden.push(sibling);
            }
        }
        if (parent !== document.body) {
            parent.setAttribute("data-print-path", "");
            path.push(parent);
        }
        node = parent;
    }
    const restore = () => {
        window.removeEventListener("afterprint", restore);
        for (const element of hidden) element.removeAttribute("data-print-hidden");
        for (const element of path) element.removeAttribute("data-print-path");
    };
    window.addEventListener("afterprint", restore);
    window.print();
}
