"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * What a page shows when it fails while rendering. Never the exception: the
 * details go to the console for whoever is debugging, the reader gets what
 * happened in plain words and a way to try again.
 */
export default function ErrorPage({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
    useEffect(() => {
        console.error(error);
    }, [error]);

    return (
        <main className="flex min-h-screen items-center justify-center bg-[var(--lu-bg)] px-4">
            <div role="alert" className="w-full max-w-md rounded-3xl border border-[var(--lu-border)] bg-white p-8 text-center shadow-sm">
                <h1 className="text-2xl font-bold text-[var(--lu-text)]">Algo falló de nuestro lado</h1>
                <p className="mt-3 text-base leading-relaxed text-[var(--lu-subtle)]">
                    No es algo que hayas hecho vos. Tus datos guardados no se perdieron. Probá de nuevo; si sigue
                    pasando, volvé en unos minutos.
                </p>
                {error.digest && (
                    <p className="mt-3 text-xs text-[var(--lu-subtle)]">
                        Si nos escribís, mencioná este código: <span className="font-mono">{error.digest}</span>
                    </p>
                )}
                <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
                    <button type="button" onClick={() => retry()} className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-[var(--lu-accent-text)] px-5 font-semibold text-white hover:opacity-90">
                        Probar de nuevo
                    </button>
                    <Link
                        href="/home"
                        className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-[var(--lu-border-strong)] px-5 font-semibold text-[var(--lu-text)] hover:bg-[var(--lu-surface)]"
                    >
                        Volver al inicio
                    </Link>
                </div>
            </div>
        </main>
    );
}
