"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useRef } from "react";
import { type GeneProfile } from "@/lib/genes-api";
import { GeneDetail } from "./gene-detail";

/**
 * A gene's full detail, over the grid.
 *
 * Previous and next step through the ranking without closing, so comparing
 * candidates does not mean finding each card again. Radix supplies the focus
 * trap, Escape, the scroll lock and the return of focus to the card.
 */

export type RankedEntry = { symbol: string; rank: number; score: number };

export type GeneModalProps = {
    entries: RankedEntry[];
    openSymbol: string | null;
    onOpenSymbol: (symbol: string | null) => void;
    profiles: Map<string, GeneProfile>;
    professional: boolean;
    reportedWords: Map<string, string>;
};

const NAV =
    "flex min-h-[44px] items-center gap-1 rounded-xl border border-[var(--lu-border-strong)] bg-white px-3.5 text-sm font-medium text-[var(--lu-text)] hover:bg-[var(--lu-surface)] disabled:cursor-not-allowed disabled:opacity-40";

export function GeneModal({
    entries,
    openSymbol,
    onOpenSymbol,
    profiles,
    professional,
    reportedWords,
}: GeneModalProps) {
    const index = entries.findIndex((entry) => entry.symbol === openSymbol);
    const entry = index >= 0 ? entries[index] : null;
    const previous = index > 0 ? entries[index - 1] : null;
    const next = index >= 0 && index < entries.length - 1 ? entries[index + 1] : null;
    // By the time focus is restored the modal has closed and `entry` is null.
    const lastShown = useRef<string | null>(null);
    if (entry) lastShown.current = entry.symbol;

    return (
        <Dialog.Root open={entry !== null} onOpenChange={(open) => !open && onOpenSymbol(null)}>
            <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm motion-safe:animate-[modal-fade_.2s_ease]" />
                <Dialog.Content
                    aria-describedby={undefined}
                    // Back to the card of the gene last shown, which after
                    // stepping through is not the one that opened the modal.
                    onCloseAutoFocus={(event) => {
                        const symbol = lastShown.current;
                        const card = symbol
                            ? document.querySelector<HTMLElement>(
                                  `[data-gene-card="${CSS.escape(symbol)}"]`,
                              )
                            : null;
                        if (card) {
                            event.preventDefault();
                            card.focus();
                        }
                    }}
                    className="fixed inset-0 z-50 flex flex-col bg-white shadow-2xl motion-safe:animate-[modal-fade_.2s_ease] sm:inset-auto sm:left-1/2 sm:top-1/2 sm:max-h-[90vh] sm:w-[min(1100px,calc(100vw-48px))] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-3xl"
                >
                    {entry && (
                        <>
                            <div className="flex items-center gap-2 border-b border-[var(--lu-border)] px-4 py-3 sm:px-6">
                                {/* Not a heading: the detail below already has one. */}
                                <Dialog.Title asChild>
                                    <span className="sr-only">Gen {entry.symbol}</span>
                                </Dialog.Title>
                                <button
                                    type="button"
                                    className={NAV}
                                    disabled={!previous}
                                    onClick={() => previous && onOpenSymbol(previous.symbol)}
                                    aria-label={previous ? `Gen anterior, ${previous.symbol}` : "Gen anterior"}
                                >
                                    <span aria-hidden="true">←</span>
                                    <span className="hidden sm:inline">Anterior</span>
                                </button>
                                <button
                                    type="button"
                                    className={NAV}
                                    disabled={!next}
                                    onClick={() => next && onOpenSymbol(next.symbol)}
                                    aria-label={next ? `Gen siguiente, ${next.symbol}` : "Gen siguiente"}
                                >
                                    <span className="hidden sm:inline">Siguiente</span>
                                    <span aria-hidden="true">→</span>
                                </button>
                                <span className="flex-grow" />
                                <Dialog.Close
                                    className="flex h-11 w-11 items-center justify-center rounded-xl text-lg text-[var(--lu-subtle)] hover:bg-[var(--lu-surface)] hover:text-[var(--lu-text)]"
                                    aria-label="Cerrar"
                                >
                                    ✕
                                </Dialog.Close>
                            </div>
                            <div className="flex min-h-0 flex-1 overflow-y-auto">
                                <GeneDetail
                                    key={entry.symbol}
                                    symbol={entry.symbol}
                                    rank={entry.rank}
                                    total={entries.length}
                                    score={entry.score}
                                    profile={profiles.get(entry.symbol.toUpperCase()) ?? null}
                                    professional={professional}
                                    reportedWords={reportedWords}
                                />
                            </div>
                        </>
                    )}
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
