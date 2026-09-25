"use client";

import { formatScore, type GeneProfile } from "@/lib/genes-api";
import { MatchMeter, MeterCaption, meterState } from "./match-meter";

/**
 * One gene in the results grid: the overview, and the way into its detail.
 *
 * The model predicts *genes*, not diseases, and its claim is about the set, so
 * the symbol identifies the card and the rank is an aside. What the card adds
 * is how the gene meets the reader's own report — the meter, and the matched
 * symptoms in small type — so the set can be scanned without opening anything.
 *
 * **No condition name appears on the card.** A condition would be the most
 * legible text on it and would read as the answer; conditions live in the
 * detail, plural and labelled as unordered and possibly incomplete.
 */

/** Past this many, the card says "+N" instead of growing. */
const MAX_CHIPS = 4;

export type GeneOverviewCardProps = {
    symbol: string;
    rank: number;
    total: number;
    score: number;
    profile: GeneProfile | null;
    professional: boolean;
    reportedWords: Map<string, string>;
    onOpen: () => void;
};

type Chip = { key: string; label: string; partial: boolean };

/**
 * One chip per reported term the gene engages, exact ones first. An exact
 * match is named as the gene's conditions name it; a partial one by the
 * reader's own words, since what the conditions describe is a more specific
 * form of it and not the thing itself.
 */
function matchedChips(profile: GeneProfile | null, reportedWords: Map<string, string>): Chip[] {
    return (profile?.coincidencias_por_reporte ?? []).map((report) => ({
        key: report.reportado_hpo_id,
        label:
            report.exacta?.nombre ??
            reportedWords.get(report.reportado_hpo_id.toUpperCase()) ??
            report.especificas[0]?.nombre ??
            report.reportado_hpo_id,
        partial: !report.exacta,
    }));
}

export function GeneOverviewCard({
    symbol,
    rank,
    total,
    score,
    profile,
    professional,
    reportedWords,
    onOpen,
}: GeneOverviewCardProps) {
    const covered = profile?.reportados_cubiertos?.length ?? 0;
    const exact = (profile?.coincidencias_por_reporte ?? []).filter((r) => r.exacta).length;
    const reported = reportedWords.size;
    const totalExpected = profile?.total_esperados ?? 0;
    const state = meterState(covered, totalExpected);
    const chips = matchedChips(profile, reportedWords);
    const shown = chips.slice(0, MAX_CHIPS);
    const hidden = chips.length - shown.length;

    return (
        <li className="flex">
            <button
                type="button"
                onClick={onOpen}
                aria-haspopup="dialog"
                data-gene-card={symbol}
                // The lift, the shadow and the accent border arrive together so
                // the card reads as something that opens. Motion is dropped for
                // anyone who asked for less of it; the colour change stays.
                className={`group flex w-full flex-col gap-3.5 rounded-3xl border p-5 text-left transition-all duration-200 ease-out hover:border-[var(--lu-accent)] hover:bg-white hover:shadow-[0_18px_40px_-18px_rgba(13,148,136,0.45)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lu-accent)] motion-safe:hover:-translate-y-1 ${
                    state === "match"
                        ? "border-[var(--lu-accent-light)] bg-white shadow-sm"
                        : state === "nodata"
                          ? "border-dashed border-[var(--lu-border-strong)] bg-white"
                          : "border-[var(--lu-border)] bg-[var(--lu-surface)]"
                }`}
            >
                <span className="flex w-full items-center gap-2">
                    <span className="font-mono text-[11px] text-[var(--lu-subtle)]">
                        #{rank} de {total}
                    </span>
                    <span className="flex-grow" />
                    {/* Shown because it is what the model returns, labelled so
                        it is not read as a probability: it orders the list
                        and means nothing on its own. */}
                    <span
                        title="Puntaje del modelo: ordena la lista, no es una probabilidad"
                        className="rounded-full bg-[var(--lu-surface)] px-2.5 py-0.5 font-mono text-[11px] text-[var(--lu-text)] ring-1 ring-[var(--lu-border)]"
                    >
                        puntaje {formatScore(score)}
                    </span>
                </span>

                <span className="flex items-baseline gap-2.5">
                    <span className="font-mono text-[28px] font-medium leading-none text-[var(--lu-text)]">
                        <span className="sr-only">Gen </span>
                        {symbol}
                    </span>
                    {professional && profile?.ubicacion && (
                        <span title="Locus citogenético" className="font-mono text-xs text-[var(--lu-subtle)]">
                            {profile.ubicacion}
                        </span>
                    )}
                </span>
                {professional && profile?.nombre_completo && (
                    <span className="-mt-2 text-xs text-[var(--lu-subtle)]">{profile.nombre_completo}</span>
                )}

                <span className="flex flex-wrap items-center gap-2.5">
                    <MatchMeter
                        covered={covered}
                        exact={exact}
                        reported={reported}
                        totalExpected={totalExpected}
                        size="lg"
                    />
                    <MeterCaption covered={covered} reported={reported} totalExpected={totalExpected} />
                </span>

                {shown.length > 0 && (
                    <span className="flex flex-wrap gap-1.5">
                        {shown.map((chip) => (
                            <span
                                key={chip.key}
                                className={`rounded-full px-2.5 py-1 text-[11px] leading-none ${
                                    chip.partial
                                        ? "border border-dashed border-[var(--lu-accent)] text-[var(--lu-accent-text)]"
                                        : "bg-[var(--lu-accent-light)] text-[var(--lu-accent-text)]"
                                }`}
                            >
                                {chip.label}
                                {chip.partial && <span className="text-[var(--lu-subtle)]"> · parcial</span>}
                            </span>
                        ))}
                        {hidden > 0 && (
                            <span className="rounded-full px-2 py-1 text-[11px] leading-none text-[var(--lu-subtle)]">
                                +{hidden} más
                            </span>
                        )}
                    </span>
                )}

                <span className="flex-grow" />
                <span className="flex items-center gap-1 text-xs font-semibold text-[var(--lu-accent-text)]">
                    Ver detalle
                    <span
                        aria-hidden="true"
                        className="transition-transform duration-200 motion-safe:group-hover:translate-x-1"
                    >
                        →
                    </span>
                </span>
            </button>
        </li>
    );
}
