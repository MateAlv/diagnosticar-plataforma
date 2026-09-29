"use client";

import { describeMove } from "@/lib/question-insights";

/**
 * A gene's move in the list: "↑ 3.º → 2.º", or "nuevo" for one the earlier
 * list did not have. Up and new are in the accent, down is quiet grey, and
 * nothing is red — a gene moving down is not bad news.
 *
 * The arrows and ordinals are hidden from screen readers, which get the
 * sentence instead.
 */
export function MovePill({
    from,
    to,
    title,
    rankNote = false,
}: {
    /** Its place in the earlier list; null when that list did not have it. */
    from: number | null;
    to: number;
    title?: string;
    /** Marks the pill as a card's rank note, where the original list shows the score. */
    rankNote?: boolean;
}) {
    const move = describeMove(from, to);
    const tone =
        move.direction === "up" || move.direction === "new"
            ? "bg-[color-mix(in_oklab,var(--lu-accent-light)_55%,white)] text-[var(--lu-accent-text)] ring-[var(--lu-accent-light)]"
            : "bg-[var(--lu-surface)] text-[var(--lu-subtle)] ring-[var(--lu-border)]";
    return (
        <>
            <span
                aria-hidden="true"
                title={title}
                data-rank-note={rankNote || undefined}
                data-direction={move.direction}
                className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold tabular-nums ring-1 ${tone}`}
            >
                {move.text}
            </span>
            <span className="sr-only">{move.label}</span>
        </>
    );
}
