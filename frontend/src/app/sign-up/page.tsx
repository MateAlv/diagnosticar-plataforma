"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "../../lib/auth-context";

export default function SignUpPage() {
  const router = useRouter();

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [organization, setOrganization] = useState("");
  const [showMainPass, setShowMainPass] = useState(false);
  const [showConfirmPass, setShowConfirmPass] = useState(false);
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

    setError(null);
    setSubmitting(true);
    register({
      email,
      password,
      name: fullName,
      organization: organization || null,
    })
      .then(() => setSuccess(true))
      .catch((err) => {
        setError(err.message ?? "No se pudo crear la cuenta.");
      })
      .finally(() => setSubmitting(false));
  };

  if (success) {
    return (
      <main className="relative min-h-screen flex items-center justify-center px-6 py-16">
        <div className="hex-bg" aria-hidden />
        <div className="panel-lg w-full text-center">
          <h2 className="kicker mb-4">¡Cuenta creada!</h2>
          <p className="mb-6">Te enviamos un email a <strong>{email}</strong> para verificar tu cuenta.</p>
          <p className="text-sm text-[color:var(--lu-subtle)]">
            Revisá tu bandeja de entrada (y spam). Una vez verificado, podrás{" "}
            <Link href="/login" className="nav-link">iniciar sesión</Link>.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="relative min-h-screen flex items-center justify-center px-6 py-16">
      <div className="hex-bg" aria-hidden />

      <div className="panel-lg w-full">
        <div className="flex items-center justify-center mb-8">
          <Image src="/brand/logo.png" alt="LUCAI" width={160} height={36} priority />
        </div>

        <h2 className="kicker">Join LUCAI and co-create the future of bio-AI</h2>

        <form
          onSubmit={handleSubmit}
          className="mx-auto max-w-3xl grid gap-6"
          style={{ "--send-w": "120px" } as React.CSSProperties}
        >
          <input
            className="pill-input"
            placeholder="Nombre o apodo"
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
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                  strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-5 0-9.27-3.11-11-8 1.03-2.89 2.99-5.23 5.5-6.74" />
                  <path d="M1 1l22 22" />
                  <path d="M9.88 9.88A3 3 0 0 0 12 15a3 3 0 0 0 2.12-.88" />
                  <path d="M10.73 5.08A10.94 10.94 0 0 1 12 4c5 0 9.27 3.11 11 8a11.66 11.66 0 0 1-2.62 3.95" />
                </svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                  strokeLinecap="round" strokeLinejoin="round">
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
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                  strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-5 0-9.27-3.11-11-8 1.03-2.89 2.99-5.23 5.5-6.74" />
                  <path d="M1 1l22 22" />
                  <path d="M9.88 9.88A3 3 0 0 0 12 15a3 3 0 0 0 2.12-.88" />
                  <path d="M10.73 5.08A10.94 10.94 0 0 1 12 4c5 0 9.27 3.11 11 8a11.66 11.66 0 0 1-2.62 3.95" />
                </svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                  strokeLinecap="round" strokeLinejoin="round">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              )}
            </button>
          </div>

          <input
            className="pill-input"
            placeholder="Organización / equipo (opcional)"
            value={organization}
            onChange={(event) => setOrganization(event.target.value)}
            autoComplete="organization"
          />

          {error && <p className="text-sm text-red-400">{error}</p>}

          <button type="submit" className="btn-success justify-center" disabled={submitting}>
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
    </main>
  );
}
