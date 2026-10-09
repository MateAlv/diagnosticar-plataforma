"use client";

import {
    ANSWERS_SCORE_TITLE,
    describeFrequency,
    MODEL_SCORE_TITLE,
    formatScore,
    scoreBand,
    omimUrl,
    stripProvenance,
    type GeneProfile,
    type MatchedReport,
} from "@/lib/genes-api";
import { researchLinks } from "@/lib/reference-links";
import { ENTERED_NOTE, MOVED_NOTE } from "@/lib/question-insights";
import { HighScoreBadge } from "./gene-overview-card";
import { ConditionRow, GeneReferenceLinks } from "./gene-links";
import { MeterCaption } from "./match-meter";

/**
 * Everything we hold about one gene, shown in the modal over the results grid.
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
    /**
     * Where the list shown before the questions had this gene (`from` null:
     * it did not), when the list is the one with the answers.
     */
    listOrigin?: { from: number | null } | null;
    profile: GeneProfile | null;
    professional: boolean;
    reportedWords: Map<string, string>;
};

function MatchedReportRow({
    report,
    reportedWords,
    professional,
}: {
    report: MatchedReport;
    reportedWords: Map<string, string>;
    professional: boolean;
}) {
    const said = reportedWords.get(report.reportado_hpo_id.toUpperCase());
    const anchor = report.exacta ?? report.especificas[0];

    return (
        <li className="border-b border-[var(--lu-border)] px-3.5 py-3 last:border-b-0">
            <p className="text-xs text-[var(--lu-subtle)]">
                Dijiste <strong className="font-semibold text-[var(--lu-text)]">{said}</strong>
            </p>

            <div className="mt-0.5 flex flex-wrap items-baseline gap-2">
                <span className="text-sm font-semibold text-[var(--lu-text)]">
                    {report.exacta ? report.exacta.nombre : "Coincidencia parcial"}
                </span>
                {professional && anchor && (
                    <span className="font-mono text-[11px] text-[var(--lu-subtle)]">
                        {anchor.hpo_id}
                    </span>
                )}
                <span className="flex-grow" />
                {report.exacta?.frecuencia_pct != null && (
                    <span className="shrink-0 font-mono text-xs text-[var(--lu-accent-text)]">
                        {Math.round(report.exacta.frecuencia_pct)}%
                    </span>
                )}
            </div>

            {report.exacta ? (
                <p className="mt-0.5 text-xs text-[var(--lu-subtle)]">
                    Coincidencia directa
                    {describeFrequency(report.exacta) && ` · ${describeFrequency(report.exacta)}`}
                </p>
            ) : (
                <p className="mt-0.5 text-xs text-[var(--lu-subtle)]">
                    Las condiciones de este gen describen formas más específicas de lo que contaste,
                    no exactamente eso.
                </p>
            )}

            {/* The variants beneath what they said. Named as forms *described
                for the gene's conditions*, never as findings about this
                patient: several are more severe than the words the family
                used, and a parent reading "profundo" under their own "retraso
                del desarrollo" would read it as a verdict. */}
            {report.especificas.length > 0 && (
                <details className="mt-1.5">
                    <summary className="cursor-pointer text-xs text-[var(--lu-accent-text)]">
                        {report.especificas.length === 1
                            ? "Estas condiciones describen 1 forma más específica"
                            : `Estas condiciones describen ${report.especificas.length} formas más específicas`}
                    </summary>
                    <ul className="mt-1.5 flex flex-col gap-1 border-l-2 border-[var(--lu-border)] pl-3">
                        {report.especificas.map((symptom) => (
                            <li key={symptom.hpo_id} className="flex items-baseline gap-2">
                                <span className="text-xs text-[var(--lu-subtle)]">{symptom.nombre}</span>
                                {professional && (
                                    <span className="font-mono text-[10.5px] text-[var(--lu-subtle)]">
                                        {symptom.hpo_id}
                                    </span>
                                )}
                            </li>
                        ))}
                    </ul>
                    <p className="mt-1.5 text-xs leading-relaxed text-[var(--lu-subtle)]">
                        Son manifestaciones descritas para estas condiciones, no algo que hayas
                        contado ni que sepamos de este caso.
                    </p>
                </details>
            )}
        </li>
    );
}

export function GeneDetail({
    symbol,
    rank,
    total,
    score,
    listOrigin = null,
    profile,
    professional,
    reportedWords,
}: GeneDetailProps) {
    const matches = profile?.coincidencias ?? [];
    const reports = profile?.coincidencias_por_reporte ?? [];
    const toAsk = profile?.frecuentes_no_reportados ?? [];
    const summary = profile?.resumen_es ? stripProvenance(profile.resumen_es) : "";
    const covered = profile?.reportados_cubiertos?.length ?? 0;
    const reported = reportedWords.size;
    const totalExpected = profile?.total_esperados ?? 0;
    const readingLinks = profile ? researchLinks(profile).filter((link) => link.family || professional) : [];
    const linkedConditions = profile?.enfermedades.some((disease) => omimUrl(disease.omim)) ?? false;

    return (
        <article
            aria-label={`Detalle del gen ${symbol}`}
            className="flex min-w-0 flex-1 flex-col gap-5 px-5 py-5 sm:px-8 sm:py-6"
        >
            <div className="flex flex-wrap items-baseline gap-2.5">
                <h4 className="font-mono text-3xl font-medium text-[var(--lu-text)]">
                    <span className="sr-only">Gen </span>
                    {symbol}
                </h4>
                {professional && profile?.ubicacion && (
                    <span className="font-mono text-sm text-[var(--lu-subtle)]">
                        <span className="sr-only">Locus citogenético </span>
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
                <span className="flex shrink-0 items-center gap-2 whitespace-nowrap">
                    <span className="font-mono text-[11px] text-[var(--lu-subtle)]">
                        Gen #{rank} de {total} ·{" "}
                        <span title={listOrigin ? ANSWERS_SCORE_TITLE : MODEL_SCORE_TITLE} data-rank-note>
                            puntaje {formatScore(score)}
                        </span>
                    </span>
                    {scoreBand(score) === "alto" && <HighScoreBadge />}
                </span>
                <MeterCaption
                    covered={covered}
                    reported={reported}
                    totalExpected={totalExpected}
                    verbose
                />
            </div>

            {professional && profile?.nombre_completo && (
                <p className="-mt-3 text-sm text-[var(--lu-subtle)]">{profile.nombre_completo}</p>
            )}

            {/* Says what moved it, so a gene that rose with no symptom in
                common does not read as a contradiction. Not which answer: the
                model ranked the whole list again. */}
            {listOrigin && listOrigin.from !== rank && (
                <p data-move-note className="-mt-2 text-sm leading-relaxed text-[var(--lu-text)]">
                    {listOrigin.from === null ? ENTERED_NOTE : MOVED_NOTE}
                </p>
            )}

            <GeneReferenceLinks symbol={symbol} omimGen={profile?.omim_gen} />

            <div className="flex flex-col gap-5 xl:flex-row xl:items-start">
                <div className="flex min-w-0 flex-1 flex-col gap-2.5">
                    <h5 className="text-lg font-semibold text-[var(--lu-text)]">Qué coincide</h5>
                    {matches.length > 0 ? (
                        <ul className="rounded-2xl border border-[var(--lu-accent-light)]">
                            {reports.map((report) => (
                                <MatchedReportRow
                                    key={report.reportado_hpo_id}
                                    report={report}
                                    reportedWords={reportedWords}
                                    professional={professional}
                                />
                            ))}
                        </ul>
                    ) : (
                        // Two different situations, and conflating them misleads.
                        // Neither says the model was wrong: it does not report
                        // why it ranked anything, so we cannot claim it found a
                        // similarity — only that our own comparison came up
                        // empty, and that the comparison has known gaps.
                        <div className="flex flex-col gap-2">
                            <p className="text-sm leading-relaxed text-[var(--lu-subtle)]">
                                {totalExpected === 0
                                    ? "Todavía no tenemos síntomas descritos para este gen, así que no hay nada que comparar. El hueco es nuestro, no del gen."
                                    : `Ninguno de los ${totalExpected} síntomas que tenemos descritos para este gen coincide con lo que contaste.`}
                            </p>
                            <p className="text-xs leading-relaxed text-[var(--lu-subtle)]">
                                El modelo lo incluyó igual. No informa por qué ordena como ordena, así
                                que no podemos decirte qué vio en este caso — y nuestra comparación
                                mira solo los síntomas descritos para las condiciones que tenemos
                                asociadas, que puede estar incompleta.
                            </p>
                        </div>
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
                    {profile && profile.enfermedades.length > 0 && (
                        <section>
                            <h5 className="text-sm font-semibold text-[var(--lu-text)]">
                                Condiciones asociadas · {profile.enfermedades.length}
                            </h5>
                            {linkedConditions && (
                                <p className="mt-0.5 text-xs text-[var(--lu-subtle)]">
                                    Tocá una condición para ver su ficha en OMIM (en inglés).
                                </p>
                            )}
                            <ul className="mt-2 flex flex-col gap-1.5">
                                {profile.enfermedades.map((disease) => (
                                    <ConditionRow
                                        key={disease.omim || disease.nombre}
                                        disease={disease}
                                        professional={professional}
                                    />
                                ))}
                            </ul>
                            {/* Ours, not the model's, and with real gaps — said
                                plainly so the list is never read as a ranking. */}
                            <p className="mt-2 text-xs leading-relaxed text-[var(--lu-subtle)]">
                                Sin orden de relevancia para este caso. La lista puede estar incompleta.
                            </p>
                        </section>
                    )}

                    {/* Behind the medical toggle, and only there.
                        "Preguntá por discapacidad intelectual (88%)" is read by
                        a parent as a thing to check their child against, however
                        the panel is worded — the disclaimer does not survive
                        contact with a frightened reader. A clinician can weigh a
                        frequency against a presentation; a family is handed a
                        verdict about a child. The data is public either way, so
                        this is about who is equipped to read it, not secrecy. */}
                    {professional && toAsk.length > 0 && (
                        <section>
                            <h5 className="text-sm font-semibold text-[var(--lu-text)]">
                                Síntomas que no reportaste
                            </h5>
                            {/* Quiet, not alarming. These are frequent in the
                                gene's conditions and absent from the account —
                                worth raising with a doctor, but not a finding,
                                and never a checklist to self-assess against.
                                The amber panel shouted that louder than the
                                matches beside it. */}
                            <div className="mt-2 rounded-xl border border-[var(--lu-border)] bg-[var(--lu-surface)] p-3">
                                <p className="text-xs leading-relaxed text-[var(--lu-subtle)]">
                                    Frecuentes en estas condiciones. Anotalos y preguntá por ellos en la
                                    consulta; no son cosas para evaluar por tu cuenta.
                                </p>
                                <ul>
                                    {toAsk.map((symptom) => (
                                        <li
                                            key={symptom.hpo_id}
                                            className="mt-2.5 flex items-baseline gap-2 border-t border-[var(--lu-border)] pt-2.5"
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

            {readingLinks.length > 0 && (
                <section className="border-t border-[var(--lu-border)] pt-4">
                    <h5 className="text-sm font-semibold text-[var(--lu-text)]">Para leer más</h5>
                    <ul className="mt-2 flex flex-wrap gap-2">
                        {readingLinks.map((link) => (
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

        </article>
    );
}
