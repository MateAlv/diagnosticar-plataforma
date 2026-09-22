"use client";

import { useId, useState } from "react";
import { describeFrequency, researchLinks, type GeneProfile, type Symptom } from "@/lib/genes-api";

/**
 * One gene in the results ranking.
 *
 * The model predicts *genes*, not diseases: the correct gene is in the top 20
 * in roughly 9 of 10 cases, and no disease is ever predicted. So the gene is
 * the headline and the conditions sit underneath as labelled context. Leading
 * with a disease name would present our own annotation as the model's output.
 *
 * The diseases are deliberately unordered and never truncated — ranking them
 * would read as a differential the model did not produce.
 */

/** Longer than this and the summary is clamped behind a "ver más". */
const SUMMARY_CLAMP = 260;

export type GeneCardProps = {
    symbol: string;
    rank: number;
    score: number;
    profile: GeneProfile | null;
    professional: boolean;
};

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

export function GeneCard({ symbol, rank, score, profile, professional }: GeneCardProps) {
    const [showTechnical, setShowTechnical] = useState(false);
    const [showFullSummary, setShowFullSummary] = useState(false);
    const technicalId = useId();
    const summaryId = useId();

    const matches = profile?.coincidencias ?? [];
    const toAsk = profile?.frecuentes_no_reportados ?? [];

    return (
        <article className="rounded-2xl border border-[var(--lu-border)] bg-[var(--lu-surface)] p-5">
            <header className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                    <span
                        aria-hidden="true"
                        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--lu-accent)] text-xs font-bold text-white"
                    >
                        {rank}
                    </span>
                    <div className="min-w-0">
                        <h4 className="truncate text-base font-semibold text-[var(--lu-text)]">
                            <span className="sr-only">Gen </span>
                            {symbol}
                        </h4>
                        {profile?.ubicacion && (
                            <p className="text-xs text-[var(--lu-subtle)]">{profile.ubicacion}</p>
                        )}
                    </div>
                </div>

                {matches.length > 0 && (
                    <span className="shrink-0 rounded-full border border-[var(--lu-green)] px-3 py-1 text-xs font-medium text-[var(--lu-green)]">
                        {matches.length === 1
                            ? "1 dato coincide"
                            : `${matches.length} datos coinciden`}
                    </span>
                )}
            </header>

            {profile?.resumen_es && (
                <div className="mt-4">
                    <p
                        id={summaryId}
                        className={`text-sm leading-relaxed text-[var(--lu-text)] ${
                            showFullSummary ? "" : "line-clamp-4"
                        }`}
                    >
                        {profile.resumen_es}
                    </p>
                    {/* Half of these run past 600 characters and some reach 3,900,
                        so the card clamps and lets the reader open it. */}
                    {profile.resumen_es.length > SUMMARY_CLAMP && (
                        <button
                            type="button"
                            onClick={() => setShowFullSummary((open) => !open)}
                            aria-expanded={showFullSummary}
                            aria-controls={summaryId}
                            className="mt-1 text-xs font-medium text-[var(--lu-accent)] underline underline-offset-2"
                        >
                            {showFullSummary ? "Ver menos" : "Ver descripción completa"}
                        </button>
                    )}
                </div>
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

            {matches.length > 0 && (
                <section className="mt-4">
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
                <section className="mt-4">
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
                <p className="mt-4 text-sm text-[var(--lu-subtle)]">
                    Sin descripción disponible para este gen.
                </p>
            )}

            {professional && profile?.tecnico && (
                <div className="mt-4 border-t border-[var(--lu-border)] pt-3">
                    <button
                        type="button"
                        onClick={() => setShowTechnical((open) => !open)}
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
                                        {profile.tecnico.funcion_proteina_es}
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
        </article>
    );
}
