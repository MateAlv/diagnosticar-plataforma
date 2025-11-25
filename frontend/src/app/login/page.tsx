"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../../lib/auth-context";

export default function LoginPage() {
  const r = useRouter();
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
    <main className="relative min-h-screen flex items-center justify-center px-6 py-16">
      <div className="hex-bg" aria-hidden />

      <div className="panel-lg w-full">
        <div className="flex items-center justify-center mb-8">
          <Image src="/brand/logo.png" alt="LUCAI" width={160} height={36} priority />
        </div>

        <h2 className="kicker">Ready to unlock your true potential?</h2>

        <form
          onSubmit={onSubmit}
          className="mx-auto max-w-3xl grid gap-6"
          style={{ "--send-w": "96px" } as React.CSSProperties}
        >
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
              placeholder="Password"
              type={show ? "text" : "password"}
              value={pass}
              onChange={(e) => setPass(e.target.value)}
              autoComplete="current-password"
              required
            />
            <button
              type="button"
              onClick={() => setShow((s) => !s)}
              aria-label={show ? "Hide password" : "Show password"}
              className="eye-btn eye-ghost"
            >
              {show ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                     strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-5 0-9.27-3.11-11-8 1.03-2.89 2.99-5.23 5.5-6.74"/>
                  <path d="M1 1l22 22"/>
                  <path d="M9.88 9.88A3 3 0 0 0 12 15a3 3 0 0 0 2.12-.88"/>
                  <path d="M10.73 5.08A10.94 10.94 0 0 1 12 4c5 0 9.27 3.11 11 8a11.66 11.66 0 0 1-2.62 3.95"/>
                </svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                     strokeLinecap="round" strokeLinejoin="round">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z"/>
                  <circle cx="12" cy="12" r="3"/>
                </svg>
              )}
            </button>
          </div>

          {error && <p className="text-sm text-red-400" role="alert">{error}</p>}

          <button type="submit" className="btn-outline btn-enter" disabled={submitting}>
            {submitting ? "Ingresando…" : "Enter"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-[color:var(--lu-subtle)]">
          ¿Primera vez en LUCAI?{" "}
          <Link href="/sign-up" className="nav-link inline-flex items-center">
            Crear cuenta
          </Link>
        </p>
      </div>
    </main>
  );
}
