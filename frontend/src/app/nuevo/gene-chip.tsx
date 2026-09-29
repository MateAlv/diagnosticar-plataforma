"use client";

/**
 * A gene named inside the question panel, with its place in the list on
 * screen. It opens the gene's detail, as the ones under each speciality do; a
 * gene the list does not hold has no detail to open and stays plain text.
 */
export function GeneChip({
    symbol,
    rank,
    onOpen,
}: {
    symbol: string;
    rank: number | null;
    onOpen: (symbol: string) => void;
}) {
    if (rank === null) {
        return (
            <span className="inline-flex h-7 items-center px-1 font-mono text-[12px] text-[var(--lu-subtle)]">
                {symbol}
            </span>
        );
    }
    return (
        <button
            type="button"
            onClick={() => onOpen(symbol)}
            aria-haspopup="dialog"
            aria-label={`Ver el gen ${symbol}, puesto ${rank} en la lista`}
            data-gene-chip={symbol}
            // The visible chip is 28px; the ::after stretches the target to
            // 44px without spreading the rows apart.
            className="relative inline-flex h-7 items-center gap-1 rounded-full border border-[var(--lu-border-strong)] bg-white px-2.5 font-mono text-[12px] text-[var(--lu-text)] after:absolute after:inset-x-0 after:-inset-y-2 after:content-[''] hover:border-[var(--lu-accent)] hover:bg-[var(--lu-accent-light)] hover:text-[var(--lu-accent-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lu-accent-text)] motion-safe:transition-colors"
        >
            {symbol}
            <span className="text-[var(--lu-subtle)]">#{rank}</span>
        </button>
    );
}
