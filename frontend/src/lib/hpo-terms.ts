"use client";

/**
 * The HPO tree, for turning a general symptom into a more specific one.
 *
 * A term is general when it sits high in the tree: many more specific forms
 * hang beneath it. "Convulsiones" has 104 such forms; "Pectus excavatum" has
 * one, which is a particular case rather than a type to choose. The wizard
 * offers to refine the first and not the second. Nothing here blocks: every
 * failure resolves to "nothing to refine".
 *
 * The limits below come from docs/PRECISAR_SINTOMAS.md, which measured them
 * on 10,374 published patients and the production model.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api";

/** A choice needs at least two forms directly beneath. */
export const REFINE_MIN_CHILDREN = 2;
/** And some depth beneath, not just two leaves (Ectopia del cristalino has two). */
export const REFINE_MIN_BENEATH = 3;
/** Below this many genes a term already narrows the ranking; refining it did not help. */
export const REFINE_MIN_GENES = 50;
/** From this many forms beneath, the term is broad enough to point out. */
export const BROAD_MIN_BENEATH = 10;
/**
 * With this many symptoms or more, refining one barely moved the right gene,
 * so the wizard stops pointing broad terms out (the chip stays).
 */
export const BROAD_NOTICE_MAX_SYMPTOMS = 8;

export type HpoTerm = {
    hpo_id: string;
    nombre: string;
    genes: number;
    tiene_hijos: boolean;
    /** Terms directly beneath that reach a gene. */
    hijos?: number;
    /** Terms anywhere beneath that reach a gene. */
    debajo?: number;
};

export type HpoTermChildren = {
    termino: HpoTerm;
    hijos: HpoTerm[];
};

/** Worth offering "Precisar": there is a real choice beneath, and a gain from it. */
export function canRefine(term: HpoTerm | undefined | null): boolean {
    return Boolean(
        term &&
            (term.hijos ?? 0) >= REFINE_MIN_CHILDREN &&
            (term.debajo ?? 0) >= REFINE_MIN_BENEATH &&
            term.genes >= REFINE_MIN_GENES,
    );
}

/** High enough in the tree to point out, not just offer. */
export function isBroadTerm(term: HpoTerm | undefined | null): boolean {
    return canRefine(term) && (term?.debajo ?? 0) >= BROAD_MIN_BENEATH;
}

/** "14 tipos más específicos", "1 tipo más específico". */
export function typesLabel(count: number): string {
    return `${count.toLocaleString("es-AR")} ${count === 1 ? "tipo más específico" : "tipos más específicos"}`;
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
