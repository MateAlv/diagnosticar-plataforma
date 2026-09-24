"use client";

import { geneReferenceLinks, omimUrl, type Disease } from "@/lib/genes-api";

/**
 * The gene's two primary references — GeneCards and its OMIM entry — and the
 * condition rows that open their own OMIM entries.
 *
 * Shared by the wide detail pane and the narrow accordion card so the two
 * cannot drift. Both views get these: they are reference pages, not a list of
 * symptoms to check a child against, which is what the medical toggle guards.
 */

function ExternalMark() {
    return (
        <span aria-hidden="true" className="text-[11px]">
            ↗
        </span>
    );
}

export function GeneReferenceLinks({
    symbol,
    omimGen,
}: {
    symbol: string;
    omimGen: string | null | undefined;
}) {
    return (
        <div className="flex flex-wrap items-center gap-2">
            {geneReferenceLinks(symbol, omimGen).map((link) => (
                <a
                    key={link.url}
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex min-h-[44px] items-center gap-1.5 rounded-full border border-[var(--lu-accent-light)] bg-white px-4 text-sm font-semibold text-[var(--lu-accent-text)] hover:bg-[var(--lu-bg)]"
                >
                    {link.label}
                    <span className="sr-only"> de {symbol} (se abre en otra pestaña)</span>
                    <ExternalMark />
                </a>
            ))}
            <span className="text-[11px] text-[var(--lu-subtle)]">en inglés</span>
        </div>
    );
}

/**
 * One associated condition. A link to its OMIM entry when it has a valid
 * code, plain text otherwise — never a link to a guessed page.
 */
export function ConditionRow({
    disease,
    professional,
}: {
    disease: Disease;
    professional: boolean;
}) {
    const url = omimUrl(disease.omim);
    const body = (
        <>
            <span className={`text-sm text-[var(--lu-text)] ${url ? "group-hover:underline" : ""}`}>
                {disease.nombre}
            </span>
            <span className="flex-grow" />
            {professional && disease.omim && (
                <span className="shrink-0 font-mono text-[10.5px] text-[var(--lu-subtle)]">
                    OMIM {disease.omim}
                </span>
            )}
            {url && (
                <span className="shrink-0 text-[var(--lu-accent-text)]">
                    <span className="sr-only">(abre OMIM, en inglés)</span>
                    <ExternalMark />
                </span>
            )}
        </>
    );
    const box =
        "flex items-baseline gap-2 rounded-xl border border-[var(--lu-border)] bg-[var(--lu-surface)] px-3 py-2.5";

    return (
        <li>
            {url ? (
                <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`group ${box} hover:border-[var(--lu-accent-light)] hover:bg-white`}
                >
                    {body}
                </a>
            ) : (
                <div className={box}>{body}</div>
            )}
        </li>
    );
}
