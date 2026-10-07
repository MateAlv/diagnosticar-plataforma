"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { ErrorNotice } from "@/components/ui/ErrorNotice";
import { errorMessage } from "@/lib/api-errors";
import { useAuth } from "@/lib/auth-context";

/**
 * The account and the one irreversible thing that can be done to it: deleting
 * it with everything it loaded. The person types their own email to confirm.
 */
export default function CuentaPage() {
    const router = useRouter();
    const { user, loading, deleteAccount } = useAuth();
    const confirmId = useId();
    const [confirmation, setConfirmation] = useState("");
    const [busy, setBusy] = useState(false);
    const [failure, setFailure] = useState<unknown>(null);
    const [deleted, setDeleted] = useState(false);

    useEffect(() => {
        if (!loading && !user && !deleted) router.replace("/login");
    }, [loading, user, deleted, router]);

    const email = user?.email ?? "";
    const matches = email !== "" && confirmation.trim().toLowerCase() === email.trim().toLowerCase();

    async function borrar(event: React.FormEvent) {
        event.preventDefault();
        if (!matches) return;
        setBusy(true);
        setFailure(null);
        try {
            await deleteAccount(confirmation);
            setDeleted(true);
        } catch (error) {
            console.error("[cuenta] delete failed", error);
            setFailure(error);
        } finally {
            setBusy(false);
        }
    }

    if (!deleted && (loading || !user)) {
        return (
            <main className="flex min-h-screen items-center justify-center bg-[var(--lu-bg)]">
                <p className="text-sm text-[var(--lu-subtle)]">Verificando sesión…</p>
            </main>
        );
    }

    return (
        <main className="min-h-screen bg-[var(--lu-surface)] px-4 py-10 sm:px-6">
            <div className="mx-auto max-w-xl">
                <Link href="/home" aria-label="Ir al inicio" className="inline-flex">
                    <Image src="/brand/logo-diagnosticar.svg" alt="Diagnostic.ar" width={222} height={40} className="h-9 w-auto" priority />
                </Link>

                {deleted ? (
                    <section className="mt-10 rounded-2xl border border-[var(--lu-border)] bg-white p-8" role="status">
                        <h1 className="text-2xl font-bold text-[var(--lu-text)]">Tu cuenta se borró</h1>
                        <p className="mt-3 text-base leading-relaxed text-[var(--lu-subtle)]">
                            Borramos tu cuenta y todo lo que habías cargado. Gracias por usar Diagnostic.ar.
                        </p>
                        <Link href="/home" className="btn-success mt-6 justify-center">
                            Volver al inicio
                        </Link>
                    </section>
                ) : (
                    <>
                        <h1 className="mt-10 text-3xl font-bold text-[var(--lu-text)]">Tu cuenta</h1>
                        <p className="mt-2 text-base text-[var(--lu-subtle)]">
                            Entraste como <strong className="text-[var(--lu-text)]">{email}</strong>.
                        </p>
                        <p className="mt-4 text-base">
                            <Link href="/diagnosticar" className="font-semibold text-[var(--lu-accent-text)] underline underline-offset-2">
                                Ver las personas y búsquedas guardadas
                            </Link>
                        </p>

                        <section aria-labelledby="borrar-titulo" className="mt-10 rounded-2xl border border-red-200 bg-white p-6">
                            <h2 id="borrar-titulo" className="text-xl font-bold text-[var(--lu-text)]">
                                Borrar la cuenta
                            </h2>
                            <p className="mt-3 text-base leading-relaxed text-[var(--lu-text)]">
                                Se borran tu cuenta, todas las personas que cargaste y todas sus búsquedas, resultados y
                                respuestas. <strong>No se puede deshacer.</strong>
                            </p>
                            <p className="mt-2 text-sm leading-relaxed text-[var(--lu-subtle)]">
                                Si querés conservar algún resumen, descargalo antes desde la búsqueda. Lo borrado
                                puede seguir un tiempo en las copias de seguridad, hasta que se reemplazan solas. Más
                                detalle en los{" "}
                                <Link href="/terminos#conservacion" className="font-semibold text-[var(--lu-accent-text)] underline underline-offset-2">
                                    términos
                                </Link>
                                .
                            </p>

                            <form onSubmit={borrar} className="mt-5">
                                <label htmlFor={confirmId} className="block text-sm font-bold text-[var(--lu-text)]">
                                    Para confirmar, escribí tu email
                                </label>
                                <input
                                    id={confirmId}
                                    type="email"
                                    autoComplete="off"
                                    value={confirmation}
                                    onChange={(event) => setConfirmation(event.target.value)}
                                    placeholder={email}
                                    className="mt-2 w-full rounded-xl border border-[var(--lu-border)] bg-white px-4 py-3 text-base text-[var(--lu-text)] focus:border-red-400 focus:outline-none focus:ring-2 focus:ring-red-100"
                                />
                                <ErrorNotice className="mt-4" message={failure ? errorMessage(failure, "delete_account") : null} error={failure} />
                                <button
                                    type="submit"
                                    disabled={!matches || busy}
                                    className="mt-5 inline-flex h-11 w-full items-center justify-center rounded-xl bg-red-600 px-5 text-base font-semibold text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40"
                                >
                                    {busy ? "Borrando…" : "Borrar mi cuenta y todos sus datos"}
                                </button>
                            </form>
                        </section>
                    </>
                )}
            </div>
        </main>
    );
}
