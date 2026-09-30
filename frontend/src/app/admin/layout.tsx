"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ReactNode, useEffect, useState } from "react";
import { useAuth } from "../../lib/auth-context";
import { adminApi, AdminAccessError, isSessionError, PasswordChangeRequiredError, Release } from "./admin-api";

const NAV = [
    { href: "/admin", label: "Resumen" },
    { href: "/admin/uso", label: "Uso clínico" },
    { href: "/admin/equipo", label: "Equipo" },
];

export default function AdminLayout({ children }: { children: ReactNode }) {
    const pathname = usePathname();
    const router = useRouter();
    const { user, loading, logout } = useAuth();
    const [release, setRelease] = useState<Release | null>(null);
    const [denied, setDenied] = useState(false);

    // The change-password screen lives under /admin but must stay reachable
    // while the account is still locked, so it opts out of the guard below.
    const isChangePassword = pathname === "/admin/cambiar-clave";

    useEffect(() => {
        if (isChangePassword) return;
        let cancelled = false;
        adminApi
            .release()
            .then((r) => !cancelled && setRelease(r))
            .catch((error) => {
                if (cancelled) return;
                if (error instanceof PasswordChangeRequiredError) {
                    router.replace("/admin/cambiar-clave");
                } else if (error instanceof AdminAccessError) {
                    setDenied(true);
                } else if (isSessionError(error)) {
                    router.replace("/login?motivo=sesion&next=/admin");
                } else {
                    console.error("[admin] release failed", error);
                }
            });
        return () => {
            cancelled = true;
        };
    }, [isChangePassword, router]);

    useEffect(() => {
        if (!loading && !user && !isChangePassword) router.replace("/login");
    }, [loading, user, router, isChangePassword]);

    if (isChangePassword) {
        return <div className="min-h-screen bg-[var(--lu-surface)]">{children}</div>;
    }

    if (denied) {
        return (
            <main className="flex min-h-screen items-center justify-center bg-[var(--lu-surface)] px-6">
                <div className="w-full max-w-md rounded-2xl border border-[var(--lu-border)] bg-white p-8 text-center shadow-sm">
                    <h1 className="font-[family-name:var(--font-sora)] text-xl font-semibold text-[var(--lu-text)]">
                        Panel no disponible
                    </h1>
                    <p className="mt-2 text-sm leading-relaxed text-[var(--lu-subtle)]">
                        Esta sección está reservada al equipo de administración de Diagnostic.ar.
                    </p>
                    <Link
                        href="/home"
                        className="mt-6 inline-flex h-10 items-center justify-center rounded-full bg-[var(--lu-accent)] px-5 text-sm font-semibold text-white transition hover:brightness-110"
                    >
                        Volver al inicio
                    </Link>
                </div>
            </main>
        );
    }

    return (
        <div className="min-h-screen bg-[var(--lu-surface)] text-[var(--lu-text)]">
            <header className="sticky top-0 z-30 border-b border-[var(--lu-border)] bg-white/85 backdrop-blur-md">
                <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-6 px-6 py-3">
                    <div className="flex min-w-0 items-center gap-4">
                        <Link href="/home" aria-label="Diagnostic.ar" className="shrink-0">
                            <Image
                                src="/brand/logo-diagnosticar.svg"
                                alt="Diagnostic.ar"
                                width={240}
                                height={58}
                                className="h-9 w-auto"
                                priority
                            />
                        </Link>
                        <span className="hidden h-5 w-px bg-[var(--lu-border)] sm:block" />
                        <span className="hidden shrink-0 rounded-full bg-[color-mix(in_oklab,var(--lu-accent)_12%,white)] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--lu-accent)] sm:inline-block">
                            Administración
                        </span>
                    </div>

                    <div className="flex items-center gap-3">
                        {release && (
                            <span
                                className="hidden items-center gap-2 rounded-full border border-[var(--lu-border)] px-3 py-1 text-xs text-[var(--lu-subtle)] lg:inline-flex"
                                title={`Commit ${release.commit}`}
                            >
                                <span
                                    className={`h-1.5 w-1.5 rounded-full ${release.environment === "production" ? "bg-[var(--lu-green)]" : "bg-amber-400"
                                        }`}
                                />
                                {release.version}
                            </span>
                        )}
                        {user?.email && (
                            <span className="hidden max-w-[200px] truncate text-sm text-[var(--lu-subtle)] md:block">
                                {user.email}
                            </span>
                        )}
                        <button
                            type="button"
                            onClick={() => logout()}
                            className="rounded-full border border-[var(--lu-border)] px-3.5 py-1.5 text-sm font-medium text-[var(--lu-text)] transition hover:border-[var(--lu-accent)] hover:text-[var(--lu-accent)]"
                        >
                            Salir
                        </button>
                    </div>
                </div>

                <nav className="mx-auto flex max-w-[1400px] gap-1 px-6">
                    {NAV.map((item) => {
                        const active = pathname === item.href;
                        return (
                            <Link
                                key={item.href}
                                href={item.href}
                                aria-current={active ? "page" : undefined}
                                className={`relative -mb-px border-b-2 px-3 py-2.5 text-sm font-medium transition-colors ${active
                                        ? "border-[var(--lu-accent)] text-[var(--lu-accent)]"
                                        : "border-transparent text-[var(--lu-subtle)] hover:text-[var(--lu-text)]"
                                    }`}
                            >
                                {item.label}
                            </Link>
                        );
                    })}
                </nav>
            </header>

            <main className="mx-auto max-w-[1400px] px-6 py-8">{children}</main>
        </div>
    );
}
