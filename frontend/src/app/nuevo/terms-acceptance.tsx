"use client";

import { useState } from "react";
import { ErrorNotice } from "@/components/ui/ErrorNotice";
import { TermsCheckbox } from "@/components/ui/TermsCheckbox";
import { errorMessage } from "@/lib/api-errors";

type Props = {
    onAccept: () => Promise<void>;
    description: string;
};

/** Shown in place of the wizard until the current /terminos are accepted. */
export function TermsAcceptance({ onAccept, description }: Props) {
    const [checked, setChecked] = useState(false);
    const [saving, setSaving] = useState(false);
    const [failure, setFailure] = useState<unknown>(null);

    const aceptar = async () => {
        setSaving(true);
        setFailure(null);
        try {
            await onAccept();
        } catch (error) {
            console.error("[terminos] accept failed", error);
            setFailure(error);
        } finally {
            setSaving(false);
        }
    };

    return (
        <section aria-labelledby="terminos-titulo" className="mx-auto max-w-xl rounded-2xl border border-[var(--lu-border)] bg-white p-6">
            <h2 id="terminos-titulo" className="text-lg font-bold text-[var(--lu-text)]">
                Antes de empezar
            </h2>
            <p className="mt-2 text-base leading-relaxed text-[var(--lu-subtle)]">{description}</p>
            <TermsCheckbox checked={checked} onChange={setChecked} className="mt-4 text-base" />
            <ErrorNotice className="mt-4" message={failure ? errorMessage(failure, "accept_terms") : null} error={failure} />
            <button
                type="button"
                onClick={aceptar}
                disabled={!checked || saving}
                className="mt-5 inline-flex h-11 items-center justify-center rounded-xl bg-[var(--lu-accent)] px-6 text-base font-semibold text-white transition-colors hover:bg-[color-mix(in_oklab,var(--lu-accent)_88%,#000)] disabled:cursor-not-allowed disabled:opacity-40"
            >
                {saving ? "Guardando…" : "Continuar"}
            </button>
        </section>
    );
}
