"use client";

import Link from "next/link";

/**
 * The express consent Ley 25.326 asks for health data (art. 7) and for sending
 * it abroad (art. 12), as the sign-up checkbox reads it.
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
