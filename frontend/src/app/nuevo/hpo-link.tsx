"use client";

import type { ReactNode } from "react";
import { hpoTermUrl } from "@/lib/reference-links";

/** A symptom opening its HPO term page; plain text when the code is not an HPO id. */
export function HpoLink({ code, className, children }: { code: string; className?: string; children: ReactNode }) {
    const url = hpoTermUrl(code);
    if (!url) return <span className={className}>{children}</span>;
    return (
        <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            title="Ficha HPO del síntoma (se abre en otra pestaña, en inglés)"
            className={className}
        >
            {children}
        </a>
    );
}
