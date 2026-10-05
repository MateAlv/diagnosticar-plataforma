"use client";

/**
 * Typed client for /api/genes.
 *
 * Gene descriptions enrich a result; they never gate it. Every failure here
 * resolves to `null` rather than throwing, so a ranked gene still renders with
 * its symbol and score when the description is unavailable. Losing the prose
 * must never cost the user the result.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api";

export type Disease = {
    nombre: string;
    descripcion_es: string;
    omim: string;
    /**
     * How many reported phenotypes this condition accounts for. Present only
     * when phenotypes were sent. The list is never reordered by it — the model
     * predicts genes, not diseases — but it identifies which condition is the
     * relevant one to name.
     */
    coincidencias?: number;
};

export type Symptom = {
    hpo_id: string;
    nombre: string;
    frecuencia_pct: number | null;
    frecuencia_texto: string | null;
    /**
     * Set when this matched something reported more generally: they said
     * "fiebre", the condition causes "fiebre episódica". Absent on an exact
     * match.
     */
    coincide_con?: { hpo_id: string; distancia: number };
};

export type GeneTechnical = {
    resumen_es: string | null;
    funcion_proteina_es: string | null;
    resumen_en: string | null;
    funcion_proteina_en: string | null;
    aliases: string | null;
    ncbi_id: string | null;
    uniprot_accession: string | null;
    codigo_omim: string[];
};

/**
 * One thing the reader reported, and how this gene's annotations meet it.
 *
 * `exacta` is the annotation that *is* what they said. `especificas` are the
 * ones beneath it in the ontology — real, but our inference rather than their
 * report, and often more severe than the words they used.
 */
export type MatchedReport = {
    reportado_hpo_id: string;
    exacta: Symptom | null;
    especificas: Symptom[];
};

export type GeneProfile = {
    simbolo: string;
    nombre_completo: string | null;
    cromosoma: string | null;
    ubicacion: string | null;
    /** The gene's own OMIM entry, not one of its diseases. Null when OMIM has none. */
    omim_gen: string | null;
    /** The curated Spanish summary — technical, and what the card shows. */
    resumen_es: string | null;
    /** Plain-language rewrite: generated, unreviewed, not shown yet. */
    resumen_llano_es: string | null;
    enfermedades: Disease[];
    coincidencias: Symptom[];
    coincidencias_por_reporte: MatchedReport[];
    frecuentes_no_reportados: Symptom[];
    total_esperados: number;
    /**
     * Which reported phenotypes this gene engages, as HPO ids. The meter's
     * numerator: "2 de 4 cosas que contaste". Not `coincidencias.length` — a
     * gene can match nine annotated symptoms that all trace back to one thing
     * the family said.
     */
    reportados_cubiertos: string[];
    referencias: Record<string, string>;
    tecnico?: GeneTechnical;
};

/** Drops the trailing "[provided by RefSeq]" a curated summary carries. */
export function stripProvenance(text: string): string {
    return text.replace(/\s*[[(](?:provided by|proporcionado por)[^\])]*[\])]\s*$/i, "").trim();
}

const HPO_RE = /^HP:\d{7}$/i;
const MAX_REPORTED = 100;

/**
 * One gene's profile, or `null` when there is none.
 *
 * A miss is ordinary: the model ranks over a gene set that can move ahead of
 * the description database. The caller shows the gene without a description —
 * it must never hide the gene or invent text for it.
 */
export async function fetchGeneProfile(
    symbol: string,
    reportedHpoIds: string[] = [],
    options: { professional?: boolean; signal?: AbortSignal } = {},
): Promise<GeneProfile | null> {
    const params = new URLSearchParams();

    const reported = reportedHpoIds.filter((id) => HPO_RE.test(id)).slice(0, MAX_REPORTED);
    if (reported.length > 0) params.set("reported", reported.join(","));
    if (options.professional) params.set("view", "professional");

    const query = params.toString();
    const path = `/genes/${encodeURIComponent(symbol)}${query ? `?${query}` : ""}`;

    try {
        const res = await fetch(`${API_URL}${path}`, {
            credentials: "include",
            signal: options.signal,
        });
        if (!res.ok) return null;
        return (await res.json()) as GeneProfile;
    } catch {
        // Includes AbortError when the user leaves the screen mid-request.
        return null;
    }
}

function readCookie(name: string): string | null {
    if (typeof document === "undefined") return null;
    const escaped = name.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
    const match = document.cookie.match(new RegExp(`(?:^|; )${escaped}=([^;]*)`));
    return match ? decodeURIComponent(match[1]) : null;
}

/**
 * Profiles for a whole ranking, keyed by symbol.
 *
 * One request for the whole list: the results screen shows up to 50 genes, and
 * a request each would spend most of a minute's rate budget on a single page
 * load. Genes without a profile are absent from the map rather than present
 * with a null, so callers iterate their own ranking and look up.
 */
export async function fetchGeneProfiles(
    symbols: string[],
    reportedHpoIds: string[] = [],
    options: { professional?: boolean; signal?: AbortSignal; onFailure?: (error: unknown) => void } = {},
): Promise<Map<string, GeneProfile>> {
    const profiles = new Map<string, GeneProfile>();
    if (symbols.length === 0) return profiles;

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const csrf = readCookie("csrf_token");
    if (csrf) headers["X-CSRF-Token"] = csrf;

    try {
        const res = await fetch(`${API_URL}/genes/batch`, {
            method: "POST",
            credentials: "include",
            headers,
            signal: options.signal,
            body: JSON.stringify({
                symbols,
                reported: reportedHpoIds.filter((id) => HPO_RE.test(id)).slice(0, MAX_REPORTED),
                view: options.professional ? "professional" : undefined,
            }),
        });
        if (!res.ok) {
            options.onFailure?.(res.status);
            return profiles;
        }

        const body = (await res.json()) as { profiles?: Record<string, GeneProfile> };
        for (const profile of Object.values(body.profiles ?? {})) {
            profiles.set(profile.simbolo.toUpperCase(), profile);
        }
    } catch (error) {
        // Descriptions enrich the ranking and never gate it, so a failure here
        // leaves every gene on screen without prose.
        if ((error as Error)?.name !== "AbortError") options.onFailure?.(error);
    }
    return profiles;
}

/**
 * The model's score to three places, or "bajo" under 0.01. Down there the
 * digits carry nothing a reader can use, and "0.000" reads as "irrelevant"
 * for a gene the model did rank.
 */
export function formatScore(score: number): string {
    return score < 0.01 ? "bajo" : score.toFixed(3);
}

/** The label of the model's own score, on the original ranking only. */
export const MODEL_SCORE_TITLE = "Puntaje del modelo: ordena la lista, no es una probabilidad";

/** "muy frecuente (95%)" — the words first, the number as support. */
export function describeFrequency(symptom: Symptom): string | null {
    const { frecuencia_pct: pct, frecuencia_texto: text } = symptom;
    if (pct === null) return text || null;

    const rounded = Math.round(pct);
    if (rounded >= 80) return `muy frecuente (${rounded}%)`;
    if (rounded >= 30) return `frecuente (${rounded}%)`;
    return `menos frecuente (${rounded}%)`;
}

export type ResearchLink = {
    label: string;
    url: string;
    spanish: boolean;
    /** Written for families rather than specialists, whatever the language. */
    family?: boolean;
};

const MIM_RE = /^\d{6}$/;

/** OMIM's page for a MIM number, or null when the number is not one. */
export function omimUrl(mim: string | null | undefined): string | null {
    return mim && MIM_RE.test(mim) ? `https://www.omim.org/entry/${mim}` : null;
}

/**
 * The two pages a clinician opens first for a gene: GeneCards and the gene's
 * own OMIM entry.
 *
 * GeneCards needs only the symbol, which the ranking always has, so it is
 * offered even when the gene has no profile. OMIM needs the gene's MIM number
 * — not a disease's — and is absent without one.
 */
export function geneReferenceLinks(symbol: string, omimGen: string | null | undefined): ResearchLink[] {
    const links: ResearchLink[] = [{
        label: "GeneCards",
        url: `https://www.genecards.org/cgi-bin/carddisp.pl?gene=${encodeURIComponent(symbol)}`,
        spanish: false,
    }];
    const omim = omimUrl(omimGen);
    if (omim) links.push({ label: "OMIM", url: omim, spanish: false });
    return links;
}
