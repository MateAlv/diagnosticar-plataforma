"use client";

/**
 * The HPO tree, for turning a general symptom into a more specific one.
 *
 * A term is "general" when it reaches many genes: "Convulsiones" reaches over
 * 1,500, so on its own it barely orders the ranking, while "Espasmos
 * infantiles" reaches a fraction of that. The wizard flags those terms and lets
 * the person browse down the tree to the form that fits. Nothing here blocks:
 * every failure resolves to "nothing to refine".
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api";

/**
 * From how many genes a term counts as general. 1,000 of the ~10,800 terms
 * with any gene reach this many; the design (docs/SYMPTOM_INPUT_DESIGN.md §2)
 * set the line here so the warning is rare enough to be read.
 */
export const GENERAL_TERM_MIN_GENES = 100;

export type HpoTerm = {
    hpo_id: string;
    nombre: string;
    genes: number;
    tiene_hijos: boolean;
};

export type HpoTermChildren = {
    termino: HpoTerm;
    hijos: HpoTerm[];
};

/** Worth offering to refine: reaches many genes and has something beneath. */
export function isGeneralTerm(term: HpoTerm | undefined | null): boolean {
    return Boolean(term && term.tiene_hijos && term.genes >= GENERAL_TERM_MIN_GENES);
}

/** "1.560 genes", "1 gen". */
export function genesLabel(genes: number): string {
    return `${genes.toLocaleString("es-AR")} ${genes === 1 ? "gen" : "genes"}`;
}

/** The given terms by upper-cased id; an empty map on any failure. */
export async function fetchTerms(ids: string[]): Promise<Map<string, HpoTerm>> {
    const unique = [...new Set(ids.map((id) => id.trim().toUpperCase()).filter((id) => /^HP:\d{7}$/.test(id)))];
    const terms = new Map<string, HpoTerm>();
    if (unique.length === 0) return terms;
    try {
        const response = await fetch(`${API_URL}/hpo/terms?ids=${encodeURIComponent(unique.slice(0, 100).join(","))}`, {
            credentials: "include",
        });
        if (!response.ok) return terms;
        const body = (await response.json()) as { terminos?: HpoTerm[] };
        for (const term of body.terminos ?? []) terms.set(term.hpo_id.toUpperCase(), term);
    } catch {
        // The warning is a suggestion; without it the wizard works as before.
    }
    return terms;
}

/** A term and the forms beneath it; null when it cannot be loaded. */
export async function fetchChildren(id: string): Promise<HpoTermChildren | null> {
    try {
        const response = await fetch(`${API_URL}/hpo/terms/${encodeURIComponent(id)}/children`, {
            credentials: "include",
        });
        if (!response.ok) return null;
        const body = (await response.json()) as Partial<HpoTermChildren>;
        if (!body.termino || !Array.isArray(body.hijos)) return null;
        return { termino: body.termino, hijos: body.hijos };
    } catch {
        return null;
    }
}
