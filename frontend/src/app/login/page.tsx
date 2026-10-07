"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ErrorNotice } from "@/components/ui/ErrorNotice";
import { errorMessage } from "@/lib/api-errors";
import { useAuth } from "../../lib/auth-context";

// Where the backend's Google callback sends a failed sign-in (?error=...).
const GOOGLE_ERRORS: Record<string, string> = {
  google_auth_unavailable: "El ingreso con Google no está disponible ahora. Entrá con tu email y contraseña.",
};
const GOOGLE_FAILED = "No pudimos completar el ingreso con Google. Probá de nuevo o entrá con tu email y contraseña.";

/** Only a path on this site, never another origin. */
function safeNext(value: string | null): string {
  return value && value.startsWith("/") && !value.startsWith("//") ? value : "/";
}

export default function LoginPage() {
  const r = useRouter();
  const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api";
  const googleAuthUrl = `${API_URL}/auth/oauth/google`;
  const [email, setEmail] = useState("");
  const [pass, setPass]   = useState("");
  const [show, setShow]   = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [next, setNext] = useState("/");
  const { login, user, loading } = useAuth();

  // Read once on arrival rather than with useSearchParams, which would need a
  // Suspense boundary around the whole page.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setNext(safeNext(params.get("next")));
    const google = params.get("error");
    if (google?.startsWith("google_")) setError(GOOGLE_ERRORS[google] ?? GOOGLE_FAILED);
    else if (params.get("motivo") === "sesion") setNotice("Tu sesión se cerró. Iniciá sesión de nuevo para seguir.");
  }, []);

  useEffect(() => {
    if (!loading && user) {
      r.replace(next);
    }
  }, [loading, user, r, next]);

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!email || !pass) return;
    setSubmitting(true);
    setError(null);
    setNotice(null);
    login({ email, password: pass })
      .then(() => r.replace(next))
      .catch((err) => {
        console.error("[login]", err);
        setError(errorMessage(err, "login"));
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
            <p className="mt-1 text-[color:var(--lu-subtle)]">No vendemos tus datos ni enviamos publicidad.</p>
          </div>

          <div className="mt-6">
            <a href={googleAuthUrl} className="btn-google">
              <svg viewBox="0 0 48 48" aria-hidden="true">
                <path
                  fill="#FFC107"
                  d="M43.611 20.083H42V20H24v8h11.303c-1.644 4.657-6.107 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.613 6.053 29.63 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"
                />
                <path
                  fill="#FF3D00"
                  d="M6.306 14.691l6.571 4.819C14.655 16.108 19.012 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.613 6.053 29.63 4 24 4c-7.682 0-14.344 3.473-17.694 8.691z"
                />
                <path
                  fill="#4CAF50"
                  d="M24 44c5.258 0 10.176-2.012 13.857-5.297l-6.398-5.414C29.408 35.091 26.809 36 24 36c-5.297 0-9.787-3.666-11.297-8.57l-6.522 5.023C9.502 39.556 16.227 44 24 44z"
                />
                <path
                  fill="#1976D2"
                  d="M43.611 20.083H42V20H24v8h11.303c-.723 2.269-2.231 4.198-4.354 5.288l6.398 5.414C36.879 41.562 44 36 44 24c0-1.341-.138-2.65-.389-3.917z"
                />
              </svg>
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

            {notice && (
              <p role="status" className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                {notice}
              </p>
            )}
            <ErrorNotice message={error} />

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
