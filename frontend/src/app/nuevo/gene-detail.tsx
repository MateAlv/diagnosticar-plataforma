"use client";

import { describeFrequency, researchLinks, type GeneProfile, type Symptom } from "@/lib/genes-api";
import { MatchMeter, MeterCaption } from "./match-meter";

/**
 * The selected gene, opened beside the list.
 *
 * On a wide screen the reader should not have to choose between seeing the set
 * and seeing one candidate: the list stays on the left and this fills the rest,
 * so scanning and reading are the same motion. Below the breakpoint the list
 * collapses to accordion rows instead and this component is not used.
 *
 * What it shows, in the reader's order: what lines up with their own report,
 * then what to ask a doctor about, then the conditions as labelled context,
 * then the gene's biology. The biology is last on purpose — it is the part a
 * family can do least with.
 */

export type GeneDetailProps = {
    symbol: string;
    rank: number;
    total: number;
    score: number;
    profile: GeneProfile | null;
    professional: boolean;
    reportedWords: Map<string, string>;
};

function stripProvenance(text: string): string {
    return text.replace(/\s*[[(](?:provided by|proporcionado por)[^\])]*[\])]\s*$/i, "").trim();
}

function MatchedRow({
    symptom,
    reportedWords,
    professional,
}: {
    symptom: Symptom;
    reportedWords: Map<string, string>;
    professional: boolean;
}) {
    const viaId = symptom.coincide_con?.hpo_id;
    const said = reportedWords.get((viaId ?? symptom.hpo_id).toUpperCase());

    return (
        <li className="border-b border-[var(--lu-border)] px-3.5 py-3 last:border-b-0">
            {said && (
                <p className="text-xs text-[var(--lu-subtle)]">
                    Dijiste <strong className="font-semibold text-[var(--lu-text)]">{said}</strong>
                </p>
            )}
            <div className="mt-0.5 flex flex-wrap items-baseline gap-2">
                <span className="text-sm font-semibold text-[var(--lu-text)]">{symptom.nombre}</span>
                {professional && (
                    // The derivation, so a clinician can audit the match rather
                    // than take it on trust: which term we matched, and which of
                    // theirs it came from.
                    <span className="font-mono text-[11px] text-[var(--lu-subtle)]">
                        {symptom.hpo_id}
                        {viaId && ` ← ${viaId}`}
                    </span>
                )}
                <span className="flex-grow" />
                {symptom.frecuencia_pct !== null && (
                    <span className="shrink-0 font-mono text-xs text-[var(--lu-accent-text)]">
                        {Math.round(symptom.frecuencia_pct)}%
                    </span>
                )}
            </div>
            <p className="mt-0.5 text-xs text-[var(--lu-subtle)]">
                {symptom.coincide_con ? "Más específico que lo que contaste" : "Coincidencia directa"}
                {describeFrequency(symptom) && ` · ${describeFrequency(symptom)}`}
            </p>
        </li>
    );
}

export function GeneDetail({
    symbol,
    rank,
    total,
    score,
    profile,
    professional,
    reportedWords,
}: GeneDetailProps) {
    const matches = profile?.coincidencias ?? [];
    const toAsk = profile?.frecuentes_no_reportados ?? [];
    const summary = profile?.resumen_es ? stripProvenance(profile.resumen_es) : "";
    const covered = profile?.reportados_cubiertos?.length ?? 0;
    const reported = reportedWords.size;
    const totalExpected = profile?.total_esperados ?? 0;

    return (
        <article
            aria-label={`Detalle del gen ${symbol}`}
            className="flex min-w-0 flex-1 flex-col gap-5 px-8 py-6"
        >
            <div className="flex flex-wrap items-baseline gap-2.5">
                <h4 className="font-mono text-3xl font-medium text-[var(--lu-text)]">
                    <span className="sr-only">Gen </span>
                    {symbol}
                </h4>
                {profile?.ubicacion && (
                    <span className="font-mono text-sm text-[var(--lu-subtle)]">
                        {profile.ubicacion}
                    </span>
                )}
                {professional && profile?.tecnico && (
                    <span className="rounded-full border border-[var(--lu-border)] px-2.5 py-0.5 font-mono text-[11px] text-[var(--lu-subtle)]">
                        {[profile.tecnico.aliases, profile.tecnico.ncbi_id && `NCBI:${profile.tecnico.ncbi_id}`]
                            .filter(Boolean)
                            .join(" · ")}
                    </span>
                )}
                <span className="flex-grow" />
                <span className="shrink-0 font-mono text-[11px] text-[var(--lu-subtle)]">
                    #{rank} de {total}
                </span>
                <MeterCaption
                    covered={covered}
                    reported={reported}
                    totalExpected={totalExpected}
                    verbose
                />
            </div>

            <div className="flex flex-col gap-5 xl:flex-row xl:items-start">
                <div className="flex min-w-0 flex-1 flex-col gap-2.5">
                    <h5 className="text-lg font-semibold text-[var(--lu-text)]">Qué coincide</h5>
                    {matches.length > 0 ? (
                        <ul className="rounded-2xl border border-[var(--lu-accent-light)]">
                            {matches.map((symptom) => (
                                <MatchedRow
                                    key={symptom.hpo_id}
                                    symptom={symptom}
                                    reportedWords={reportedWords}
                                    professional={professional}
                                />
                            ))}
                        </ul>
                    ) : (
                        <p className="text-sm leading-relaxed text-[var(--lu-subtle)]">
                            {totalExpected === 0
                                ? "No tenemos síntomas descritos para este gen, así que no hay nada que comparar. Eso no es evidencia en contra."
                                : `Ninguno de los ${totalExpected} síntomas descritos para este gen coincide con lo que contaste. Sigue dentro del grupo sugerido.`}
                        </p>
                    )}
                    {professional && matches.length > 0 && (
                        <p className="text-xs leading-relaxed text-[var(--lu-subtle)]">
                            La coincidencia se resuelve sobre el grafo HPO, solo de un término general
                            informado hacia sus descendientes, sin atravesar términos de nivel raíz. El
                            modelo no aporta coincidencias propias: devuelve el orden y nada más.
                        </p>
                    )}
                </div>

                <div className="flex w-full flex-col gap-4 xl:w-[330px] xl:shrink-0">
                    {toAsk.length > 0 && (
                        <section>
                            <h5 className="text-lg font-semibold text-[var(--lu-text)]">
                                Para preguntar en la consulta
                            </h5>
                            {/* Amber, not red: a question, not an alarm. And
                                questions for a professional — never a checklist
                                a family scores themselves against. */}
                            <div className="mt-2.5 rounded-2xl border border-amber-200 bg-amber-50 p-3.5">
                                <p className="text-xs leading-relaxed text-amber-900">
                                    Frecuentes en estas condiciones y ausentes en el relato. Anotalos y
                                    preguntá por ellos; no son cosas para evaluar por tu cuenta.
                                </p>
                                <ul>
                                    {toAsk.map((symptom) => (
                                        <li
                                            key={symptom.hpo_id}
                                            className="mt-2.5 flex items-baseline gap-2 border-t border-amber-200 pt-2.5"
                                        >
                                            <span className="text-sm font-semibold text-[var(--lu-text)]">
                                                {symptom.nombre}
                                            </span>
                                            <span className="flex-grow" />
                                            {symptom.frecuencia_pct !== null && (
                                                <span className="shrink-0 font-mono text-xs text-amber-800">
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
                        <section>
                            <h5 className="text-sm font-semibold text-[var(--lu-text)]">
                                Condiciones asociadas · {profile.enfermedades.length}
                            </h5>
                            <ul className="mt-2 flex flex-col gap-1.5">
                                {profile.enfermedades.map((disease) => (
                                    <li
                                        key={disease.omim || disease.nombre}
                                        className="flex items-baseline gap-2 rounded-xl border border-[var(--lu-border)] bg-[var(--lu-surface)] px-3 py-2.5"
                                    >
                                        <span className="text-sm text-[var(--lu-text)]">
                                            {disease.nombre}
                                        </span>
                                        <span className="flex-grow" />
                                        {professional && disease.omim && (
                                            <span className="shrink-0 font-mono text-[10.5px] text-[var(--lu-subtle)]">
                                                OMIM {disease.omim}
                                            </span>
                                        )}
                                    </li>
                                ))}
                            </ul>
                            {/* Ours, not the model's, and with real gaps — said
                                plainly so the list is never read as a ranking. */}
                            <p className="mt-2 text-xs leading-relaxed text-[var(--lu-subtle)]">
                                Sin orden de relevancia para este caso. La lista puede estar incompleta.
                            </p>
                        </section>
                    )}
                </div>
            </div>

            {summary && (
                <section className="border-t border-[var(--lu-border)] pt-4">
                    <h5 className="text-sm font-semibold text-[var(--lu-text)]">Qué se sabe del gen</h5>
                    <p className="mt-1.5 max-w-[720px] text-sm leading-relaxed text-[var(--lu-text)]">
                        {summary}
                    </p>
                </section>
            )}

            {professional && profile?.tecnico?.funcion_proteina_es && (
                <section>
                    <h5 className="text-sm font-semibold text-[var(--lu-text)]">
                        Función de la proteína
                    </h5>
                    <p className="mt-1.5 max-w-[720px] text-sm leading-relaxed text-[var(--lu-subtle)]">
                        {stripProvenance(profile.tecnico.funcion_proteina_es)}
                    </p>
                </section>
            )}

            {!profile && (
                <p className="text-sm text-[var(--lu-subtle)]">
                    Sin descripción disponible para este gen.
                </p>
            )}

            {profile && (
                <section className="border-t border-[var(--lu-border)] pt-4">
                    <h5 className="text-sm font-semibold text-[var(--lu-text)]">Para leer más</h5>
                    <ul className="mt-2 flex flex-wrap gap-2">
                        {researchLinks(profile)
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
                        Son fuentes para investigar y llevar a una consulta, no un diagnóstico.
                    </p>
                </section>
            )}

            {professional && (
                <p className="font-mono text-[11px] text-[var(--lu-subtle)]">
                    score {score.toFixed(3)}
                </p>
            )}
        </article>
    );
}
