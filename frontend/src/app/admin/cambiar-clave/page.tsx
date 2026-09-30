"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { adminApi, adminErrorMessage } from "../admin-api";
import { Banner, Button, Field } from "../ui";

const MIN_LENGTH = 12;

export default function ChangePasswordPage() {
    const router = useRouter();
    const { logout } = useAuth();
    const [currentPassword, setCurrentPassword] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [confirmation, setConfirmation] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [done, setDone] = useState(false);
    const [busy, setBusy] = useState(false);

    const tooShort = newPassword.length > 0 && newPassword.length < MIN_LENGTH;
    const mismatch = confirmation.length > 0 && confirmation !== newPassword;
    const canSubmit =
        currentPassword.length > 0 &&
        newPassword.length >= MIN_LENGTH &&
        confirmation === newPassword &&
        newPassword !== currentPassword &&
        !busy;

    async function submit(event: React.FormEvent) {
        event.preventDefault();
        setError(null);
        setBusy(true);
        try {
            await adminApi.changePassword({ currentPassword, newPassword });
            setDone(true);
            // The change invalidated every session, including this one, so the
            // only sensible next step is signing in again.
            // Clearing the stale user too, or /login would bounce straight back.
            setTimeout(() => void logout().finally(() => router.replace("/login")), 2200);
        } catch (e) {
            setError(adminErrorMessage(e, "change_password"));
        } finally {
            setBusy(false);
        }
    }

    return (
        <main className="flex min-h-screen items-center justify-center px-6 py-12">
            <div className="w-full max-w-md">
                <div className="mb-8 flex justify-center">
                    <Image
                        src="/brand/logo-diagnosticar.svg"
                        alt="Diagnostic.ar"
                        width={280}
                        height={68}
                        className="h-11 w-auto"
                        priority
                    />
                </div>

                <div className="rounded-2xl border border-[var(--lu-border)] bg-white p-8 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_32px_-12px_rgba(15,23,42,0.15)]">
                    {done ? (
                        <div className="text-center">
                            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50">
                                <svg viewBox="0 0 20 20" fill="none" className="h-6 w-6" aria-hidden>
                                    <path
                                        d="m5 10.5 3.5 3.5L15 7"
                                        stroke="#10b981"
                                        strokeWidth="2"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                    />
                                </svg>
                            </div>
                            <h1 className="mt-4 font-[family-name:var(--font-sora)] text-xl font-semibold text-[var(--lu-text)]">
                                Contraseña actualizada
                            </h1>
                            <p className="mt-2 text-sm leading-relaxed text-[var(--lu-subtle)]">
                                Por seguridad se cerraron todas las sesiones. Te llevamos al inicio de sesión…
                            </p>
                        </div>
                    ) : (
                        <>
                            <p className="text-center text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--lu-subtle)]">
                                Diagnostic.ar
                            </p>
                            <h1 className="mt-2 text-center font-[family-name:var(--font-sora)] text-2xl font-semibold tracking-tight text-[var(--lu-text)]">
                                Elegí tu contraseña
                            </h1>
                            <p className="mt-2 text-center text-sm leading-relaxed text-[var(--lu-subtle)]">
                                Tu cuenta se creó con una contraseña temporal que también conoce quien te invitó.
                                Cambiala para poder continuar.
                            </p>

                            <form onSubmit={submit} className="mt-7 space-y-4">
                                <Field
                                    label="Contraseña temporal"
                                    type="password"
                                    autoComplete="current-password"
                                    required
                                    value={currentPassword}
                                    onChange={(e) => setCurrentPassword(e.target.value)}
                                />
                                <div>
                                    <Field
                                        label="Nueva contraseña"
                                        type="password"
                                        autoComplete="new-password"
                                        required
                                        value={newPassword}
                                        onChange={(e) => setNewPassword(e.target.value)}
                                    />
                                    <p
                                        className={`mt-1.5 text-xs ${tooShort ? "text-amber-600" : "text-[var(--lu-subtle)]"}`}
                                    >
                                        Mínimo {MIN_LENGTH} caracteres.
                                    </p>
                                </div>
                                <div>
                                    <Field
                                        label="Repetir nueva contraseña"
                                        type="password"
                                        autoComplete="new-password"
                                        required
                                        value={confirmation}
                                        onChange={(e) => setConfirmation(e.target.value)}
                                    />
                                    {mismatch && <p className="mt-1.5 text-xs text-rose-600">No coinciden.</p>}
                                </div>

                                {error && <Banner tone="error">{error}</Banner>}

                                <Button type="submit" disabled={!canSubmit} className="w-full">
                                    {busy ? "Guardando…" : "Guardar y continuar"}
                                </Button>
                            </form>
                        </>
                    )}
                </div>
            </div>
        </main>
    );
}
