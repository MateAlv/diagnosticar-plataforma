"use client";

import { RERANK_NOTE, droppedSentence, type ListChanges, type RankMove } from "@/lib/question-insights";
import { MovePill } from "./move-pill";
import { TEXT_LINK } from "./panel-styles";

/**
 * "Qué cambió con tus respuestas": how the list with the answers differs,
 * shown where the reader is rather than six screens up in the grid.
 *
 * It speaks of places in the list, never of likelihood, and credits no move
 * to any one answer: the model ranked again with the confirmed findings
 * added, and that is what it says.
 */
export function ChangeReceipt({
    changes,
    caption,
    heading: Heading,
    geneRanks,
    onOpenGene,
    onShowList,
    listCue,
}: {
    changes: ListChanges;
    /** What the list is compared against: the original, or the one before. */
    caption: string;
    heading: "h4" | "h5";
    geneRanks: Map<string, number>;
    onOpenGene: (symbol: string) => void;
    /** Null leaves the link out, where the panel already offers it just above. */
    onShowList: (() => void) | null;
    /** Which way the list lies from the panel, as an arrow; null when the panel covers it. */
    listCue: string | null;
}) {
    const items: RankMove[] = [...changes.moves, ...(changes.steadyTop ? [changes.steadyTop] : [])];
    const more = changes.movedCount - changes.moves.length;
    const left = droppedSentence(changes.dropped);

    return (
        <section
            data-change-receipt
            aria-labelledby="que-cambio-titulo"
            className="rounded-2xl border border-[var(--lu-accent-light)] bg-[var(--lu-surface)] px-4 py-3.5"
        >
            <div className="flex flex-wrap items-center gap-x-4">
                <div className="min-w-[13rem] flex-1 py-1">
                    <Heading id="que-cambio-titulo" className="text-[15px] font-semibold text-[var(--lu-text)]">
                        Qué cambió con tus respuestas
                    </Heading>
                    <p className="text-xs text-[var(--lu-subtle)]">{caption}</p>
                    <p data-rerank-note className="mt-1.5 text-sm leading-snug text-[var(--lu-text)]">
                        {RERANK_NOTE}
                    </p>
                </div>
                {onShowList && (
                    <button type="button" onClick={onShowList} className={`${TEXT_LINK} print:hidden`}>
                        <span>
                            Ver la lista con tus respuestas
                            {listCue && <span aria-hidden="true"> {listCue}</span>}
                        </span>
                    </button>
                )}
            </div>

            {changes.movedCount === 0 && (
                <p className="mt-1 text-sm text-[var(--lu-text)]">Ningún gen cambió de lugar con estas respuestas.</p>
            )}

            {items.length > 0 && (
                <ul className="mt-2 flex flex-wrap gap-2">
                    {items.map((move) => (
                        <li key={move.symbol} className="flex">
                            <MoveItem move={move} rank={geneRanks.get(move.symbol.toUpperCase()) ?? null} onOpen={onOpenGene} />
                        </li>
                    ))}
                </ul>
            )}

            {more > 0 && (
                <p className="mt-2 text-xs text-[var(--lu-subtle)]">
                    {more === 1 ? "Otro gen también cambió de lugar." : `Otros ${more} genes también cambiaron de lugar.`}
                </p>
            )}

            {left && (
                <p data-dropped className="mt-2 text-xs text-[var(--lu-subtle)]">
                    {left}
                </p>
            )}
        </section>
    );
}

function MoveItem({ move, rank, onOpen }: { move: RankMove; rank: number | null; onOpen: (symbol: string) => void }) {
    const content = (
        <>
            <span className="font-mono text-[13px] font-medium text-[var(--lu-text)]">{move.symbol}</span>
            <MovePill from={move.from} to={move.to} />
        </>
    );
    // 36px to the eye; the ::after takes the target to 44px.
    const shape =
        "relative inline-flex h-9 items-center gap-2 rounded-full border border-[var(--lu-border)] bg-white pl-3 pr-1.5 after:absolute after:inset-x-0 after:-inset-y-1 after:content-['']";
    if (rank === null) return <span className={shape}>{content}</span>;
    return (
        <button
            type="button"
            onClick={() => onOpen(move.symbol)}
            aria-haspopup="dialog"
            className={`${shape} hover:border-[var(--lu-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lu-accent-text)] motion-safe:transition-colors`}
        >
            <span className="sr-only">Ver el gen </span>
            {content}
        </button>
    );
}
