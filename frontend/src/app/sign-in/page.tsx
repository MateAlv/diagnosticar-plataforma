"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "../../lib/auth-context";

const PROVINCES_AR = [
  "Buenos Aires",
  "Ciudad Autónoma de Buenos Aires",
  "Catamarca",
  "Chaco",
  "Chubut",
  "Córdoba",
  "Corrientes",
  "Entre Ríos",
  "Formosa",
  "Jujuy",
  "La Pampa",
  "La Rioja",
  "Mendoza",
  "Misiones",
  "Neuquén",
  "Río Negro",
  "Salta",
  "San Juan",
  "San Luis",
  "Santa Cruz",
  "Santa Fe",
  "Santiago del Estero",
  "Tierra del Fuego",
  "Tucumán",
];

export default function SignInPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [country, setCountry] = useState("Argentina");
  const [province, setProvince] = useState("");
  const [locality, setLocality] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { register, user, loading } = useAuth();

  useEffect(() => {
    if (!loading && user) {
      router.replace("/");
    }
  }, [loading, user, router]);

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");

    if (!email || !password || !confirmPassword || !province) {
      setError("Completa los campos obligatorios antes de continuar.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Las contraseñas no coinciden.");
      return;
    }

    setSubmitting(true);
    register({
      email,
      password,
      name: null,
      organization: [province, locality, country].filter(Boolean).join(" / ") || undefined,
    })
      .then(() => router.replace("/"))
      .catch((err) => setError(err.message ?? "No se pudo completar la solicitud."))
      .finally(() => setSubmitting(false));
  };

  return (
    <main className="relative min-h-screen flex items-center justify-center px-6 py-16">
      <div className="hex-bg" aria-hidden />

      <div className="panel-lg w-full">
        <div className="flex items-center justify-center mb-8">
          <Image src="/brand/logo.png" alt="LUCAI" width={160} height={36} priority />
        </div>

        <h2 className="kicker">Ready to join the next generation of AI learners?</h2>

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
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            required
          />

          <select
            className="combo-field"
            value={country}
            onChange={(event) => setCountry(event.target.value)}
          >
            <option value="Argentina">Argentina</option>
            <option value="Chile">Chile</option>
            <option value="Uruguay">Uruguay</option>
            <option value="Paraguay">Paraguay</option>
          </select>

          <select
            className="combo-field"
            value={province}
            onChange={(event) => setProvince(event.target.value)}
            required
          >
            <option value="" disabled>
              Provincia
            </option>
            {PROVINCES_AR.map((provincia) => (
              <option key={provincia} value={provincia}>
                {provincia}
              </option>
            ))}
          </select>

          <input
            className="pill-input"
            placeholder="Localidad (opcional)"
            type="text"
            value={locality}
            onChange={(event) => setLocality(event.target.value)}
            autoComplete="address-level2"
          />

          <div className="relative">
            <input
              className="pill-input w-full pr-14"
              placeholder="Contraseña"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              required
            />
            <button
              type="button"
              onClick={() => setShowPassword((prev) => !prev)}
              aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
              className="eye-btn eye-ghost"
            >
              {showPassword ? (
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
              placeholder="Repetir contraseña"
              type={showConfirmPassword ? "text" : "password"}
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              autoComplete="new-password"
              required
            />
            <button
              type="button"
              onClick={() => setShowConfirmPassword((prev) => !prev)}
              aria-label={showConfirmPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
              className="eye-btn eye-ghost"
            >
              {showConfirmPassword ? (
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

          {error && <p className="text-sm text-red-400">{error}</p>}

          <button type="submit" className="btn-outline btn-enter" disabled={submitting}>
            {submitting ? "Enviando…" : "Enviar"}
          </button>
        </form>
      </div>
    </main>
  );
}
