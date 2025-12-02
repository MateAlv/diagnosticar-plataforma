"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "../../lib/auth-context";

export default function HomePage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  return (
    <main className="page-root relative min-h-screen bg-[var(--lu-surface)] text-[var(--lu-text)]">
      {/* Header */}
      <header className="sticky top-0 z-20 w-full backdrop-blur-md bg-white/80 border-b border-[var(--lu-border)]">
        <div className="mx-auto max-w-7xl flex items-center justify-between px-5 py-4">
          {/* Logo - Invertido para fondo claro */}
          <Link href="/" className="flex items-center gap-3" aria-label="Ir al inicio">
            <Image
              src="/brand/logo.png"
              alt="Diagnostic.ar"
              width={140}
              height={32}
              className="brand-logo invert"
              priority
            />
          </Link>

          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-[var(--lu-subtle)]">
            <Link href="#metodologia" className="hover:text-[var(--lu-accent)] transition-colors">
              Nuestra metodología
            </Link>
            <Link href="#quienes-somos" className="hover:text-[var(--lu-accent)] transition-colors">
              Quiénes somos
            </Link>
            <Link href="#ayuda" className="hover:text-[var(--lu-accent)] transition-colors">
              Ayuda
            </Link>
            <Link href="#epofs" className="hover:text-[var(--lu-accent)] transition-colors">
              Las EPoFs
            </Link>
          </nav>

          <div className="flex items-center gap-4">
            {!user ? (
              <>
                <Link href="/login" className="text-sm font-medium text-[var(--lu-text)] hover:text-[var(--lu-accent)] transition-colors">
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
      <section className="relative mx-auto max-w-7xl px-5 pt-20 pb-16 lg:pt-32 lg:pb-24 text-center overflow-hidden">

        {/* Breathing Background Animation */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-gradient-to-r from-[var(--lu-accent-light)] to-[var(--lu-accent)] rounded-full blur-3xl opacity-20 animate-breathe -z-10 pointer-events-none" />

        <div className="max-w-4xl mx-auto space-y-8 relative z-10">
          <h1 className="hero-title text-5xl md:text-6xl font-bold tracking-tight text-[var(--lu-text)] drop-shadow-sm">
            Diagnostic.ar: Una nueva forma de acompañar el <span className="text-transparent bg-clip-text bg-gradient-to-r from-[var(--lu-accent)] to-[var(--lu-green)]">camino hacia el diagnóstico</span>.
          </h1>
          <p className="hero-sub mx-auto max-w-2xl text-xl text-[var(--lu-subtle)] leading-relaxed">
            diagnostic.ar ayuda a las familias a registrar síntomas y obtener orientación personalizada, basada en ciencia y con privacidad total.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-6">
            <Link href="/medphenai/demo" className="btn-primary h-14 px-10 rounded-full text-xl font-semibold shadow-xl hover:shadow-2xl hover:-translate-y-1 transition-all bg-gradient-to-r from-[var(--lu-accent)] to-[var(--lu-green)] text-white border-none">
              Comenzar ahora
            </Link>
            <Link href="/sign-up" className="btn-outline h-14 px-10 rounded-full text-xl font-semibold border-2 border-[var(--lu-accent)] text-[var(--lu-accent)] hover:bg-[var(--lu-accent)] hover:text-white transition-all">
              Crear cuenta
            </Link>
          </div>

          <div className="pt-8 max-w-3xl mx-auto text-lg text-[var(--lu-text)] opacity-90 leading-relaxed">
            <p>
              En Argentina, muchas familias atraviesan años de incertidumbre hasta obtener un diagnóstico preciso. <strong>Diagnostic.ar</strong> nace para ayudar a acortar ese camino.
            </p>
            <p className="mt-4">
              Nuestra plataforma digital, gratuita y abierta a toda la comunidad, permite registrar síntomas de manera sencilla y segura. A partir de esta información, el sistema genera recomendaciones personalizadas.
            </p>
          </div>
        </div>
      </section>

      {/* Logos Section */}
      <section className="py-12 bg-white/50 border-y border-[var(--lu-border)]">
        <div className="mx-auto max-w-7xl px-5 text-center">
          <p className="text-sm font-semibold text-[var(--lu-subtle)] uppercase tracking-wider mb-8">
            Desarrollado por el Grupo de Genómica Clínica (FCEN-UBA) con el apoyo de
          </p>
          <div className="flex flex-wrap justify-center items-center gap-12 opacity-70 grayscale hover:grayscale-0 transition-all duration-500">
            {/* Placeholders for Logos - User to provide assets */}
            <div className="h-12 flex items-center font-bold text-xl text-slate-400">FCEN-UBA</div>
            <div className="h-12 flex items-center font-bold text-xl text-slate-400">QB</div>
            <div className="h-12 flex items-center font-bold text-xl text-slate-400">IQUIBCEN</div>
            <div className="h-12 flex items-center font-bold text-xl text-slate-400">LUCAI</div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="mt-auto border-t border-[var(--lu-border)] bg-white">
        <div className="mx-auto max-w-7xl px-5 py-12 flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="text-center md:text-left">
            <h2 className="text-xl font-bold text-[var(--lu-text)] mb-2">Diagnostic.ar</h2>
            <p className="text-sm text-[var(--lu-subtle)]">
              Transformando el diagnóstico con IA.
            </p>
          </div>
          <div className="flex gap-6 text-sm text-[var(--lu-subtle)]">
            <Link href="#" className="hover:text-[var(--lu-accent)] transition-colors">Términos</Link>
            <Link href="#" className="hover:text-[var(--lu-accent)] transition-colors">Privacidad</Link>
            <a href="mailto:contacto@lucai.bio" className="hover:text-[var(--lu-accent)] transition-colors">Contacto</a>
          </div>
        </div>
      </footer>
    </main>
  );
}
