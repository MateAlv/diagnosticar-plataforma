"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { ErrorNotice } from "@/components/ui/ErrorNotice";
import { errorMessage } from "@/lib/api-errors";
import { useAuth } from "@/lib/auth-context";

/**
 * The express consent Ley 25.326 asks for health data (art. 7) and for sending
 * it abroad (art. 12). The same words at sign-up and in the wizard, so an
 * account made with Google, or before the consent existed, gives exactly the
 * one a new account gives.
 */
export function HealthDataConsentText() {
    return (
        <>
            Autorizo al Grupo de Genómica Clínica (FCEN-UBA) a tratar los datos de salud que cargue para obtener
            la orientación, y a que el texto se procese con un servicio de inteligencia artificial de Anthropic, en
            Estados Unidos, como se explica en los{" "}
            <Link
                href="/terminos#datos-de-salud"
                target="_blank"
                className="font-semibold text-[var(--lu-accent-text)] underline underline-offset-2"
            >
                términos
            </Link>
            .
        </>
    );
}

/** Shown by the wizard, instead of the form, to an account that has not given the consent yet. */
export function HealthDataConsentGate() {
    const { giveHealthDataConsent } = useAuth();
    const [checked, setChecked] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const accept = async () => {
        setBusy(true);
        setError(null);
        try {
            await giveHealthDataConsent();
        } catch (failure) {
            console.error("[consent]", failure);
            setError(errorMessage(failure, "save"));
        } finally {
            setBusy(false);
        }
    };

    return (
        <main className="page-root relative min-h-screen bg-[var(--lu-bg)] px-4 py-10">
            <Link href="/home" className="mx-auto mb-8 flex w-fit" aria-label="Regresar al home">
                <Image src="/brand/logo-diagnosticar.svg" alt="Diagnostic.ar" width={360} height={88} className="h-12 w-auto" priority />
            </Link>
            <section
                aria-labelledby="consentimiento-titulo"
                className="mx-auto max-w-xl rounded-3xl border border-[var(--lu-border)] bg-white p-6 shadow-sm sm:p-8"
                data-health-consent
            >
                <h1 id="consentimiento-titulo" className="text-2xl font-bold text-[var(--lu-text)]">
                    Antes de cargar síntomas
                </h1>
                <p className="mt-3 text-base leading-relaxed text-[var(--lu-text)]">
                    Lo que vas a cargar son datos de salud. La ley de protección de datos personales pide tu
                    autorización expresa para tratarlos y para procesarlos fuera del país.
                </p>
                <label className="mt-5 flex items-start gap-3 text-sm leading-relaxed text-[var(--lu-text)]">
                    <input
                        type="checkbox"
                        checked={checked}
                        onChange={(event) => setChecked(event.target.checked)}
                        className="mt-1 h-4 w-4 shrink-0 rounded border-[var(--lu-border)] accent-[var(--lu-accent)]"
                    />
                    <span>
                        <HealthDataConsentText />
                    </span>
                </label>
                <ErrorNotice message={error} />
                <div className="mt-6 flex flex-wrap items-center gap-3">
                    <button
                        type="button"
                        onClick={accept}
                        disabled={!checked || busy}
                        className="btn-success justify-center disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        {busy ? "Guardando…" : "Autorizar y continuar"}
                    </button>
                    <Link href="/home" className="text-sm font-semibold text-[var(--lu-subtle)] hover:text-[var(--lu-text)]">
                        Volver al inicio
                    </Link>
                </div>
                <p className="mt-5 text-xs leading-relaxed text-[var(--lu-subtle)]">
                    Podés retirar la autorización y pedir que borremos tus datos escribiendo al grupo; el contacto
                    está en los términos.
                </p>
            </section>
        </main>
    );
}
