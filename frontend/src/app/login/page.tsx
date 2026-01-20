"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../../lib/auth-context";

export default function LoginPage() {
  const r = useRouter();
  const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api";
  const googleAuthUrl = `${API_URL}/auth/oauth/google`;
  const [email, setEmail] = useState("");
  const [pass, setPass]   = useState("");
  const [show, setShow]   = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const { login, user, loading } = useAuth();
  const friendlyErrors = useMemo(
    () => ({
      "invalid-credentials": "Email o contraseña incorrectos.",
      "user-inactive": "Tu cuenta está deshabilitada. Escribinos para reactivarla.",
      "backend-unreachable": "Servidor no disponible. Reintentá en unos segundos.",
      "login-failed": "No pudimos iniciar sesión. Revisá tus datos.",
    }),
    [],
  );

  useEffect(() => {
    if (!loading && user) {
      r.replace("/");
    }
  }, [loading, user, r]);

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!email || !pass) return;
    setSubmitting(true);
    setError(null);
    login({ email, password: pass })
      .then(() => r.replace("/"))
      .catch((err) => {
        const raw = err instanceof Error ? err.message : String(err);
        const normalized = raw.toLowerCase();
        const friendly =
          friendlyErrors[normalized as keyof typeof friendlyErrors] ??
          "No pudimos iniciar sesión. Verificá tus datos e intentá nuevamente.";
        setError(friendly);
      })
      .finally(() => setSubmitting(false));
  };

  return (
    <main className="relative min-h-screen overflow-hidden bg-[var(--lu-surface)] text-[var(--lu-text)]">
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <div className="absolute left-1/2 top-1/2 h-[420px] w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--lu-green)] opacity-25 blur-3xl animate-breathe sm:h-[520px] sm:w-[520px]" />
      </div>

      <div className="relative mx-auto flex min-h-screen max-w-2xl items-center px-6 py-16">
        <div className="w-full rounded-[32px] border border-[var(--lu-border)] bg-white/80 p-10 shadow-[var(--lu-shadow)] backdrop-blur">
          <div className="text-center">
            <p className="text-xs uppercase tracking-[0.4em] text-[var(--lu-subtle)]">Diagnostic.ar</p>
            <h1 className="mt-3 text-3xl font-semibold text-[var(--lu-text)] md:text-4xl">Iniciar sesión</h1>
            <p className="mt-2 text-sm text-[var(--lu-subtle)] md:text-base">
              Accedé con tu email y contraseña para continuar.
            </p>
          </div>

          <div className="mt-6 rounded-2xl border border-[var(--lu-border)] bg-[var(--lu-accent-light)] p-4 text-sm text-[color:var(--lu-text)]">
            <p className="font-semibold">Tu privacidad es nuestra prioridad</p>
            <p className="mt-1 text-[color:var(--lu-subtle)]">No compartimos tus datos ni enviamos spam.</p>
          </div>

          <div className="mt-6">
            <a href={googleAuthUrl} className="btn-outline w-full justify-center">
              Continuar con Google
            </a>
          </div>

          <form onSubmit={onSubmit} className="mx-auto mt-8 grid gap-5">
            <input
              className="pill-input"
              placeholder="Email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />

            <div className="relative">
              <input
                className="pill-input w-full pr-14"
                placeholder="Contraseña"
                type={show ? "text" : "password"}
                value={pass}
                onChange={(e) => setPass(e.target.value)}
                autoComplete="current-password"
                required
              />
              <button
                type="button"
                onClick={() => setShow((s) => !s)}
                aria-label={show ? "Ocultar contraseña" : "Mostrar contraseña"}
                className="eye-btn eye-ghost"
              >
                {show ? (
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-5 0-9.27-3.11-11-8 1.03-2.89 2.99-5.23 5.5-6.74" />
                    <path d="M1 1l22 22" />
                    <path d="M9.88 9.88A3 3 0 0 0 12 15a3 3 0 0 0 2.12-.88" />
                    <path d="M10.73 5.08A10.94 10.94 0 0 1 12 4c5 0 9.27 3.11 11 8a11.66 11.66 0 0 1-2.62 3.95" />
                  </svg>
                ) : (
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
            </div>

            {error && (
              <p className="text-sm text-red-500" role="alert">
                {error}
              </p>
            )}

            <button type="submit" className="btn-success w-full justify-center" disabled={submitting}>
              {submitting ? "Ingresando…" : "Ingresar"}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-[color:var(--lu-subtle)]">
            ¿Primera vez en Diagnostic.ar?{" "}
            <Link href="/sign-up" className="nav-link inline-flex items-center">
              Crear cuenta
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
