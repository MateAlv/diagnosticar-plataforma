"use client";

/**
 * How much of the reader's own report a gene engages.
 *
 * One segment per thing the family described, so the denominator is theirs and
 * the claim is checkable — "2 de 4 cosas que contaste", not a score. The count
 * is of *reported phenotypes engaged*, never of matched symptoms: a gene can
 * match nine annotated symptoms that all trace back to one thing they said.
 *
 * Three states, distinguished by fill and shape rather than by colour alone so
 * they survive printing and colour blindness:
 *
 *   filled    this gene engages that part of the report
 *   grey      it does not
 *   dashed    we hold no symptom data for this gene at all
 *
 * The third is 10% of genes and is not evidence against them — the gap is
 * ours. Nothing here is red: no result on this screen is bad news.
 */

export type MeterState = "match" | "none" | "nodata";

export function meterState(covered: number, totalExpected: number): MeterState {
    if (totalExpected === 0) return "nodata";
    return covered > 0 ? "match" : "none";
}

export function MatchMeter({
    covered,
    exact,
    reported,
    totalExpected,
    size = "sm",
}: {
    /** How many reported phenotypes this gene engages, exactly or partially. */
    covered: number;
    /** Of those, how many the gene's conditions describe exactly. */
    exact: number;
    /** How many the reader described in total. */
    reported: number;
    /** Expected symptoms we hold for the gene; 0 means we cannot compare. */
    totalExpected: number;
    size?: "sm" | "lg";
}) {
    const state = meterState(covered, totalExpected);
    const segments = Math.max(reported, 1);
    const width = size === "lg" ? "w-[26px] h-2" : "w-[22px] h-[7px]";
    const partial = Math.max(covered - exact, 0);

    const label =
        state === "nodata"
            ? "Sin datos de síntomas para este gen"
            : covered === 0
              ? `No coincide con ninguna de las ${reported} cosas que contaste`
              : partial > 0
                ? `Coincide con ${covered} de las ${reported} cosas que contaste, ${partial} de forma parcial`
                : `Coincide con ${covered} de las ${reported} cosas que contaste`;

    return (
        <span className="flex shrink-0 gap-[3px]" role="img" aria-label={label}>
            {Array.from({ length: segments }, (_, index) => (
                <span
                    key={index}
                    className={`${width} shrink-0 overflow-hidden rounded-full ${
                        state === "nodata"
                            ? // Dashed, not filled: the gap is ours, not the
                              // gene's, and the shape carries that without
                              // relying on colour.
                              "border border-dashed border-[var(--lu-subtle)] bg-transparent"
                            : // Bordered as well as filled, so an empty segment
                              // stays visible on the grey surface a no-match row
                              // uses.
                              "border border-[var(--lu-border-strong)] bg-[var(--lu-border-strong)]"
                    }`}
                >
                    {/* Exact segments fill; partial ones fill half. A match
                        reached through the ontology is weaker evidence than
                        one the conditions name outright, and a full segment
                        for both overstated it. */}
                    {state !== "nodata" && index < covered && (
                        <span
                            className={`block h-full bg-[var(--lu-accent)] ${
                                index < exact ? "w-full" : "w-1/2"
                            }`}
                        />
                    )}
                </span>
            ))}
        </span>
    );
}

/** The sentence beside the meter. */
export function MeterCaption({
    covered,
    reported,
    totalExpected,
    verbose = false,
}: {
    covered: number;
    reported: number;
    totalExpected: number;
    verbose?: boolean;
}) {
    const state = meterState(covered, totalExpected);

    if (state === "nodata") {
        return <span className="text-xs text-[var(--lu-subtle)]">Sin datos para comparar</span>;
    }

    if (state === "none") {
        return (
            <span className="text-xs text-[var(--lu-subtle)]">
                0 de {reported}
                {/* The honest number: how much we had to compare against. Three
                    expected symptoms is very little, and saying so stops a
                    thin annotation reading as a negative finding. */}
                {totalExpected > 0 && ` · tenemos ${totalExpected} síntomas descritos`}
            </span>
        );
    }

    return (
        <span className="text-xs font-semibold text-[var(--lu-accent-text)]">
            {covered} de {verbose ? `las ${reported} cosas que contaste` : reported}
        </span>
    );
}
