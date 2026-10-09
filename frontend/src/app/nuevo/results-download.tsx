"use client";

import { useState } from "react";
import { buildResultsReport, reportFileName, reportToText, type ReportInput } from "@/lib/results-report";

/**
 * «Descargar resumen (PDF)» and «Copiar como texto». Both are built from the
 * same report, in the browser: the clinical data never travels to make them.
 */
export function ResultsDownload({ input }: { input: () => ReportInput }) {
    const [busy, setBusy] = useState(false);
    const [copied, setCopied] = useState(false);
    const [failed, setFailed] = useState<string | null>(null);

    const download = async () => {
        setBusy(true);
        setFailed(null);
        try {
            const data = input();
            const report = buildResultsReport(data);
            const { reportToPdfBlob, saveBlob } = await import("@/lib/results-pdf");
            saveBlob(await reportToPdfBlob(report), reportFileName(data.date));
        } catch (error) {
            console.error("[resumen] pdf failed", error);
            setFailed("No pudimos armar el PDF. Probá de nuevo, o copiá el resumen como texto.");
        } finally {
            setBusy(false);
        }
    };

    const copy = async () => {
        setFailed(null);
        try {
            await navigator.clipboard.writeText(reportToText(buildResultsReport(input())));
            setCopied(true);
            setTimeout(() => setCopied(false), 2500);
        } catch (error) {
            console.error("[resumen] copy failed", error);
            setFailed("No pudimos copiar el resumen. Probá con «Descargar resumen (PDF)».");
        }
    };

    return (
        <section
            data-results-download
            aria-labelledby="resumen-descarga-titulo"
            className="flex flex-col gap-3 rounded-2xl border border-[var(--lu-border)] bg-[var(--lu-surface)] px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between"
        >
            <div className="min-w-0">
                <h4 id="resumen-descarga-titulo" className="text-sm font-semibold text-[var(--lu-text)]">
                    Resumen para llevar a la consulta
                </h4>
                <p className="mt-0.5 max-w-xl text-xs leading-relaxed text-[var(--lu-subtle)]">
                    Trae lo que contaste con sus términos HPO, los genes sugeridos con una breve descripción y su ficha,
                    qué son las enfermedades genéticas y dónde informarte, y el aviso. Con «Ver detalle médico» activado
                    suma el detalle médico de cada gen. Se arma en tu navegador: los datos no se envían a ningún lado.
                </p>
            </div>
            <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
                <button
                    type="button"
                    onClick={download}
                    disabled={busy}
                    className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[var(--lu-accent-text)] px-5 text-sm font-semibold text-white shadow-sm hover:opacity-90 disabled:cursor-wait disabled:opacity-60"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    {busy ? "Armando el PDF…" : "Descargar resumen (PDF)"}
                </button>
                <button
                    type="button"
                    onClick={copy}
                    className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-[var(--lu-border-strong)] bg-white px-5 text-sm font-semibold text-[var(--lu-text)] hover:bg-[var(--lu-bg)]"
                >
                    {copied ? "Copiado ✓" : "Copiar como texto"}
                </button>
            </div>
            {failed && (
                <p role="alert" className="text-sm text-red-800 sm:basis-full">
                    {failed}
                </p>
            )}
            <span role="status" className="sr-only">
                {copied ? "Resumen copiado" : ""}
            </span>
        </section>
    );
}
