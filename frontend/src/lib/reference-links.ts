/**
 * Links to public reference pages for a gene or an HPO term, shared by the
 * results screen and the downloadable summary.
 *
 * Orphanet and MedlinePlus Genetics answer a gene they do not know with an
 * error page, so they are offered only for genes on their own published lists
 * (gene-pages.json, rebuilt by scripts/build-gene-pages.py).
 */

import type { GeneProfile, ResearchLink } from "./genes-api";
import pages from "./gene-pages.json";

const ORPHANET_GENES = new Set(pages.orphanet);
const MEDLINEPLUS_GENES = new Set(pages.medlineplus);

const HPO_RE = /^HP:\d{7}$/;

export function geneCardsUrl(symbol: string): string {
    return `https://www.genecards.org/cgi-bin/carddisp.pl?gene=${encodeURIComponent(symbol)}`;
}

/** The term's page on the HPO browser, or null for anything that is not an HPO id. */
export function hpoTermUrl(code: string | null | undefined): string | null {
    const id = (code ?? "").trim().toUpperCase();
    return HPO_RE.test(id) ? `https://hpo.jax.org/browse/term/${id}` : null;
}

/** Orphanet's page for the gene, in Spanish, when Orphanet has one. */
export function orphanetGeneUrl(symbol: string): string | null {
    const key = symbol.trim().toUpperCase();
    return ORPHANET_GENES.has(key) ? `https://www.orpha.net/es/disease/gene/${encodeURIComponent(key)}` : null;
}

/** MedlinePlus Genetics' page for the gene, in English, when it has one. */
export function medlinePlusGeneUrl(symbol: string): string | null {
    const key = symbol.trim().toUpperCase();
    return MEDLINEPLUS_GENES.has(key)
        ? `https://medlineplus.gov/genetics/gene/${encodeURIComponent(key.toLowerCase())}/`
        : null;
}

/**
 * Where a person can read more about a gene and its associated conditions.
 *
 * Ordered for the reader: Orphanet's gene page is in Spanish and written for
 * the public, MedlinePlus Genetics is plain English for families, and the
 * curated databases after them are for specialists.
 *
 * Every link points at a page known to exist, so a link is either correct or
 * absent.
 */
export function researchLinks(profile: GeneProfile): ResearchLink[] {
    const links: ResearchLink[] = [];
    const symbol = profile.simbolo;

    const orphanet = orphanetGeneUrl(symbol);
    if (orphanet) {
        links.push({ label: `Orphanet — enfermedades asociadas a ${symbol}`, url: orphanet, spanish: true, family: true });
    }
    const medlinePlus = medlinePlusGeneUrl(symbol);
    if (medlinePlus) {
        links.push({ label: `MedlinePlus Genetics — ${symbol}`, url: medlinePlus, spanish: false, family: true });
    }
    for (const [name, url] of Object.entries(profile.referencias)) {
        if (url) links.push({ label: name, url, spanish: false });
    }

    return links;
}
