/**
 * The summary as a PDF, drawn in the browser with jsPDF. The library is loaded
 * only when someone asks for the file, so it costs nothing to the page.
 */

import type { Report, ReportBlock, ReportGene, ReportTerm } from "./results-report";

// jsPDF's built-in fonts cover Latin-1 and the WinAnsi extras; anything else
// would come out as garbage, so it is spelled out or replaced.
const REPLACEMENTS: Record<string, string> = {
    "≥": ">=",
    "≤": "<=",
    "→": "->",
    "α": "alfa",
    "β": "beta",
    "γ": "gamma",
    "δ": "delta",
    "κ": "kappa",
    "μ": "mu",
};
const WIN_ANSI_EXTRAS = new Set("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ");

export function pdfSafe(text: string): string {
    let out = "";
    for (const ch of text.normalize("NFC")) {
        if (REPLACEMENTS[ch] !== undefined) out += REPLACEMENTS[ch];
        else if (ch.charCodeAt(0) <= 0xff || WIN_ANSI_EXTRAS.has(ch)) out += ch;
        else out += "?";
    }
    return out;
}

const TEAL: [number, number, number] = [17, 94, 89];
const TEXT: [number, number, number] = [30, 41, 59];
const SUBTLE: [number, number, number] = [100, 116, 139];
const LINK: [number, number, number] = [15, 98, 254];

export async function reportToPdfBlob(report: Report): Promise<Blob> {
    const { jsPDF } = await import("jspdf");
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const margin = 48;
    const width = pageW - margin * 2;
    let y = margin;

    const ensure = (height: number) => {
        if (y + height > pageH - margin - 18) {
            doc.addPage();
            y = margin;
        }
    };

    const write = (text: string, size: number, opts: { bold?: boolean; color?: [number, number, number]; indent?: number; gap?: number } = {}) => {
        doc.setFont("helvetica", opts.bold ? "bold" : "normal");
        doc.setFontSize(size);
        doc.setTextColor(...(opts.color ?? TEXT));
        const indent = opts.indent ?? 0;
        const lines = doc.splitTextToSize(pdfSafe(text), width - indent) as string[];
        const lineH = size * 1.35;
        for (const line of lines) {
            ensure(lineH);
            doc.text(line, margin + indent, y + size);
            y += lineH;
        }
        y += opts.gap ?? 4;
    };

    const link = (label: string, url: string, note: string) => {
        doc.setFontSize(10.5);
        ensure(16);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(...LINK);
        const safeLabel = pdfSafe(label);
        doc.textWithLink(safeLabel, margin + 10, y + 10.5, { url });
        const labelW = doc.getTextWidth(safeLabel);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(...SUBTLE);
        const rest = pdfSafe(`${note ? ` — ${note}` : ""}  ${url}`);
        const restLines = doc.splitTextToSize(rest, width - 10 - labelW) as string[];
        doc.text(restLines[0] ?? "", margin + 10 + labelW, y + 10.5);
        y += 15;
        for (const line of restLines.slice(1)) {
            ensure(15);
            doc.text(line, margin + 10, y + 10.5);
            y += 15;
        }
    };

    // A bullet with the HPO code after it, the code linked to its page.
    const termRow = (t: ReportTerm) => {
        const size = 10.5;
        const lineH = size * 1.35;
        const indent = 10;
        doc.setFont("helvetica", "normal");
        doc.setFontSize(size);
        const code = pdfSafe(t.code);
        const codeW = doc.getTextWidth(code);
        const lines = doc.splitTextToSize(pdfSafe(`•  ${t.label}${t.detail ? ` · ${t.detail}` : ""}`), width - indent) as string[];
        lines.forEach((line, i) => {
            ensure(lineH);
            doc.setTextColor(...TEXT);
            doc.text(line, margin + indent, y + size);
            if (i === lines.length - 1) {
                const after = margin + indent + doc.getTextWidth(line) + 8;
                const fits = after + codeW <= margin + width;
                if (!fits) {
                    y += lineH;
                    ensure(lineH);
                }
                const x = fits ? after : margin + indent + 12;
                doc.setTextColor(...(t.url ? LINK : SUBTLE));
                if (t.url) doc.textWithLink(code, x, y + size, { url: t.url });
                else doc.text(code, x, y + size);
            }
            y += lineH;
        });
        y += 1;
    };

    // One gene: rank, symbol and score band, what it does, its links, and the
    // medical detail when asked for. The head is kept on one page with its
    // description; a long detail flows on.
    const geneEntry = (g: ReportGene) => {
        const indent = 24;
        doc.setFontSize(9.5);
        doc.setFont("helvetica", "normal");
        const description = g.description
            ? (doc.splitTextToSize(pdfSafe(g.description), width - indent) as string[])
            : [];
        ensure(16 + description.length * 12.5 + g.links.length * 13 + 8);

        doc.setFontSize(11);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(...SUBTLE);
        doc.text(`${g.rank}.`, margin, y + 11);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(...TEXT);
        const symbol = pdfSafe(g.symbol);
        doc.text(symbol, margin + indent, y + 11);
        const scoreX = margin + indent + doc.getTextWidth(symbol) + 12;
        doc.setFontSize(9);
        const score = pdfSafe(g.score);
        if (g.high) {
            // Outlined, as the card is on screen, and bold, so it survives a
            // black-and-white print.
            doc.setFont("helvetica", "bold");
            const w = doc.getTextWidth(score) + 10;
            doc.setDrawColor(...TEAL);
            doc.setLineWidth(1);
            doc.roundedRect(scoreX - 5, y + 1, w, 13, 3, 3, "S");
            doc.setTextColor(...TEAL);
        } else {
            doc.setFont("helvetica", "normal");
            doc.setTextColor(...SUBTLE);
        }
        doc.text(score, scoreX, y + 10.5);
        y += 18;

        doc.setFontSize(9.5);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(...TEXT);
        for (const line of description) {
            doc.text(line, margin + indent, y + 9.5);
            y += 12.5;
        }
        for (const l of g.links) {
            const label = pdfSafe(`${l.label}: `);
            doc.setTextColor(...SUBTLE);
            doc.text(label, margin + indent, y + 9.5);
            doc.setTextColor(...LINK);
            const url = pdfSafe(l.url);
            doc.textWithLink(url, margin + indent + doc.getTextWidth(label), y + 9.5, { url: l.url });
            y += 13;
        }
        for (const detail of g.details) {
            ensure(26);
            write(detail.heading, 9, { bold: true, indent, gap: 0 });
            for (const line of detail.lines) write(`•  ${line}`, 8.5, { indent: indent + 8, gap: 0 });
            y += 2;
        }
        y += 8;
    };

    const block = (b: ReportBlock) => {
        if (b.kind === "paragraph") write(b.text, 10.5, { bold: b.emphasis });
        else if (b.kind === "list") for (const item of b.items) write(`•  ${item}`, 10.5, { indent: 10, gap: 1 });
        else if (b.kind === "terms") {
            for (const t of b.terms) termRow(t);
            y += 3;
        } else if (b.kind === "links") for (const l of b.links) link(l.label, l.url, l.note);
        else {
            ensure(60);
            write(b.title, 10.5, { bold: true, gap: 8 });
            for (const g of b.genes) geneEntry(g);
        }
    };

    write("Diagnostic.ar", 11, { bold: true, color: TEAL, gap: 0 });
    write(report.title, 20, { bold: true, gap: 2 });
    write(report.subtitle, 10, { color: SUBTLE, gap: 10 });
    doc.setDrawColor(...TEAL);
    doc.setLineWidth(1);
    doc.line(margin, y, pageW - margin, y);
    y += 14;

    for (const section of report.sections) {
        if (section.notice) {
            // A tinted box, drawn behind the text once its height is known.
            const top = y;
            const page = doc.getCurrentPageInfo().pageNumber;
            y += 10;
            write(section.title, 12, { bold: true, color: TEAL, indent: 12, gap: 4 });
            for (const b of section.blocks) {
                if (b.kind === "paragraph") write(b.text, 10.5, { bold: b.emphasis, indent: 12 });
            }
            if (doc.getCurrentPageInfo().pageNumber === page) {
                doc.setFillColor(236, 253, 245);
                doc.setDrawColor(...TEAL);
                doc.roundedRect(margin, top, width, y - top + 4, 6, 6, "S");
            }
            y += 18;
            continue;
        }
        if (section.newPage && y > margin) {
            doc.addPage();
            y = margin;
        }
        ensure(40);
        write(section.title, 13.5, { bold: true, color: TEAL, gap: 6 });
        for (const b of section.blocks) block(b);
        y += 8;
    }

    const pages = doc.getNumberOfPages();
    for (let p = 1; p <= pages; p++) {
        doc.setPage(p);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8.5);
        doc.setTextColor(...SUBTLE);
        doc.text(
            pdfSafe(`Diagnostic.ar · Resultado orientativo, no es un diagnóstico · Página ${p} de ${pages}`),
            margin,
            pageH - margin / 2,
        );
    }

    return doc.output("blob");
}

/** Hands the browser the file, as a normal download. */
export function saveBlob(blob: Blob, fileName: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
