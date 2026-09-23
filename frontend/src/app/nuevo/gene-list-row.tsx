"use client";

import { type GeneProfile } from "@/lib/genes-api";
import { MatchMeter, MeterCaption, meterState } from "./match-meter";

/**
 * One gene in the left-hand list on a wide screen.
 *
 * Compact enough that the set stays visible while one candidate is open beside
 * it — the accuracy claim is about the set of 20, so the reader has to be able
 * to see it. Selecting a row swaps the detail pane; it never navigates away.
 *
 * Genes with no overlap, and genes we cannot compare at all, collapse to a
 * single line: they stay in the list because being in the set is the claim,
 * but they do not need the same room as a candidate that engages the report.
 */

export type GeneListRowProps = {
    symbol: string;
    rank: number;
    total: number;
    score: number;
    profile: GeneProfile | null;
    professional: boolean;
    reportedWords: Map<string, string>;
    selected: boolean;
    onSelect: () => void;
};

export function GeneListRow({
    symbol,
    rank,
    total,
    score,
    profile,
    professional,
    reportedWords,
    selected,
    onSelect,
}: GeneListRowProps) {
    const covered = profile?.reportados_cubiertos?.length ?? 0;
    const reported = reportedWords.size;
    const totalExpected = profile?.total_esperados ?? 0;
    const state = meterState(covered, totalExpected);

    const coveredWords = (profile?.reportados_cubiertos ?? [])
        .map((id) => reportedWords.get(id.toUpperCase()))
        .filter((word): word is string => Boolean(word));

    // A row that engages nothing is one line; there is nothing to summarise.
    const compact = state !== "match";

    return (
        <li>
            <button
                type="button"
                onClick={onSelect}
                aria-current={selected ? "true" : undefined}
                // The hover lifts the row a hair and warms its border. Kept
                // subtle deliberately: twenty of these are on screen at once,
                // and the selected row has to stay the loudest thing in the
                // list. Motion is dropped for anyone who asked for less of it.
                className={`flex w-full flex-col gap-2 rounded-2xl border px-3.5 py-3 text-left transition-all duration-150 motion-safe:hover:-translate-y-px ${
                    selected
                        ? "border-2 border-[var(--lu-accent)] bg-[var(--lu-accent-light)]/30"
                        : state === "match"
                          ? "border-[var(--lu-accent-light)] bg-white hover:border-[var(--lu-accent)] hover:bg-[var(--lu-surface)] hover:shadow-sm"
                          : state === "nodata"
                            ? "border-dashed border-[var(--lu-border-strong)] bg-white hover:border-[var(--lu-subtle)] hover:bg-[var(--lu-surface)] hover:shadow-sm"
                            : "border-[var(--lu-border)] bg-[var(--lu-surface)] hover:border-[var(--lu-border-strong)] hover:bg-white hover:shadow-sm"
                }`}
            >
                <span className="flex w-full items-baseline gap-2">
                    <span
                        className={`font-mono font-medium text-[var(--lu-text)] ${
                            compact ? "text-base" : "text-[18px]"
                        }`}
                    >
                        <span className="sr-only">Gen </span>
                        {symbol}
                    </span>
                    {professional && profile?.ubicacion && (
                        // The cytogenetic locus. Clinically meaningful, and
                        // noise to everyone else, so it rides with the medical
                        // detail rather than identifying the row.
                        <span
                            title="Locus citogenético"
                            className="font-mono text-xs text-[var(--lu-subtle)]"
                        >
                            {profile.ubicacion}
                        </span>
                    )}
                    <span className="flex-grow" />
                    {compact ? (
                        <MeterCaption
                            covered={covered}
                            reported={reported}
                            totalExpected={totalExpected}
                        />
                    ) : (
                        <span className="shrink-0 font-mono text-[10.5px] text-[var(--lu-subtle)]">
                            #{rank} de {total}
                        </span>
                    )}
                </span>

                {!compact && (
                    <>
                        <span className="flex w-full items-center gap-2.5">
                            <MatchMeter
                                covered={covered}
                                reported={reported}
                                totalExpected={totalExpected}
                            />
                            <MeterCaption
                                covered={covered}
                                reported={reported}
                                totalExpected={totalExpected}
                            />
                            <span className="flex-grow" />
                            {professional && (
                                <span className="shrink-0 font-mono text-[10.5px] text-[var(--lu-subtle)]">
                                    score {score.toFixed(3)}
                                </span>
                            )}
                        </span>
                        {coveredWords.length > 0 && (
                            <span className="w-full text-xs leading-relaxed text-[var(--lu-text)]">
                                {coveredWords.join(" · ")}
                            </span>
                        )}
                    </>
                )}
            </button>
        </li>
    );
}
