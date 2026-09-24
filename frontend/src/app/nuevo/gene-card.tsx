"use client";

import { useId, useState } from "react";
import {
    describeFrequency,
    researchLinks,
    type GeneProfile,
    type Symptom,
} from "@/lib/genes-api";
import { ConditionRow, GeneReferenceLinks } from "./gene-links";
import { MatchMeter, MeterCaption, meterState } from "./match-meter";

/**
 * One gene in the results ranking.
 *
 * The model predicts *genes*, not diseases, and its claim is about the set:
 * the correct gene is among the top 20 in roughly 9 of 10 cases. So the gene
 * symbol identifies the row and the model's position is a grey aside — being
 * in the set is the claim, the order inside it is not.
 *
 * **No condition name appears on a collapsed row.** Our stored conditions can
 * be the wrong ones (TCF4 holds only a type 2 diabetes susceptibility locus,
 * with Pitt-Hopkins missing entirely), and the condition would be the most
 * legible text in the row — so it would read as the answer. Conditions live
 * inside, plural and labelled as unordered and possibly incomplete.
 *
 * The symptom overlap is ours, not the model's: /rank-genes returns
 * `matched_count: 0` and never explains a ranking.
 */

/** Longer than this and the summary is clamped behind a "seguir leyendo". */
const SUMMARY_CLAMP = 260;

export type GeneCardProps = {
    symbol: string;
    rank: number;
    total: number;
    score: number;
    profile: GeneProfile | null;
    professional: boolean;
    /** HPO id -> the words the reader actually used, from the wizard. */
    reportedWords: Map<string, string>;
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

/**
 * A matched symptom, shown against the words the reader used for it.
 *
 * "Dijiste convulsiones → Espasmos infantiles" keeps the match honest: we are
 * not claiming they reported the specific form, and the extra specificity is
 * itself worth knowing.
 */
function MatchedSymptom({
    symptom,
    reportedWords,
}: {
    symptom: Symptom;
    reportedWords: Map<string, string>;
}) {
    const frequency = describeFrequency(symptom);
    const viaId = symptom.coincide_con?.hpo_id ?? symptom.hpo_id;
    const said = reportedWords.get(viaId.toUpperCase());

    return (
        <li className="border-b border-[var(--lu-border)] px-3.5 py-3 last:border-b-0">
            {said && (
                <p className="text-xs text-[var(--lu-subtle)]">
                    Dijiste <strong className="font-semibold text-[var(--lu-text)]">{said}</strong>
                </p>
            )}
            <div className="mt-1 flex items-baseline gap-2">
                <span className="text-sm font-semibold text-[var(--lu-text)]">{symptom.nombre}</span>
                <span className="flex-grow" />
                {symptom.frecuencia_pct !== null && (
                    <span className="shrink-0 font-mono text-xs text-[var(--lu-accent-text)]">
                        {Math.round(symptom.frecuencia_pct)}%
                    </span>
                )}
            </div>
            <p className="mt-0.5 text-xs text-[var(--lu-subtle)]">
                {symptom.coincide_con ? "Más específico que lo que contaste" : "Coincidencia directa"}
                {frequency && ` · ${frequency}`}
            </p>
        </li>
    );
}

export function GeneCard({
    symbol,
    rank,
    total,
    score,
    profile,
    professional,
    reportedWords,
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
    const covered = profile?.reportados_cubiertos?.length ?? 0;
    const exact = (profile?.coincidencias_por_reporte ?? []).filter((r) => r.exacta).length;
    const reported = reportedWords.size;
    const totalExpected = profile?.total_esperados ?? 0;
    const state = meterState(covered, totalExpected);

    // The words the reader used, for the parts of their report this gene
    // engages — the row's one line of prose, in their language not HPO's.
    const coveredWords = (profile?.reportados_cubiertos ?? [])
        .map((id) => reportedWords.get(id.toUpperCase()))
        .filter((word): word is string => Boolean(word));

    return (
        <article
            className={`rounded-[18px] border ${
                state === "match"
                    ? "border-[var(--lu-accent-light)] bg-white"
                    : state === "nodata"
                      ? "border-dashed border-[var(--lu-border-strong)] bg-white"
                      : "border-[var(--lu-border)] bg-[var(--lu-surface)]"
            }`}
        >
            <h4>
                <button
                    type="button"
                    onClick={() => setOpen((isOpen) => !isOpen)}
                    aria-expanded={open}
                    aria-controls={bodyId}
                    className="flex w-full flex-col gap-2 rounded-[18px] px-3.5 py-3.5 text-left hover:bg-[var(--lu-bg)]"
                >
                    <span className="flex w-full items-baseline gap-2">
                        <span
                            className={`font-mono font-medium text-[var(--lu-text)] ${
                                state === "match" ? "text-[19px]" : "text-[17px]"
                            }`}
                        >
                            <span className="sr-only">Gen </span>
                            {symbol}
                        </span>
                        {professional && profile?.ubicacion && (
                            <span className="font-mono text-xs text-[var(--lu-subtle)]">
                                <span className="sr-only">Locus citogenético </span>
                                {profile.ubicacion}
                            </span>
                        )}
                        <span className="flex-grow" />
                        {/* The model's position, as an aside. No circle, no medal:
                            rank 1 and rank 12 are not meaningfully different, and
                            the guarantee is about the set. */}
                        <span className="shrink-0 font-mono text-[10.5px] text-[var(--lu-subtle)]">
                            #{rank} de {total}
                        </span>
                    </span>

                    <span className="flex w-full items-center gap-2.5">
                        <MatchMeter
                            covered={covered}
                            exact={exact}
                            reported={reported}
                            totalExpected={totalExpected}
                        />
                        <MeterCaption
                            covered={covered}
                            reported={reported}
                            totalExpected={totalExpected}
                        />
                    </span>

                    {coveredWords.length > 0 && (
                        <span className="w-full text-xs leading-relaxed text-[var(--lu-text)]">
                            {coveredWords.join(" · ")}
                        </span>
                    )}
                </button>
            </h4>

            {open && (
                <div id={bodyId} className="border-t border-[var(--lu-border)] px-3.5 pb-4 pt-3.5">
                    <div className="mb-5">
                        <GeneReferenceLinks symbol={symbol} omimGen={profile?.omim_gen} />
                    </div>
                    {matches.length > 0 && (
                        <section>
                            <h5 className="text-base font-semibold text-[var(--lu-text)]">
                                Qué coincide
                            </h5>
                            <ul className="mt-2 rounded-[14px] border border-[var(--lu-accent-light)]">
                                {matches.map((symptom) => (
                                    <MatchedSymptom
                                        key={symptom.hpo_id}
                                        symptom={symptom}
                                        reportedWords={reportedWords}
                                    />
                                ))}
                            </ul>
                            <p className="mt-2 text-xs leading-relaxed text-[var(--lu-subtle)]">
                                Esta comparación la hacemos nosotros, entre lo que contaste y los
                                síntomas descritos para este gen. El modelo que ordena la lista no
                                explica por qué eligió cada gen.
                            </p>
                        </section>
                    )}

                    {/* Medical view only: see the note in gene-detail.tsx. */}
                    {professional && toAsk.length > 0 && (
                        <section className={matches.length > 0 ? "mt-5" : ""}>
                            <h5 className="text-base font-semibold text-[var(--lu-text)]">
                                Síntomas que no reportaste
                            </h5>
                            {/* Quiet, not alarming: frequent in the gene's
                                conditions and absent from the account, worth
                                raising with a doctor but not a finding — and
                                never a checklist to self-assess against. */}
                            <div className="mt-2 rounded-[14px] border border-[var(--lu-border)] bg-[var(--lu-surface)] p-3.5">
                                <p className="text-xs leading-relaxed text-[var(--lu-subtle)]">
                                    Frecuentes en las condiciones asociadas a este gen. Anotalos y
                                    preguntá por ellos en la consulta; no son cosas para evaluar por
                                    tu cuenta.
                                </p>
                                <ul className="mt-2">
                                    {toAsk.map((symptom) => (
                                        <li
                                            key={symptom.hpo_id}
                                            className="mt-2 flex items-baseline gap-2 border-t border-[var(--lu-border)] pt-2 first:mt-0"
                                        >
                                            <span className="text-sm text-[var(--lu-text)]">
                                                {symptom.nombre}
                                            </span>
                                            <span className="flex-grow" />
                                            {symptom.frecuencia_pct !== null && (
                                                <span className="shrink-0 font-mono text-xs text-[var(--lu-text)]">
                                                    {Math.round(symptom.frecuencia_pct)}%
                                                </span>
                                            )}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        </section>
                    )}

                    {profile && profile.enfermedades.length > 0 && (
                        <section className="mt-5">
                            <h5 className="text-base font-semibold text-[var(--lu-text)]">
                                Condiciones asociadas a este gen
                            </h5>
                            {/* Unordered and possibly incomplete, said plainly: the
                                list is our annotation, not the model's output, and
                                it has real gaps. */}
                            <p className="mt-1 text-xs leading-relaxed text-[var(--lu-subtle)]">
                                Este gen está descrito en {profile.enfermedades.length}{" "}
                                {profile.enfermedades.length === 1 ? "condición" : "condiciones"}. No
                                están ordenadas por relevancia para tu caso, y la lista puede estar
                                incompleta.
                            </p>
                            <ul className="mt-2 flex flex-col gap-1.5">
                                {profile.enfermedades.map((disease) => (
                                    <ConditionRow
                                        key={disease.omim || disease.nombre}
                                        disease={disease}
                                        professional={professional}
                                    />
                                ))}
                            </ul>
                        </section>
                    )}

                    {summary && (
                        <section className="mt-5">
                            <h5 className="text-base font-semibold text-[var(--lu-text)]">
                                Qué se sabe del gen
                            </h5>
                            <p
                                id={summaryId}
                                className={`mt-1.5 text-sm leading-relaxed text-[var(--lu-text)] ${
                                    showFullSummary ? "" : "line-clamp-3"
                                }`}
                            >
                                {summary}
                            </p>
                            {summary.length > SUMMARY_CLAMP && (
                                <button
                                    type="button"
                                    onClick={() => setShowFullSummary((isOpen) => !isOpen)}
                                    aria-expanded={showFullSummary}
                                    aria-controls={summaryId}
                                    className="mt-1 text-xs font-semibold text-[var(--lu-accent-text)] underline underline-offset-2"
                                >
                                    {showFullSummary ? "Ver menos" : "Seguir leyendo"}
                                </button>
                            )}
                        </section>
                    )}

                    {profile && (
                        <section className="mt-5">
                            <h5 className="text-base font-semibold text-[var(--lu-text)]">
                                Para leer más
                            </h5>
                            <ul className="mt-2 flex flex-wrap gap-2">
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
                                                className="flex min-h-[44px] items-center gap-1.5 rounded-full border border-[var(--lu-border-strong)] px-3.5 text-xs font-medium text-[var(--lu-accent-text)]"
                                            >
                                                {link.label}
                                                {!link.spanish && (
                                                    <span className="text-[10.5px] text-[var(--lu-subtle)]">
                                                        en inglés
                                                    </span>
                                                )}
                                            </a>
                                        </li>
                                    ))}
                            </ul>
                            <p className="mt-2 text-xs leading-relaxed text-[var(--lu-subtle)]">
                                Son fuentes para investigar y llevar a una consulta, no un
                                diagnóstico.
                            </p>
                        </section>
                    )}

                    {!profile && (
                        <p className="text-sm text-[var(--lu-subtle)]">
                            Sin descripción disponible para este gen.
                        </p>
                    )}

                    {professional && profile?.tecnico && (
                        <div className="mt-5 border-t border-[var(--lu-border)] pt-3">
                            <button
                                type="button"
                                onClick={() => setShowTechnical((isOpen) => !isOpen)}
                                aria-expanded={showTechnical}
                                aria-controls={technicalId}
                                className="text-xs font-semibold text-[var(--lu-accent-text)] underline underline-offset-2"
                            >
                                {showTechnical ? "Ocultar detalle técnico" : "Ver detalle técnico"}
                            </button>

                            {showTechnical && (
                                <dl id={technicalId} className="mt-3 space-y-3 text-xs">
                                    <div>
                                        <dt className="font-medium text-[var(--lu-text)]">
                                            Puntaje del modelo
                                        </dt>
                                        <dd className="text-[var(--lu-subtle)]">{score.toFixed(3)}</dd>
                                    </div>
                                    {profile.nombre_completo && (
                                        <div>
                                            <dt className="font-medium text-[var(--lu-text)]">
                                                Nombre completo
                                            </dt>
                                            <dd className="text-[var(--lu-subtle)]">
                                                {profile.nombre_completo}
                                            </dd>
                                        </div>
                                    )}
                                    {profile.tecnico.funcion_proteina_es && (
                                        <div>
                                            <dt className="font-medium text-[var(--lu-text)]">
                                                Función de la proteína
                                            </dt>
                                            <dd className="leading-relaxed text-[var(--lu-subtle)]">
                                                {stripProvenance(profile.tecnico.funcion_proteina_es)}
                                            </dd>
                                        </div>
                                    )}
                                    {profile.tecnico.aliases && (
                                        <div>
                                            <dt className="font-medium text-[var(--lu-text)]">
                                                Otros nombres
                                            </dt>
                                            <dd className="text-[var(--lu-subtle)]">
                                                {profile.tecnico.aliases}
                                            </dd>
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
