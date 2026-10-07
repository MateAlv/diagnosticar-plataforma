"use client";

import Link from "next/link";
import { HealthDataConsentText } from "@/components/ui/HealthDataConsent";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ErrorNotice } from "@/components/ui/ErrorNotice";
import { errorMessage } from "@/lib/api-errors";
import { useAuth } from "../../lib/auth-context";

export default function SignUpPage() {
  const router = useRouter();
  const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api";
  const googleAuthUrl = `${API_URL}/auth/oauth/google`;

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showMainPass, setShowMainPass] = useState(false);
  const [showConfirmPass, setShowConfirmPass] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [acceptedHealthData, setAcceptedHealthData] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const { register, user, loading } = useAuth();

  useEffect(() => {
    if (!loading && user) {
      router.replace("/");
    }
  }, [loading, user, router]);

  const [outcome, setOutcome] = useState<"created" | "ambiguous" | null>(null);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (password !== confirmPassword) {
      setError("Las contraseñas no coinciden.");
      return;
    }

    if (password.length < 8) {
      setError("La contraseña debe tener al menos 8 caracteres.");
      return;
    }

    if (!fullName.trim()) {
      setError("Ingresá tu nombre o apodo para continuar.");
      return;
    }

    if (!acceptedTerms) {
      setError("Tenés que aceptar los términos y condiciones para continuar.");
      return;
    }

    if (!acceptedHealthData) {
      setError("Tenés que autorizar el tratamiento de los datos de salud para continuar.");
      return;
    }

    setError(null);
    setSubmitting(true);
    register({
      email,
      password,
      name: fullName,
      healthDataConsent: true,
    })
      .then(setOutcome)
      .catch((err) => {
        console.error("[sign-up]", err);
        setError(errorMessage(err, "signup"));
      })
      .finally(() => setSubmitting(false));
  };

  if (outcome) {
    return (
      <main className="relative min-h-screen overflow-hidden bg-[var(--lu-surface)] text-[var(--lu-text)]">
        <div className="pointer-events-none absolute inset-0" aria-hidden>
          <div className="absolute left-1/2 top-1/2 h-[420px] w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--lu-green)] opacity-25 blur-3xl animate-breathe sm:h-[520px] sm:w-[520px]" />
        </div>

        <div className="relative mx-auto flex min-h-screen max-w-2xl items-center px-6 py-16">
          <div className="w-full rounded-[32px] border border-[var(--lu-border)] bg-white/80 p-10 text-center shadow-[var(--lu-shadow)] backdrop-blur">
            <p className="text-xs uppercase tracking-[0.4em] text-[var(--lu-subtle)]">Diagnostic.ar</p>
            {outcome === "created" ? (
              <>
                <h2 className="mt-3 text-3xl font-semibold text-[var(--lu-text)] md:text-4xl">¡Cuenta creada!</h2>
                <p className="mt-4 text-[color:var(--lu-text)]">Ya podés empezar. Te llevamos al inicio.</p>
                <p className="mt-6 text-sm text-[color:var(--lu-subtle)]">
                  Si no pasa nada,{" "}
                  <Link href="/" className="nav-link">
                    entrá desde acá
                  </Link>
                  .
                </p>
              </>
            ) : (
              <>
                <h2 className="mt-3 text-3xl font-semibold text-[var(--lu-text)] md:text-4xl">¿Ya tenías una cuenta?</h2>
                <p className="mt-4 text-[color:var(--lu-text)]">
                  No pudimos crear una cuenta nueva con ese email. Si ya te registraste antes, iniciá sesión con
                  tu contraseña o con Google.
                </p>
                <Link href="/login" className="btn-success mt-6 justify-center">
                  Ir a iniciar sesión
                </Link>
              </>
            )}
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-[var(--lu-surface)] text-[var(--lu-text)]">
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <div className="absolute left-1/2 top-1/2 h-[420px] w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--lu-green)] opacity-25 blur-3xl animate-breathe sm:h-[520px] sm:w-[520px]" />
      </div>

      <div className="relative mx-auto flex min-h-screen max-w-3xl items-center px-6 py-16">
        <div className="w-full rounded-[32px] border border-[var(--lu-border)] bg-white/80 p-10 shadow-[var(--lu-shadow)] backdrop-blur">
          <div className="text-center">
            <p className="text-xs uppercase tracking-[0.4em] text-[var(--lu-subtle)]">Diagnostic.ar</p>
            <h2 className="mt-3 text-3xl font-semibold text-[var(--lu-text)] md:text-4xl">Creá tu cuenta</h2>
            <p className="mt-2 text-sm text-[var(--lu-subtle)] md:text-base">
              Registrate para guardar tus sesiones y continuar cuando quieras.
            </p>
          </div>

          <div className="mt-6 rounded-2xl border border-[var(--lu-border)] bg-[var(--lu-accent-light)] p-4 text-sm text-[color:var(--lu-text)]">
            <p className="font-semibold mb-2 flex items-center gap-2">
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
              Tu privacidad es nuestra prioridad
            </p>
            <ul className="list-disc list-inside space-y-1 text-[color:var(--lu-subtle)]">
              <li>
                <strong className="text-[color:var(--lu-text)]">No pedimos datos personales identificatorios</strong> (DNI,
                nombre real completo, etc.).
              </li>
              <li>
                Podés usar un <strong className="text-[color:var(--lu-text)]">nombre de fantasía</strong> o apodo.
              </li>
              <li>No vendemos tus datos ni los usamos con fines comerciales, y no enviamos publicidad.</li>
              <li>
                El texto que cargás lo procesa un servicio externo de inteligencia artificial. Los detalles están en los{" "}
                <Link href="/terminos" className="font-semibold text-[var(--lu-accent-text)] underline underline-offset-2">
                  términos
                </Link>
                .
              </li>
            </ul>
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

          <form onSubmit={handleSubmit} className="mx-auto mt-8 grid gap-5">
            <input
              className="pill-input"
              placeholder="Nombre de fantasía o Apodo"
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              autoComplete="name"
              required
            />

            <input
              className="pill-input"
              placeholder="Email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              required
            />

            <div className="relative">
              <input
                className="pill-input w-full pr-14"
                placeholder="Contraseña"
                type={showMainPass ? "text" : "password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="new-password"
                required
              />
              <button
                type="button"
                onClick={() => setShowMainPass((prev) => !prev)}
                aria-label={showMainPass ? "Ocultar contraseña" : "Mostrar contraseña"}
                className="eye-btn eye-ghost"
              >
                {showMainPass ? (
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

            <div className="relative">
              <input
                className="pill-input w-full pr-14"
                placeholder="Confirmar contraseña"
                type={showConfirmPass ? "text" : "password"}
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                autoComplete="new-password"
                required
              />
              <button
                type="button"
                onClick={() => setShowConfirmPass((prev) => !prev)}
                aria-label={showConfirmPass ? "Ocultar confirmación de contraseña" : "Mostrar confirmación de contraseña"}
                className="eye-btn eye-ghost"
              >
                {showConfirmPass ? (
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

            <label className="flex items-start gap-3 text-sm text-[color:var(--lu-subtle)]">
              <input
                type="checkbox"
                checked={acceptedTerms}
                onChange={(event) => setAcceptedTerms(event.target.checked)}
                className="mt-1 h-4 w-4 rounded border-[var(--lu-border)] accent-[var(--lu-accent)]"
                required
              />
              <span>
                Leí y acepto los{" "}
                <Link href="/terminos" target="_blank" className="font-semibold text-[var(--lu-accent-text)] underline underline-offset-2">
                  términos de uso y la política de privacidad
                </Link>
                .
              </span>
            </label>

            <label className="flex items-start gap-3 text-sm text-[color:var(--lu-subtle)]">
              <input
                type="checkbox"
                checked={acceptedHealthData}
                onChange={(event) => setAcceptedHealthData(event.target.checked)}
                className="mt-1 h-4 w-4 rounded border-[var(--lu-border)] accent-[var(--lu-accent)]"
                required
              />
              <span>
                <HealthDataConsentText />
              </span>
            </label>

            <ErrorNotice message={error} />

            <button type="submit" className="btn-success w-full justify-center" disabled={submitting}>
              {submitting ? "Creando…" : "Crear cuenta"}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-[color:var(--lu-subtle)]">
            ¿Ya tenés una cuenta?{" "}
            <Link href="/login" className="nav-link inline-flex items-center">
              Iniciar sesión
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
