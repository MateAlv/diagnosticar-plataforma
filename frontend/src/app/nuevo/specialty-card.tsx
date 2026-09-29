"use client";

import { useState } from "react";
import { traducirEspecialidad } from "@/lib/especialidades";

/**
 * Which specialities the ranked genes point to, below the genes themselves.
 *
 * Derived from the genes, so it follows them on screen rather than leading:
 * it summarises the list the reader has just looked at. The top areas lead as
 * the recommendation; every area follows with the genes behind it, and each
 * gene opens its own detail, so a speciality can be traced back to the
 * evidence for it.
 *
 * No per-area percentage: GenPhenAI's probability mass would read as the odds
 * that the child belongs to that speciality.
 */

export type SpecialtyRow = {
    specialty: string;
    matched_genes_count: number;
    genes: string[];
};

export type SpecialtySummary = {
    top_specialties: string[];
    specialty_ranking: SpecialtyRow[];
    unmapped_genes: string[];
};

/** Past this many areas the rest fold behind a button. */
const VISIBLE_ROWS = 5;

export function SpecialtyCard({
    specialties,
    geneCount,
    rankedSymbols,
    onOpenGene,
}: {
    specialties: SpecialtySummary | null;
    /** How many genes the ranking holds, the denominator for each area. */
    geneCount: number;
    /** Genes on screen; only these can open a detail. */
    rankedSymbols: Set<string>;
    onOpenGene: (symbol: string) => void;
}) {
    const [showAll, setShowAll] = useState(false);
    const top = (specialties?.top_specialties ?? []).slice(0, 3);
    const topSet = new Set(top);
    const rows = specialties?.specialty_ranking ?? [];
    const shown = showAll ? rows : rows.slice(0, VISIBLE_ROWS);
    const folded = rows.length - shown.length;

    return (
        <section
            aria-labelledby="especialidades-titulo"
            className="overflow-hidden rounded-3xl border border-[var(--lu-border)] bg-white shadow-sm"
        >
            <div className="border-b border-[var(--lu-border)] bg-[var(--lu-surface)] px-4 py-4 sm:px-6">
                <p className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-[var(--lu-subtle)]">
                    Según los genes de esta lista
                </p>
                <h3 id="especialidades-titulo" className="mt-1 text-xl font-semibold text-[var(--lu-text)]">
                    Especialidades para consultar
                </h3>
            </div>

            <div className="flex flex-col gap-5 px-4 py-5 sm:px-6">
                {top.length > 0 ? (
                    <div>
                        <p className="text-sm leading-relaxed text-[var(--lu-text)]">
                            Las áreas donde más se concentran los genes sugeridos. Pueden orientarte sobre a
                            qué especialista consultar:
                        </p>
                        <ul className="mt-3 flex flex-wrap gap-2">
                            {top.map((name) => (
                                <li
                                    key={name}
                                    className="rounded-full bg-[var(--lu-accent-text)] px-4 py-1.5 text-sm font-semibold text-white shadow-sm"
                                >
                                    {traducirEspecialidad(name)}
                                </li>
                            ))}
                        </ul>
                    </div>
                ) : (
                    <p className="text-sm leading-relaxed text-[var(--lu-subtle)]">
                        No se pudo determinar una especialidad recomendada para los síntomas ingresados.
                        Consultá con un genetista clínico.
                    </p>
                )}

                {rows.length > 0 && (
                    <div>
                        <h4 className="text-sm font-semibold text-[var(--lu-text)]">
                            Qué genes llevan a cada área
                        </h4>
                        <ul className="mt-2 divide-y divide-[var(--lu-border)] rounded-2xl border border-[var(--lu-border)]">
                            {shown.map((row) => (
                                <li
                                    key={row.specialty}
                                    className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-baseline sm:gap-4"
                                >
                                    <span className="flex shrink-0 items-baseline gap-2 sm:w-64">
                                        <span
                                            className={`text-sm ${
                                                topSet.has(row.specialty)
                                                    ? "font-semibold text-[var(--lu-accent-text)]"
                                                    : "font-medium text-[var(--lu-text)]"
                                            }`}
                                        >
                                            {traducirEspecialidad(row.specialty)}
                                        </span>
                                        <span className="font-mono text-[11px] text-[var(--lu-subtle)]">
                                            {row.matched_genes_count} de {geneCount} genes
                                        </span>
                                    </span>
                                    <span className="flex flex-wrap gap-1.5">
                                        {row.genes.map((symbol) =>
                                            rankedSymbols.has(symbol) ? (
                                                <button
                                                    key={symbol}
                                                    type="button"
                                                    onClick={() => onOpenGene(symbol)}
                                                    aria-haspopup="dialog"
                                                    aria-label={`Ver el gen ${symbol}`}
                                                    className="rounded-full border border-[var(--lu-border-strong)] px-2 py-0.5 font-mono text-[11px] text-[var(--lu-text)] transition-colors hover:border-[var(--lu-accent)] hover:bg-[var(--lu-accent-light)] hover:text-[var(--lu-accent-text)]"
                                                >
                                                    {symbol}
                                                </button>
                                            ) : (
                                                <span
                                                    key={symbol}
                                                    className="px-1 font-mono text-[11px] text-[var(--lu-subtle)]"
                                                >
                                                    {symbol}
                                                </span>
                                            ),
                                        )}
                                    </span>
                                </li>
                            ))}
                        </ul>
                        {(folded > 0 || showAll) && rows.length > VISIBLE_ROWS && (
                            <button
                                type="button"
                                onClick={() => setShowAll((open) => !open)}
                                aria-expanded={showAll}
                                className="mt-2 min-h-[44px] text-xs font-semibold text-[var(--lu-accent-text)] underline underline-offset-2"
                            >
                                {showAll ? "Ver menos" : `Ver ${folded} ${folded === 1 ? "área más" : "áreas más"}`}
                            </button>
                        )}
                    </div>
                )}

                {(specialties?.unmapped_genes.length ?? 0) > 0 && (
                    <p className="text-xs leading-relaxed text-[var(--lu-subtle)]">
                        Sin especialidad asignada: {specialties?.unmapped_genes.join(", ")}
                    </p>
                )}
            </div>
        </section>
    );
}
