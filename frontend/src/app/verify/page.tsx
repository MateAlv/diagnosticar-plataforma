"use client";

import Link from "next/link";
import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api";

type Status = "loading" | "success" | "invalid" | "error";

function VerifyScreen() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [status, setStatus] = useState<Status>("loading");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!token) {
      setStatus("invalid");
      return;
    }

    setStatus("loading");
    fetch(`${API_URL}/auth/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then((r) => {
        if (r.ok) setStatus("success");
        else if (r.status === 400) setStatus("invalid");
        else setStatus("error");
      })
      .catch(() => setStatus("error"));
  }, [token, attempt]);

  return (
    <main className="page-root relative min-h-screen flex items-center justify-center bg-[var(--lu-bg)]">
      <div className="max-w-md w-full mx-auto px-6 py-12 rounded-[32px] border border-[var(--lu-border)] bg-[var(--lu-surface)] shadow-[var(--lu-shadow)] text-center space-y-5">
        {status === "loading" && (
          <>
            <div className="mx-auto h-12 w-12 animate-spin rounded-full border-4 border-[var(--lu-border)] border-t-[var(--lu-accent)]" />
            <p className="text-sm text-[var(--lu-subtle)]">Verificando tu cuenta…</p>
          </>
        )}

        {status === "success" && (
          <>
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-green-100 text-green-600">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-[var(--lu-text)]">¡Cuenta verificada!</h1>
            <p className="text-sm text-[var(--lu-subtle)]">Tu dirección de correo fue confirmada. Ya podés iniciar sesión.</p>
            <Link
              href="/login"
              className="inline-flex items-center justify-center h-11 px-8 rounded-xl bg-[var(--lu-green)] text-white font-bold hover:bg-[color-mix(in_oklab,var(--lu-green)_90%,#000)] shadow-md transition-all"
            >
              Iniciar sesión
            </Link>
          </>
        )}

        {status === "invalid" && (
          <>
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-amber-100 text-amber-600">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-[var(--lu-text)]">Link inválido o expirado</h1>
            <p className="text-sm text-[var(--lu-subtle)]">
              Este enlace de verificación no es válido o ya fue utilizado. Si necesitás uno nuevo, intentá registrarte nuevamente.
            </p>
            <Link
              href="/sign-up"
              className="inline-flex items-center justify-center h-11 px-8 rounded-xl border border-[var(--lu-accent)] text-[var(--lu-accent)] font-bold hover:bg-[var(--lu-accent)] hover:text-white transition-all"
            >
              Volver al registro
            </Link>
          </>
        )}

        {status === "error" && (
          <>
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-red-100 text-red-500">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <circle cx="12" cy="12" r="10" />
                <line x1="15" y1="9" x2="9" y2="15" />
                <line x1="9" y1="9" x2="15" y2="15" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-[var(--lu-text)]">Algo salió mal</h1>
            <p className="text-sm text-[var(--lu-subtle)]">No pudimos verificar tu cuenta. Intentá de nuevo en unos segundos.</p>
            <button
              type="button"
              onClick={() => setAttempt((n) => n + 1)}
              className="inline-flex items-center justify-center h-11 px-8 rounded-xl border border-[var(--lu-border)] text-[var(--lu-text)] font-medium hover:bg-[var(--lu-surface)] transition-all"
            >
              Reintentar
            </button>
          </>
        )}
      </div>
    </main>
  );
}

export default function VerifyPage() {
  return (
    <Suspense
      fallback={
        <main className="page-root relative min-h-screen flex items-center justify-center bg-[var(--lu-bg)]">
          <div className="text-sm text-[var(--lu-subtle)]">Verificando…</div>
        </main>
      }
    >
      <VerifyScreen />
    </Suspense>
  );
}
