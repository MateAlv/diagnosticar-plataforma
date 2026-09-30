import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Página no encontrada · Diagnostic.ar" };

export default function NotFound() {
    return (
        <main className="flex min-h-screen items-center justify-center bg-[var(--lu-bg)] px-4">
            <div className="w-full max-w-md rounded-3xl border border-[var(--lu-border)] bg-white p-8 text-center shadow-sm">
                <p className="text-sm font-semibold uppercase tracking-wide text-[var(--lu-accent-text)]">Error 404</p>
                <h1 className="mt-2 text-2xl font-bold text-[var(--lu-text)]">No encontramos esta página</h1>
                <p className="mt-3 text-base leading-relaxed text-[var(--lu-subtle)]">
                    Puede que el enlace esté mal escrito o que la página ya no exista. Tus búsquedas guardadas
                    siguen en tu cuenta.
                </p>
                <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
                    <Link href="/diagnosticar" className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-[var(--lu-accent-text)] px-5 font-semibold text-white hover:opacity-90">
                        Ir a mis búsquedas
                    </Link>
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
