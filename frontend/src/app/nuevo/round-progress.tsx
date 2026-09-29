"use client";

import type { RefObject } from "react";
import { MAX_ROUNDS } from "@/lib/questions-api";

/**
 * Where the reader is in the loop, in the match meter's own idiom: one
 * segment per round, filled up to this one. "de 3" is a ceiling, not a
 * target — the loop can end sooner, and any round can be the last.
 *
 * The legend is the round's heading and takes focus when a round arrives.
 */
export function RoundProgress({
    round,
    headingRef,
}: {
    round: number;
    headingRef: RefObject<HTMLHeadingElement | null>;
}) {
    const filled = Math.min(Math.max(round, 1), MAX_ROUNDS);
    return (
        <div className="flex shrink-0 items-center gap-2.5">
            <span aria-hidden="true" className="flex gap-[3px]">
                {Array.from({ length: MAX_ROUNDS }, (_, index) => (
                    <span
                        key={index}
                        className={`h-2 w-[26px] rounded-full ${
                            index < filled
                                ? "bg-[var(--lu-accent-text)]"
                                : "bg-[var(--lu-border-strong)]"
                        }`}
                    />
                ))}
            </span>
            <h4
                ref={headingRef}
                tabIndex={-1}
                className="whitespace-nowrap text-sm font-semibold text-[var(--lu-text)] focus:outline-none"
            >
                Ronda {round} de {MAX_ROUNDS}
            </h4>
        </div>
    );
}
