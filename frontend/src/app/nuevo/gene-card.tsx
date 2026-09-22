"use client";

import { useId, useState } from "react";
import { describeFrequency, researchLinks, type GeneProfile, type Symptom } from "@/lib/genes-api";

/**
 * One gene in the results ranking, as a row that opens.
 *
 * The model predicts *genes*, not diseases: the correct gene is in the top 20
 * in roughly 9 of 10 cases, and no disease is ever predicted. So the gene is
 * the headline and the conditions sit underneath as labelled context. Leading
 * with a disease name would present our own annotation as the model's output.
 *
 * The guarantee is about the *set* of 20, so the ranking has to be scannable:
 * collapsed, a row carries only what decides whether to open it — rank, symbol,
 * how much of the reader's own report it engages, and the leading condition.
 * Everything else waits behind the click.
 *
 * The diseases are deliberately unordered and never truncated once open —
 * ranking them would read as a differential the model did not produce.
 */

/** Longer than this and the summary is clamped behind a "ver más". */
const SUMMARY_CLAMP = 260;

export type GeneCardProps = {
    symbol: string;
    rank: number;
    score: number;
    profile: GeneProfile | null;
    professional: boolean;
    /** The first row opens so the screen does not start as an undifferentiated list. */
    defaultOpen?: boolean;
};

/**
 * NCBI and UniProt end their prose with a provenance tail. It is metadata, and
 * a Spanish summary closing "[proporcionado por RefSeq, julio…]" beside an
 * English "[provided by RefSeq, Jul 2016]" reads as broken text even when both
 * translations are fine.
 */
function stripProvenance(text: string): string {
    return text.replace(/\s*[[(](?:provided by|proporcionado por)[^\])]*[\])]\s*$/i, "").trim();
}

function SymptomRow({ symptom, tone }: { symptom: Symptom; tone: "match" | "ask" }) {
    const frequency = describeFrequency(symptom);
    return (
        <li className="flex items-baseline justify-between gap-3 py-1">
            <span className="flex min-w-0 items-baseline gap-2">
                <span
                    aria-hidden="true"
                    className={
                        tone === "match"
                            ? "text-[var(--lu-green)]"
                            : "text-[var(--lu-subtle)]"
                    }
                >
                    {tone === "match" ? "✓" : "•"}
                </span>
                <span className="truncate text-sm text-[var(--lu-text)]">{symptom.nombre}</span>
            </span>
            {frequency && (
                <span className="shrink-0 text-xs text-[var(--lu-subtle)]">{frequency}</span>
            )}
        </li>
    );
}

/**
 * The match signal, as a count and as something readable at a glance.
 *
 * This comparison is *ours*: /rank-genes returns `matched_count: 0` and exposes
 * nothing about why a gene ranked where it did. So it is worded as a comparison
 * we made against the gene's expected symptoms, never as the model's reasoning.
 *
 * A gene with no expected symptoms at all (10% of them) is not the same as one
 * that matched none of them — "sin datos para comparar" says we have nothing,
 * which is the honest reading, rather than implying the gene was ruled out.
 */
function MatchSignal({ matches, totalExpected }: { matches: number; totalExpected: number }) {
    if (totalExpected === 0) {
        return (
            <span className="shrink-0 text-xs text-[var(--lu-subtle)]">Sin datos para comparar</span>
        );
    }

    if (matches === 0) {
        return <span className="shrink-0 text-xs text-[var(--lu-subtle)]">Sin coincidencias</span>;
    }

    return (
        <span className="flex shrink-0 items-center gap-1.5 rounded-full border border-[var(--lu-green)] px-2.5 py-0.5 text-xs font-medium text-[var(--lu-green)]">
            <span aria-hidden="true">✓</span>
            {matches === 1 ? "1 dato tuyo" : `${matches} datos tuyos`}
        </span>
    );
}

export function GeneCard({
    symbol,
    rank,
    score,
    profile,
    professional,
    defaultOpen = false,
}: GeneCardProps) {
    const [open, setOpen] = useState(defaultOpen);
    const [showTechnical, setShowTechnical] = useState(false);
    const [showFullSummary, setShowFullSummary] = useState(false);
    const technicalId = useId();
    const summaryId = useId();
    const bodyId = useId();

    const matches = profile?.coincidencias ?? [];
    const toAsk = profile?.frecuentes_no_reportados ?? [];
    const summary = profile?.resumen_es ? stripProvenance(profile.resumen_es) : "";
    const leadingCondition = profile?.enfermedades[0]?.nombre ?? null;

    return (
        <article
            className={`rounded-2xl border bg-[var(--lu-surface)] ${
                matches.length > 0
                    ? "border-[var(--lu-green)]/40"
                    : "border-[var(--lu-border)]"
            }`}
        >
            <h4>
                <button
                    type="button"
                    onClick={() => setOpen((isOpen) => !isOpen)}
                    aria-expanded={open}
                    aria-controls={bodyId}
                    className="flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left hover:bg-[var(--lu-bg)]"
                >
                    <span
                        aria-hidden="true"
                        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--lu-accent)] text-xs font-bold text-white"
                    >
                        {rank}
                    </span>

                    <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                        <span className="text-base font-semibold text-[var(--lu-text)]">
                            <span className="sr-only">Gen </span>
                            {symbol}
                        </span>
                        {profile?.ubicacion && (
                            <span className="text-xs text-[var(--lu-subtle)]">{profile.ubicacion}</span>
                        )}
                        {leadingCondition && (
                            <span className="min-w-0 basis-full truncate text-xs text-[var(--lu-subtle)]">
                                {leadingCondition}
                            </span>
                        )}
                    </span>

                    <MatchSignal matches={matches.length} totalExpected={profile?.total_esperados ?? 0} />

                    <span
                        aria-hidden="true"
                        className={`shrink-0 text-[var(--lu-subtle)] transition-transform ${
                            open ? "rotate-90" : ""
                        }`}
                    >
                        ›
                    </span>
                </button>
            </h4>

            {open && (
                <div id={bodyId} className="border-t border-[var(--lu-border)] px-4 pb-4 pt-3">
                    {/* What the reader came for: the part computed from their own
                        report, before anything about the protein. */}
                    {matches.length > 0 && (
                        <section>
                            <h5 className="text-xs font-medium uppercase tracking-wide text-[var(--lu-subtle)]">
                                Coincide con lo que contaste
                            </h5>
                            <ul className="mt-1">
                                {matches.map((symptom) => (
                                    <SymptomRow key={symptom.hpo_id} symptom={symptom} tone="match" />
                                ))}
                            </ul>
                        </section>
                    )}

                    {toAsk.length > 0 && (
                        <section className={matches.length > 0 ? "mt-4" : ""}>
                            <h5 className="text-xs font-medium uppercase tracking-wide text-[var(--lu-subtle)]">
                                Otros signos frecuentes en estas condiciones
                            </h5>
                            <ul className="mt-1">
                                {toAsk.map((symptom) => (
                                    <SymptomRow key={symptom.hpo_id} symptom={symptom} tone="ask" />
                                ))}
                            </ul>
                            {/* Questions to raise with a doctor — never a self-assessment checklist. */}
                            <p className="mt-2 text-xs leading-relaxed text-[var(--lu-subtle)]">
                                No los mencionaste. Preguntale a tu médico si corresponde evaluarlos.
                            </p>
                        </section>
                    )}

                    {profile && profile.enfermedades.length > 0 && (
                        <section className="mt-4">
                            <h5 className="text-xs font-medium uppercase tracking-wide text-[var(--lu-subtle)]">
                                Se estudia en relación con
                            </h5>
                            <ul className="mt-1.5 space-y-1">
                                {profile.enfermedades.map((disease) => (
                                    <li key={disease.omim || disease.nombre} className="text-sm text-[var(--lu-text)]">
                                        {disease.nombre}
                                    </li>
                                ))}
                            </ul>
                        </section>
                    )}

                    {summary && (
                        <section className="mt-4">
                            <h5 className="text-xs font-medium uppercase tracking-wide text-[var(--lu-subtle)]">
                                Qué hace este gen
                            </h5>
                            <p
                                id={summaryId}
                                className={`mt-1.5 text-sm leading-relaxed text-[var(--lu-text)] ${
                                    showFullSummary ? "" : "line-clamp-2"
                                }`}
                            >
                                {summary}
                            </p>
                            {/* Half of these run past 600 characters and some reach 3,900,
                                so the card clamps and lets the reader open it. */}
                            {summary.length > SUMMARY_CLAMP && (
                                <button
                                    type="button"
                                    onClick={() => setShowFullSummary((isOpen) => !isOpen)}
                                    aria-expanded={showFullSummary}
                                    aria-controls={summaryId}
                                    className="mt-1 text-xs font-medium text-[var(--lu-accent)] underline underline-offset-2"
                                >
                                    {showFullSummary ? "Ver menos" : "Ver descripción completa"}
                                </button>
                            )}
                        </section>
                    )}

                    {profile && (
                        <section className="mt-4">
                            <h5 className="text-xs font-medium uppercase tracking-wide text-[var(--lu-subtle)]">
                                Para leer más
                            </h5>
                            <ul className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
                                {researchLinks(profile)
                                    // Families get the Spanish sources; the English
                                    // databases are for whoever turned on the technical view.
                                    .filter((link) => link.spanish || professional)
                                    .map((link) => (
                                        <li key={link.url}>
                                            <a
                                                href={link.url}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="text-xs text-[var(--lu-accent)] underline underline-offset-2"
                                            >
                                                {link.label}
                                            </a>
                                        </li>
                                    ))}
                            </ul>
                            <p className="mt-2 text-xs leading-relaxed text-[var(--lu-subtle)]">
                                Son fuentes para investigar y llevar a una consulta, no un diagnóstico.
                            </p>
                        </section>
                    )}

                    {!profile && (
                        <p className="text-sm text-[var(--lu-subtle)]">
                            Sin descripción disponible para este gen.
                        </p>
                    )}

                    {professional && profile?.tecnico && (
                        <div className="mt-4 border-t border-[var(--lu-border)] pt-3">
                            <button
                                type="button"
                                onClick={() => setShowTechnical((isOpen) => !isOpen)}
                                aria-expanded={showTechnical}
                                aria-controls={technicalId}
                                className="text-xs font-medium text-[var(--lu-accent)] underline underline-offset-2"
                            >
                                {showTechnical ? "Ocultar detalle técnico" : "Ver detalle técnico"}
                            </button>

                            {showTechnical && (
                                <dl id={technicalId} className="mt-3 space-y-3 text-xs">
                                    <div>
                                        <dt className="font-medium text-[var(--lu-text)]">Puntaje del modelo</dt>
                                        <dd className="text-[var(--lu-subtle)]">{score.toFixed(3)}</dd>
                                    </div>
                                    {profile.nombre_completo && (
                                        <div>
                                            <dt className="font-medium text-[var(--lu-text)]">Nombre completo</dt>
                                            <dd className="text-[var(--lu-subtle)]">{profile.nombre_completo}</dd>
                                        </div>
                                    )}
                                    {profile.tecnico.funcion_proteina_es && (
                                        <div>
                                            <dt className="font-medium text-[var(--lu-text)]">Función de la proteína</dt>
                                            <dd className="leading-relaxed text-[var(--lu-subtle)]">
                                                {stripProvenance(profile.tecnico.funcion_proteina_es)}
                                            </dd>
                                        </div>
                                    )}
                                    {profile.tecnico.aliases && (
                                        <div>
                                            <dt className="font-medium text-[var(--lu-text)]">Otros nombres</dt>
                                            <dd className="text-[var(--lu-subtle)]">{profile.tecnico.aliases}</dd>
                                        </div>
                                    )}
                                </dl>
                            )}
                        </div>
                    )}
                </div>
            )}
        </article>
    );
}
