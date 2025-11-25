"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "../../lib/auth-context";

export default function HomePage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  return (
    <main className="page-root relative">
      <div className="hex-zoomed" aria-hidden />

      {/* Header */}
      <header className="header-dark">
        <div className="mx-auto max-w-7xl flex items-center justify-between px-5 py-4">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-3" aria-label="Ir al inicio">
            <Image
              src="/brand/logo.png"
              alt="LUCAI"
              width={140}
              height={32}
              className="brand-logo"
              priority
            />
          </Link>

          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-[color:var(--lu-subtle)]">
            <Link href="#metodologia" className="hover:text-white transition-colors">
              Nuestra metodología
            </Link>
            <Link href="#quienes-somos" className="hover:text-white transition-colors">
              Quiénes somos
            </Link>
            <Link href="#ayuda" className="hover:text-white transition-colors">
              Ayuda
            </Link>
            <Link href="#epofs" className="hover:text-white transition-colors">
              Las EPoFs
            </Link>
          </nav>

          <div className="flex items-center gap-4">
            {!user ? (
              <>
                <Link href="/login" className="text-sm font-medium text-white hover:text-[color:var(--lu-accent)] transition-colors">
                  Iniciar sesión
                </Link>
                <Link href="/sign-up" className="btn-primary h-9 px-4 rounded-md text-sm">
                  Crear cuenta
                </Link>
              </>
            ) : (
              <Link href="/medphenai" className="btn-primary h-9 px-4 rounded-md text-sm">
                Ir a la App
              </Link>
            )}
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="mx-auto max-w-7xl px-5 pt-20 pb-16 lg:pt-32 lg:pb-24 text-center">
        <div className="max-w-3xl mx-auto space-y-6">
          <h1 className="hero-title">
            Diagnóstico de precisión para <span className="text-[color:var(--lu-accent)]">Enfermedades Poco Frecuentes</span>
          </h1>
          <p className="hero-sub mx-auto max-w-2xl">
            MedPhenAI combina inteligencia artificial avanzada con datos clínicos para acelerar el diagnóstico y mejorar la vida de los pacientes.
          </p>

          <div className="flex items-center justify-center gap-4 pt-4">
            <Link href="/medphenai/nuevo" className="btn-primary h-12 px-8 rounded-full text-lg font-semibold shadow-lg hover:shadow-xl transition-all">
              Comenzar ahora
            </Link>
          </div>
        </div>

        <div className="mt-16 relative flex justify-center">
          <Image
            src="/brand/pelota-luca.png"
            alt="MedPhenAI Sphere"
            width={600}
            height={600}
            className="brand-sphere-large animate-float"
            priority
          />
        </div>
      </section>

      {/* Footer */}
      <footer className="footer-soft mt-auto">
        <div className="mx-auto max-w-7xl px-5 py-12 flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="text-center md:text-left">
            <h2 className="text-xl font-bold text-white mb-2">LUCAI</h2>
            <p className="text-sm text-[color:var(--lu-subtle)]">
              Transformando el diagnóstico con IA.
            </p>
          </div>
          <div className="flex gap-6 text-sm text-[color:var(--lu-subtle)]">
            <Link href="#" className="hover:text-white transition-colors">Términos</Link>
            <Link href="#" className="hover:text-white transition-colors">Privacidad</Link>
            <a href="mailto:contacto@lucai.bio" className="hover:text-white transition-colors">Contacto</a>
          </div>
        </div>
      </footer>
    </main>
  );
}
