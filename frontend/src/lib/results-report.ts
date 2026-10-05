/**
 * The downloadable summary of a search: the disclaimer, the reported profile,
 * what a genetic disease is and where to read more, and last what the model
 * returned. One structure feeds both the PDF and the copied text, so the two
 * never say different things.
 *
 * Built in the browser from what is on screen; nothing is sent anywhere.
 */

import { RESULTS_DISCLAIMER } from "./disclaimer";
import { stripProvenance } from "./genes-api";
import { onsetClass, onsetPhrase, type SymptomOnset } from "./onset";
import { geneCardsUrl, hpoTermUrl } from "./reference-links";

/** The public site, named in every summary that leaves the page. */
export const SITE_URL = "https://diagnosticar.infra.cluster.qb.fcen.uba.ar";

/**
 * The paper the model comes from. Null until the reference is confirmed; the
 * summary then describes the model without a link rather than a wrong one.
 */
export const MODEL_PAPER_URL: string | null = null;

export const GENETICS_REFERRAL =
    "Si pensás que puede tratarse de una enfermedad genética, lo indicado es una consulta con un o una especialista en genética médica. Podés pedirle la derivación a tu médico o médica de cabecera, o al pediatra, y llevar este resumen.";

export type ReportLink = { label: string; url: string };

export type ReportTerm = { label: string; code: string; detail: string; url: string | null };

export type ReportGene = { rank: number; symbol: string; description: string | null; links: ReportLink[] };

export type ReportBlock =
    | { kind: "paragraph"; text: string; emphasis?: boolean }
    | { kind: "list"; items: string[] }
    | { kind: "terms"; terms: ReportTerm[] }
    | { kind: "genes"; title: string; genes: ReportGene[] }
    | { kind: "links"; links: (ReportLink & { note: string })[] };

/** `newPage`: the section opens a page of its own, so it is never read as a tail of the one before. */
export type ReportSection = { title: string; blocks: ReportBlock[]; notice?: boolean; newPage?: boolean };

export type Report = { title: string; subtitle: string; sections: ReportSection[] };

export type ReportInput = {
    date: Date;
    patient: { name: string; birthDate: string | null; sex: string | null };
    clinicalText: string;
    symptoms: { label: string; code: string; onset?: SymptomOnset | null; source?: "texto" | "manual" }[];
    negated: { label: string; code: string }[];
    answers: { yes: string[]; no: string[]; unsure: string[] };
    /** The list on screen, in its order, with the gene's curated summary when there is one. */
    genes: { symbol: string; summary: string | null }[];
    /** The list on screen is the one re-ranked with the follow-up answers. */
    adjustedByAnswers?: boolean;
    specialties: string[];
};

const SEX_LABELS: Record<string, string> = {
    femenino: "Femenino",
    masculino: "Masculino",
    no_binario: "No binario",
    prefiero_no_decir: "Prefirió no informarlo",
};

/** "7 años", "8 meses", or null without a valid birth date. */
export function ageText(birthDate: string | null, now: Date): string | null {
    if (!birthDate) return null;
    const born = new Date(`${birthDate}T00:00:00`);
    if (Number.isNaN(born.getTime()) || born > now) return null;
    let months = (now.getFullYear() - born.getFullYear()) * 12 + (now.getMonth() - born.getMonth());
    if (now.getDate() < born.getDate()) months -= 1;
    if (months < 12) return months === 1 ? "1 mes" : `${Math.max(0, months)} meses`;
    const years = Math.floor(months / 12);
    return years === 1 ? "1 año" : `${years} años`;
}

function onsetDetail(onset: SymptomOnset | null | undefined): string {
    return onset && onsetClass(onset.hpo_id) ? onsetPhrase(onset) : "";
}

const term = (label: string, code: string, detail = ""): ReportTerm => ({ label, code, detail, url: hpoTermUrl(code) });

const BRIEF_MIN = 100;
const BRIEF_MAX = 300;

/**
 * The first sentences of a curated gene summary: enough to say what the gene
 * does, short enough for a list of fifty.
 */
export function briefGeneSummary(text: string | null | undefined): string | null {
    const clean = stripProvenance(text ?? "").replace(/\s+/g, " ");
    if (!clean) return null;
    const sentences = clean.split(/(?<=\.)\s+(?=[A-ZÁÉÍÓÚÑ])/);
    let brief = "";
    for (const sentence of sentences) {
        if (brief && (brief.length >= BRIEF_MIN || brief.length + sentence.length + 1 > BRIEF_MAX)) break;
        brief = brief ? `${brief} ${sentence}` : sentence;
    }
    if (brief.length <= BRIEF_MAX) return brief;
    const cut = brief.slice(0, BRIEF_MAX);
    return `${cut.slice(0, cut.lastIndexOf(" "))}…`;
}

function howItWasLoaded(input: ReportInput): string {
    const fromText = input.symptoms.filter((s) => s.source === "texto").length;
    const byHand = input.symptoms.filter((s) => s.source === "manual").length;
    const parts: string[] = [];
    if (fromText) parts.push(`${fromText === 1 ? "1 se detectó" : `${fromText} se detectaron`} automáticamente en el relato escrito`);
    if (byHand) parts.push(`${byHand === 1 ? "1 se eligió" : `${byHand} se eligieron`} en el buscador de síntomas`);
    const how = parts.length
        ? `De los síntomas, ${parts.join(" y ")}, y se revisaron antes de la búsqueda.`
        : "Los síntomas se cargan escribiendo un relato, del que se detectan automáticamente, o eligiéndolos en un buscador, y se revisan antes de la búsqueda.";
    return (
        `Estos datos se cargaron en Diagnostic.ar. ${how} ` +
        "Cada síntoma se traduce a un término de la Human Phenotype Ontology (HPO), el vocabulario internacional con el que " +
        "profesionales y bases de datos de genética describen signos clínicos; al lado de cada uno va su código HPO, con un link a su ficha."
    );
}

export function buildResultsReport(input: ReportInput): Report {
    const date = input.date.toLocaleDateString("es-AR", { day: "numeric", month: "long", year: "numeric" });
    // First, so it is the first thing anyone opening the file reads.
    const sections: ReportSection[] = [
        {
            title: "Importante",
            notice: true,
            blocks: [
                { kind: "paragraph", text: RESULTS_DISCLAIMER, emphasis: true },
                { kind: "paragraph", text: GENETICS_REFERRAL },
            ],
        },
    ];

    const person: string[] = [];
    if (input.patient.name.trim()) person.push(`Nombre o apodo: ${input.patient.name.trim()}`);
    const age = ageText(input.patient.birthDate, input.date);
    if (age) person.push(`Edad: ${age}`);
    if (input.patient.sex && SEX_LABELS[input.patient.sex]) person.push(`Sexo: ${SEX_LABELS[input.patient.sex]}`);

    const reported: ReportBlock[] = [{ kind: "paragraph", text: howItWasLoaded(input) }];
    if (person.length) reported.push({ kind: "list", items: person });
    if (input.clinicalText.trim()) {
        reported.push({ kind: "paragraph", text: "Relato cargado:", emphasis: true });
        reported.push({ kind: "paragraph", text: input.clinicalText.trim() });
    }
    reported.push({ kind: "paragraph", text: "Síntomas usados en la búsqueda:", emphasis: true });
    if (input.symptoms.length) {
        reported.push({ kind: "terms", terms: input.symptoms.map((s) => term(s.label, s.code, onsetDetail(s.onset))) });
    } else {
        reported.push({ kind: "list", items: ["Ninguno."] });
    }
    if (input.symptoms.some((s) => s.onset)) {
        reported.push({
            kind: "paragraph",
            text: "La edad de inicio es un dato informado: hoy no modifica el orden de los genes.",
        });
    }
    if (input.negated.length) {
        reported.push({ kind: "paragraph", text: "No presenta, según el relato:", emphasis: true });
        reported.push({ kind: "terms", terms: input.negated.map((n) => term(n.label, n.code)) });
    }
    const { yes, no, unsure } = input.answers;
    if (yes.length || no.length || unsure.length) {
        reported.push({ kind: "paragraph", text: "Respuestas a las preguntas de seguimiento:", emphasis: true });
        const lines: string[] = [];
        if (yes.length) lines.push(`Sí: ${yes.join("; ")}`);
        if (no.length) lines.push(`No: ${no.join("; ")}`);
        if (unsure.length) lines.push(`No sabe: ${unsure.join("; ")}`);
        reported.push({ kind: "list", items: lines });
    }
    sections.push({ title: "1. Perfil informado del paciente", blocks: reported });

    sections.push({
        title: "2. Qué son las enfermedades genéticas y dónde leer más",
        blocks: [
            {
                kind: "paragraph",
                text:
                    "Son enfermedades causadas por cambios (variantes) en uno o más genes. Muchas son poco frecuentes: en Argentina se las " +
                    "llama EPoF, enfermedades poco frecuentes. Un mismo gen puede asociarse a varias enfermedades y una misma enfermedad puede " +
                    "deberse a distintos genes; por eso esta lista no dice qué tiene la persona, sino qué genes vale la pena estudiar. " +
                    "Confirmarlo requiere una evaluación clínica y, en general, un estudio genético indicado por un profesional.",
            },
            {
                kind: "links",
                links: [
                    { label: "MedlinePlus Genética", url: "https://medlineplus.gov/spanish/genetica/", note: "explicaciones en español para familias" },
                    { label: "Orphanet", url: "https://www.orpha.net/es", note: "enfermedades poco frecuentes, en español" },
                    { label: "FADEPOF", url: "https://fadepof.org.ar", note: "Federación Argentina de Enfermedades Poco Frecuentes" },
                    { label: "GeneCards", url: "https://www.genecards.org", note: "ficha de cada gen (en inglés)" },
                    { label: "OMIM", url: "https://www.omim.org", note: "genes y enfermedades hereditarias, para profesionales (en inglés)" },
                    { label: "HPO", url: "https://hpo.jax.org", note: "el vocabulario de síntomas que usa la búsqueda (en inglés)" },
                ],
            },
        ],
    });

    const model: ReportBlock[] = [
        {
            kind: "paragraph",
            text:
                "Los términos HPO se analizan con el modelo de Diagnostic.ar, una red neuronal basada en GenPhenIA que estima qué genes " +
                "se asocian más con ese conjunto de síntomas, entre 5.229 genes. " +
                "El orden es orientativo: el primero no es una respuesta y la lista se mira como un conjunto para investigar.",
        },
    ];
    if (MODEL_PAPER_URL) model.push({ kind: "links", links: [{ label: "Publicación del modelo", url: MODEL_PAPER_URL, note: "" }] });
    model.push({ kind: "links", links: [{ label: "Diagnostic.ar", url: SITE_URL, note: "donde se hizo esta búsqueda" }] });
    if (input.adjustedByAnswers) {
        model.push({ kind: "paragraph", text: "Es la lista ajustada con las respuestas a las preguntas de seguimiento." });
    }
    model.push({
        kind: "genes",
        title: `Genes sugeridos (${input.genes.length}), en el orden del modelo:`,
        genes: input.genes.map((gene, index) => ({
            rank: index + 1,
            symbol: gene.symbol,
            description: briefGeneSummary(gene.summary),
            links: [{ label: "Ficha en GeneCards", url: geneCardsUrl(gene.symbol) }],
        })),
    });
    if (input.specialties.length) {
        model.push({ kind: "paragraph", text: `Especialidades sugeridas: ${input.specialties.join(", ")}.` });
    }
    sections.push({ title: "3. Resultado del modelo", blocks: model, newPage: true });

    return { title: "Resumen de la búsqueda", subtitle: `Diagnostic.ar · ${date} · Resultado orientativo, no es un diagnóstico`, sections };
}

function termToText(t: ReportTerm): string {
    return `- ${t.label} (${t.code})${t.detail ? ` · ${t.detail}` : ""}${t.url ? ` — ${t.url}` : ""}`;
}

/** The same summary as plain text, for a message or a clinical note. */
export function reportToText(report: Report): string {
    const out: string[] = [report.title, report.subtitle];
    for (const section of report.sections) {
        out.push("", section.title.toUpperCase());
        for (const block of section.blocks) {
            if (block.kind === "paragraph") out.push(block.text);
            else if (block.kind === "list") out.push(...block.items.map((item) => `- ${item}`));
            else if (block.kind === "terms") out.push(...block.terms.map(termToText));
            else if (block.kind === "genes") {
                out.push(block.title);
                for (const gene of block.genes) {
                    out.push(`${gene.rank}. ${gene.symbol}${gene.description ? ` — ${gene.description}` : ""}`);
                    out.push(...gene.links.map((l) => `   ${l.label}: ${l.url}`));
                }
            }
            else out.push(...block.links.map((l) => `- ${l.label}${l.note ? ` (${l.note})` : ""}: ${l.url}`));
        }
    }
    return out.join("\n");
}

/** "diagnosticar-resumen-2026-10-05.pdf". */
export function reportFileName(date: Date): string {
    const pad = (n: number) => String(n).padStart(2, "0");
    return `diagnosticar-resumen-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.pdf`;
}
