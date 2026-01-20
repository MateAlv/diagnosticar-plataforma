"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
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
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const { register, user, loading } = useAuth();

  useEffect(() => {
    if (!loading && user) {
      router.replace("/");
    }
  }, [loading, user, router]);

  const [success, setSuccess] = useState(false);

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

    setError(null);
    setSubmitting(true);
    register({
      email,
      password,
      name: fullName,
    })
      .then(() => setSuccess(true))
      .catch((err) => {
        setError(err.message ?? "No se pudo crear la cuenta.");
      })
      .finally(() => setSubmitting(false));
  };

  if (success) {
    return (
      <main className="relative min-h-screen overflow-hidden bg-[var(--lu-surface)] text-[var(--lu-text)]">
        <div className="pointer-events-none absolute inset-0" aria-hidden>
          <div className="absolute left-1/2 top-1/2 h-[420px] w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--lu-green)] opacity-25 blur-3xl animate-breathe sm:h-[520px] sm:w-[520px]" />
        </div>

        <div className="relative mx-auto flex min-h-screen max-w-2xl items-center px-6 py-16">
          <div className="w-full rounded-[32px] border border-[var(--lu-border)] bg-white/80 p-10 text-center shadow-[var(--lu-shadow)] backdrop-blur">
            <p className="text-xs uppercase tracking-[0.4em] text-[var(--lu-subtle)]">Diagnostic.ar</p>
            <h2 className="mt-3 text-3xl font-semibold text-[var(--lu-text)] md:text-4xl">¡Cuenta creada!</h2>
            <p className="mt-4 text-[color:var(--lu-text)]">
              Te enviamos un email a <strong>{email}</strong> para verificar tu cuenta.
            </p>
            <p className="mt-6 text-sm text-[color:var(--lu-subtle)]">
              Revisá tu bandeja de entrada (y spam). Una vez verificado, podrás{" "}
              <Link href="/login" className="nav-link">
                iniciar sesión
              </Link>
              .
            </p>
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
              <li>No compartimos tus datos con terceros ni enviamos spam.</li>
              <li>La opción de re-contacto es totalmente opcional.</li>
            </ul>
          </div>

          <div className="mt-6">
            <a href={googleAuthUrl} className="btn-outline w-full justify-center">
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
                Acepto los <strong className="text-[color:var(--lu-text)]">términos y condiciones</strong> (mock).
              </span>
            </label>

            {error && <p className="text-sm text-red-500">{error}</p>}

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
