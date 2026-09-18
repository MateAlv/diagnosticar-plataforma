"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "../../lib/auth-context";

export default function HomePage() {
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const displayName = user?.name?.trim() || user?.email;
  const heroCta = user
    ? { href: "/diagnosticar", label: "Ir a la App" }
    : { href: "/demo", label: "Comenzar ahora" };

  const handleLogout = async () => {
    await logout();
  };

  return (
    <main className="page-root relative min-h-screen bg-[var(--lu-surface)] text-[var(--lu-text)]">
      {/* Header */}
      <header className="sticky top-0 z-20 w-full backdrop-blur-md bg-white/80 border-b border-[var(--lu-border)]">
        <div className="mx-auto max-w-7xl flex items-center justify-between px-5 py-4">
          <Link href="/" className="flex items-center" aria-label="Ir al inicio">
            <Image
              src="/brand/logo-diagnosticar.svg"
              alt="Diagnostic.ar"
              width={360}
              height={88}
              className="h-16 w-auto"
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
                <Link
                  href="/login"
                  className="inline-flex items-center justify-center h-9 px-4 rounded-md text-sm font-medium text-[var(--lu-text)] hover:text-[var(--lu-accent)] transition-colors"
                >
                  Iniciar sesión
                </Link>
                <Link
                  href="/sign-up"
                  className="btn-primary inline-flex items-center justify-center h-9 px-4 rounded-md text-sm"
                >
                  Crear cuenta
                </Link>
              </>
            ) : (
              <>
                <Link href="/diagnosticar" className="btn-primary inline-flex items-center justify-center h-9 px-4 rounded-md text-sm">
                  Ir a la App
                </Link>
                {user.role === "admin" && (
                  <Link
                    href="/admin"
                    className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-[var(--lu-accent)] px-3 text-sm font-medium text-[var(--lu-accent)] transition hover:bg-[color-mix(in_oklab,var(--lu-accent)_8%,white)]"
                  >
                    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" aria-hidden>
                      <path
                        d="M8 1.5 2.5 4v3.5c0 3.2 2.3 6.2 5.5 7 3.2-.8 5.5-3.8 5.5-7V4L8 1.5Z"
                        stroke="currentColor"
                        strokeWidth="1.4"
                        strokeLinejoin="round"
                      />
                    </svg>
                    Administración
                  </Link>
                )}
                {displayName && (
                  <span className="user-badge truncate">
                    {displayName}
                  </span>
                )}
                <button type="button" onClick={handleLogout} className="nav-link text-sm">
                  Cerrar sesión
                </button>
              </>
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
            <Link href={heroCta.href} className="hero-cta-primary">
              {heroCta.label}
            </Link>
            {!user && (
              <Link href="/sign-up" className="btn-outline h-14 px-10 rounded-full text-xl font-semibold border-2 border-[var(--lu-accent)] text-[var(--lu-accent)] hover:bg-[var(--lu-accent)] hover:text-white transition-all">
                Crear cuenta
              </Link>
            )}
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

      {/* Nuestra metodología */}
      <section id="metodologia" className="py-24 bg-white border-y border-[var(--lu-border)]">
        <div className="mx-auto max-w-4xl px-5">

          {/* Heading */}
          <div className="text-center mb-20">
            <span className="inline-block text-xs font-bold uppercase tracking-[0.2em] text-[var(--lu-accent)] mb-4">
              Nuestra metodología
            </span>
            <h2 className="text-4xl md:text-5xl font-bold text-[var(--lu-text)] leading-tight mb-6">
              Del texto clínico al diagnóstico orientativo
            </h2>
            <p className="text-lg text-[var(--lu-subtle)] max-w-2xl mx-auto leading-relaxed">
              Un pipeline de inteligencia artificial procesa la descripción clínica del paciente en varios pasos, combinando modelos de lenguaje, ontologías médicas y una red neuronal especializada en genómica clínica.
            </p>
          </div>

          {/* Steps */}
          <div className="relative">
            {/* Vertical connector line */}
            <div className="absolute left-6 top-8 bottom-8 w-px bg-gradient-to-b from-[var(--lu-accent)] via-[var(--lu-accent)]/30 to-[var(--lu-green)] hidden md:block" />

            <div className="space-y-10">

              {/* Step 1 */}
              <div className="flex gap-8 items-start">
                <div className="flex-shrink-0 w-12 h-12 rounded-full bg-[var(--lu-accent)] text-white flex items-center justify-center font-bold text-lg shadow-md z-10">
                  1
                </div>
                <div className="flex-1 rounded-2xl border border-[var(--lu-border)] bg-[var(--lu-surface)] p-7">
                  <h3 className="text-lg font-bold text-[var(--lu-text)] mb-2">Ingreso del fenotipo clínico</h3>
                  <p className="text-[var(--lu-subtle)] leading-relaxed">
                    El profesional de salud o el propio paciente describe en lenguaje natural y en español el cuadro clínico: síntomas, signos, antecedentes y hallazgos del examen físico. No se requiere ningún conocimiento previo de ontologías ni terminología especializada.
                  </p>
                </div>
              </div>

              {/* Step 2 */}
              <div className="flex gap-8 items-start">
                <div className="flex-shrink-0 w-12 h-12 rounded-full bg-[var(--lu-accent)] text-white flex items-center justify-center font-bold text-lg shadow-md z-10">
                  2
                </div>
                <div className="flex-1 rounded-2xl border border-[var(--lu-border)] bg-[var(--lu-surface)] p-7">
                  <h3 className="text-lg font-bold text-[var(--lu-text)] mb-2">Extracción de síntomas con IA</h3>
                  <p className="text-[var(--lu-subtle)] leading-relaxed">
                    Un modelo de lenguaje de gran escala (LLM) analiza el texto y extrae de forma automática cada hallazgo clínico individual. El modelo descompone descripciones complejas en síntomas atómicos canónicos — por ejemplo, convierte <em>&ldquo;dificultad respiratoria con tiraje intercostal&rdquo;</em> en dos hallazgos separados — y descarta información no fenotípica como edades, medidas o nombres de fármacos.
                  </p>
                </div>
              </div>

              {/* Step 3 */}
              <div className="flex gap-8 items-start">
                <div className="flex-shrink-0 w-12 h-12 rounded-full bg-[var(--lu-accent)] text-white flex items-center justify-center font-bold text-lg shadow-md z-10">
                  3
                </div>
                <div className="flex-1 rounded-2xl border border-[var(--lu-border)] bg-[var(--lu-surface)] p-7">
                  <h3 className="text-lg font-bold text-[var(--lu-text)] mb-2">Codificación HPO</h3>
                  <p className="text-[var(--lu-subtle)] leading-relaxed">
                    Cada síntoma extraído es mapeado al vocabulario estándar <strong className="text-[var(--lu-text)]">Human Phenotype Ontology (HPO)</strong>, el sistema de referencia internacional para la codificación de fenotipos clínicos. El sistema intenta primero la correspondencia directa en español; si no encuentra una coincidencia suficientemente precisa, traduce el término al inglés mediante un modelo de traducción neural (NLLB-200) y busca en el vocabulario HPO en inglés. Solo se aceptan coincidencias con alta confianza para evitar codificaciones incorrectas.
                  </p>
                </div>
              </div>

              {/* Step 4 */}
              <div className="flex gap-8 items-start">
                <div className="flex-shrink-0 w-12 h-12 rounded-full bg-gradient-to-br from-[var(--lu-accent)] to-[var(--lu-green)] text-white flex items-center justify-center font-bold text-lg shadow-md z-10">
                  4
                </div>
                <div className="flex-1 rounded-2xl border-2 border-[var(--lu-accent)]/30 bg-gradient-to-br from-white to-[var(--lu-accent-light)]/30 p-7 shadow-sm">
                  <div className="flex items-center gap-3 mb-3">
                    <h3 className="text-lg font-bold text-[var(--lu-text)]">Red neuronal GenPhenia</h3>
                    <span className="text-xs font-semibold bg-[var(--lu-accent)] text-white px-2.5 py-0.5 rounded-full">Núcleo del sistema</span>
                  </div>
                  <p className="text-[var(--lu-subtle)] leading-relaxed">
                    Los identificadores HPO obtenidos se envían a <strong className="text-[var(--lu-text)]">GenPhenia</strong>, una red neuronal entrenada sobre datos de genómica clínica. El modelo calcula una distribución de probabilidad sobre un espacio de <strong className="text-[var(--lu-text)]">5.229 genes</strong>, estimando la verosimilitud de que cada gen esté implicado en el cuadro clínico descripto. Cuanto más específico y completo sea el fenotipo ingresado, más concentrada — y por lo tanto más informativa — resultará esa distribución.
                  </p>
                </div>
              </div>

              {/* Step 5 */}
              <div className="flex gap-8 items-start">
                <div className="flex-shrink-0 w-12 h-12 rounded-full bg-[var(--lu-green)] text-white flex items-center justify-center font-bold text-lg shadow-md z-10">
                  5
                </div>
                <div className="flex-1 rounded-2xl border border-[var(--lu-border)] bg-[var(--lu-surface)] p-7">
                  <h3 className="text-lg font-bold text-[var(--lu-text)] mb-2">Resultados orientativos</h3>
                  <p className="text-[var(--lu-subtle)] leading-relaxed mb-4">
                    A partir de la distribución génica se generan dos salidas complementarias:
                  </p>
                  <ul className="space-y-3">
                    <li className="flex gap-3 items-start">
                      <span className="mt-1 flex-shrink-0 w-5 h-5 rounded-full bg-[var(--lu-accent)]/15 flex items-center justify-center">
                        <span className="w-2 h-2 rounded-full bg-[var(--lu-accent)] block" />
                      </span>
                      <span className="text-[var(--lu-subtle)] leading-relaxed text-sm">
                        <strong className="text-[var(--lu-text)]">Priorización génica:</strong> lista ordenada de los genes más probablemente asociados al cuadro, junto con un <strong className="text-[var(--lu-text)]">índice de confianza</strong> calculado a partir de la entropía de la distribución — un valor cercano a 1 indica que la red concentra la probabilidad en pocos genes, lo que sugiere un fenotipo bien definido y específico.
                      </span>
                    </li>
                    <li className="flex gap-3 items-start">
                      <span className="mt-1 flex-shrink-0 w-5 h-5 rounded-full bg-[var(--lu-green)]/15 flex items-center justify-center">
                        <span className="w-2 h-2 rounded-full bg-[var(--lu-green)] block" />
                      </span>
                      <span className="text-[var(--lu-subtle)] leading-relaxed text-sm">
                        <strong className="text-[var(--lu-text)]">Recomendación de especialidad:</strong> mediante el cruce de los genes priorizados con bases de datos de paneles genéticos clínicos (PanelApp), el sistema identifica la especialidad médica con mayor concentración de genes relevantes para el caso, orientando la derivación.
                      </span>
                    </li>
                  </ul>
                </div>
              </div>

            </div>
          </div>

          {/* Disclaimer */}
          <div className="mt-14 rounded-2xl border border-amber-200 bg-amber-50/80 px-7 py-5 flex gap-4 items-start">
            <svg xmlns="http://www.w3.org/2000/svg" className="flex-shrink-0 w-5 h-5 text-amber-500 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
            <p className="text-amber-800 leading-relaxed text-sm">
              <strong>Herramienta de orientación, no de diagnóstico.</strong> Los resultados de Diagnostic.ar están destinados a orientar al profesional de la salud y no reemplazan en ningún caso la evaluación clínica ni el criterio médico. Su uso implica la aceptación de esta condición.
            </p>
          </div>

        </div>
      </section>

      {/* Quiénes somos */}
      <section id="quienes-somos" className="py-24 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-white via-[var(--lu-surface)] to-white -z-10" />
        <div className="mx-auto max-w-3xl px-5">

          {/* Heading */}
          <div className="text-center mb-16">
            <span className="inline-block text-xs font-bold uppercase tracking-[0.2em] text-[var(--lu-accent)] mb-4">
              Quiénes somos
            </span>
            <h2 className="text-4xl md:text-5xl font-bold text-[var(--lu-text)] leading-tight">
              Una colaboración al servicio<br />del diagnóstico
            </h2>
          </div>

          {/* Intro */}
          <div className="space-y-5 text-lg text-[var(--lu-subtle)] leading-relaxed mb-14">
            <p>
              <strong className="text-[var(--lu-text)]">Diagnostic.ar</strong> es una herramienta desarrollada en el marco de una colaboración entre el{" "}
              <strong className="text-[var(--lu-text)]">Laboratorio de Bioinformática de la Facultad de Ciencias Exactas y Naturales de la Universidad de Buenos Aires (FCEyN-UBA)</strong>,
              la <strong className="text-[var(--lu-text)]">Facultad de Ingeniería de la Universidad de Buenos Aires (FIUBA)</strong> y las empresas{" "}
              <strong className="text-[var(--lu-text)]">LUCAI</strong> y <strong className="text-[var(--lu-text)]">BITGENIA</strong>.
            </p>
            <p>
              Su objetivo es facilitar el acceso de personas con{" "}
              <strong className="text-[var(--lu-text)]">Enfermedades Poco Frecuentes</strong> a una orientación clínica temprana, contribuyendo a reducir los tiempos de la llamada{" "}
              <span className="font-semibold text-[var(--lu-text)] italic">&ldquo;odisea diagnóstica&rdquo;</span>.
            </p>
          </div>

          {/* Feature cards */}
          <div className="grid md:grid-cols-2 gap-5 mb-14">
            <div className="rounded-2xl border border-[var(--lu-border)] bg-white p-7 hover:border-[var(--lu-accent)] hover:shadow-lg transition-all duration-300">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[var(--lu-accent-light)] to-[var(--lu-accent)]/20 flex items-center justify-center mb-5">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6 text-[var(--lu-accent)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </div>
              <h3 className="text-lg font-bold text-[var(--lu-text)] mb-2">Derivación especializada</h3>
              <p className="text-[var(--lu-subtle)] leading-relaxed text-sm">
                Recomendación de derivación al especialista de la disciplina médica correspondiente al cuadro clínico del paciente.
              </p>
            </div>

            <div className="rounded-2xl border border-[var(--lu-border)] bg-white p-7 hover:border-[var(--lu-green)] hover:shadow-lg transition-all duration-300">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-50 to-emerald-100 flex items-center justify-center mb-5">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6 text-[var(--lu-green)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 7h16M4 12h16M4 17h7" />
                </svg>
              </div>
              <h3 className="text-lg font-bold text-[var(--lu-text)] mb-2">Priorización génica</h3>
              <p className="text-[var(--lu-subtle)] leading-relaxed text-sm">
                Priorización de genes que podrían estar asociados al cuadro clínico, destinada al profesional de la salud tratante.
              </p>
            </div>
          </div>

          {/* Disclaimer */}
          <div className="rounded-2xl border border-amber-200 bg-amber-50/80 px-7 py-5 mb-12 flex gap-4 items-start">
            <svg xmlns="http://www.w3.org/2000/svg" className="flex-shrink-0 w-5 h-5 text-amber-500 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
            <p className="text-amber-800 leading-relaxed text-sm">
              <strong>Importante:</strong> Los resultados proporcionados por Diagnostic.ar no constituyen en ningún caso un diagnóstico médico ni molecular, y no reemplazan la evaluación clínica realizada por un profesional de la salud.
            </p>
          </div>

          {/* Beta / continuous improvement */}
          <p className="text-center text-[var(--lu-subtle)] leading-relaxed mb-6">
            La herramienta se encuentra actualmente en desarrollo y mejora continua. Sus aportes y comentarios resultan fundamentales para optimizar su funcionamiento y potenciar su impacto en beneficio de futuros pacientes.
          </p>

          {/* Thank you */}
          <p className="text-center text-xl font-semibold text-[var(--lu-text)] mb-16">
            Muchas gracias por formar parte de Diagnostic.ar
          </p>

          {/* Institution logos */}
          <div className="border-t border-[var(--lu-border)] pt-16">
            <p className="text-center text-sm font-bold uppercase tracking-[0.2em] text-[var(--lu-subtle)] mb-12">
              En colaboración con
            </p>
            {/* Breaks out of the section's max-w-3xl so four enlarged logos sit
                on one row instead of wrapping. Heights are tuned per mark rather
                than uniform: the wordmarks (LUCAI, BITGENIA) read far wider than
                the round seals at the same height. */}
            <div className="relative left-1/2 -translate-x-1/2 w-[min(64rem,92vw)] flex flex-wrap justify-center items-center gap-x-14 gap-y-10">
              <Image
                src="/brand/logo_uba.jpg"
                alt="Universidad de Buenos Aires"
                width={240}
                height={240}
                className="h-24 w-auto object-contain opacity-80 hover:opacity-100 transition-opacity"
              />
              <Image
                src="/brand/iquibicen-logo.png"
                alt="IQUIBICEN"
                width={360}
                height={240}
                className="h-20 w-auto object-contain opacity-80 hover:opacity-100 transition-opacity"
              />
              <Image
                src="/brand/logo.png"
                alt="LUCAI"
                width={280}
                height={120}
                className="h-14 w-auto object-contain invert opacity-80 hover:opacity-100 transition-opacity"
              />
              <Image
                src="/brand/bitgenia-logo.svg"
                alt="Bitgenia"
                width={240}
                height={46}
                className="h-9 w-auto object-contain opacity-80 hover:opacity-100 transition-opacity"
              />
            </div>
          </div>

        </div>
      </section>

      {/* Ayuda */}
      <section id="ayuda" className="py-24 bg-[var(--lu-surface)]">
        <div className="mx-auto max-w-2xl px-5 text-center">
          <span className="inline-block text-xs font-bold uppercase tracking-[0.2em] text-[var(--lu-accent)] mb-4">
            Ayuda y contacto
          </span>
          <h2 className="text-3xl md:text-4xl font-bold text-[var(--lu-text)] mb-6">
            Estamos en desarrollo activo
          </h2>
          <p className="text-lg text-[var(--lu-subtle)] leading-relaxed mb-4">
            Diagnostic.ar es una herramienta en evolución continua. Cada observación clínica, caso de uso y sugerencia técnica que recibimos contribuye directamente a mejorar el sistema y ampliar su impacto.
          </p>
          <p className="text-lg text-[var(--lu-subtle)] leading-relaxed mb-10">
            Si encontraste un problema, tenés una sugerencia, querés compartir tu experiencia de uso o simplemente deseás ponerte en contacto con el equipo, escribinos a:
          </p>
          <a
            href="mailto:diagnosticar.ar@gmail.com"
            className="inline-flex items-center gap-3 px-8 py-4 rounded-2xl bg-white border border-[var(--lu-border)] shadow-sm hover:shadow-md hover:border-[var(--lu-accent)] transition-all duration-200 group"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-[var(--lu-accent)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            <span className="font-semibold text-[var(--lu-text)] group-hover:text-[var(--lu-accent)] transition-colors">
              diagnosticar.ar@gmail.com
            </span>
          </a>
        </div>
      </section>

      {/* Las EPoFs */}
      <section id="epofs" className="py-24 bg-white border-y border-[var(--lu-border)]">
        <div className="mx-auto max-w-4xl px-5">

          <div className="text-center mb-16">
            <span className="inline-block text-xs font-bold uppercase tracking-[0.2em] text-[var(--lu-accent)] mb-4">
              Las EPoFs
            </span>
            <h2 className="text-4xl md:text-5xl font-bold text-[var(--lu-text)] leading-tight mb-6">
              Enfermedades Poco Frecuentes:<br />muchas más personas de las que creés
            </h2>
            <p className="text-lg text-[var(--lu-subtle)] max-w-2xl mx-auto leading-relaxed">
              En Argentina se llaman <strong className="text-[var(--lu-text)]">EPOF</strong> — Enfermedades Poco Frecuentes —, aunque en el mundo también las conocés como &ldquo;enfermedades raras&rdquo;. Individualmente son raras. Juntas, afectan a millones.
            </p>
          </div>

          {/* Definition callout */}
          <div className="rounded-2xl border-2 border-[var(--lu-accent)]/20 bg-gradient-to-br from-[var(--lu-accent-light)]/40 to-white p-8 mb-10">
            <p className="text-[var(--lu-subtle)] leading-relaxed text-lg">
              En Argentina, una enfermedad se considera poco frecuente cuando{" "}
              <strong className="text-[var(--lu-text)]">afecta a menos de 1 en cada 2.000 personas</strong>.
              Aunque cada una es rara por separado, existen más de 7.000 EPOF descriptas y en conjunto afectan al{" "}
              <strong className="text-[var(--lu-text)]">7% de la población mundial</strong> — en Argentina, eso son más de 3 millones de personas.
            </p>
          </div>

          {/* Two columns */}
          <div className="grid md:grid-cols-2 gap-6 mb-10">
            <div className="rounded-2xl border border-[var(--lu-border)] bg-[var(--lu-surface)] p-7">
              <h3 className="text-base font-bold text-[var(--lu-text)] mb-5">¿Por qué aparecen las EPOF genéticas?</h3>
              <ul className="space-y-4">
                {[
                  ["Mutaciones puntuales", "Un cambio en una sola \"letra\" del ADN puede alterar completamente la función de una proteína."],
                  ["Alteraciones cromosómicas", "Falta o exceso de material genético que afecta múltiples genes a la vez."],
                  ["Errores de regulación génica", "El gen está intacto, pero no se activa o se silencia cuando debería."],
                ].map(([title, desc]) => (
                  <li key={title} className="flex gap-3 items-start">
                    <span className="flex-shrink-0 mt-1.5 w-2 h-2 rounded-full bg-[var(--lu-accent)]" />
                    <span className="text-[var(--lu-subtle)] text-sm leading-relaxed">
                      <strong className="text-[var(--lu-text)]">{title}:</strong> {desc}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-5 text-xs text-[var(--lu-subtle)] italic border-t border-[var(--lu-border)] pt-4">
                Pueden heredarse de los padres o aparecer de forma espontánea, sin antecedentes familiares.
              </p>
            </div>

            <div className="rounded-2xl border border-[var(--lu-border)] bg-[var(--lu-surface)] p-7">
              <h3 className="text-base font-bold text-[var(--lu-text)] mb-5">¿Qué sistemas pueden afectar?</h3>
              <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                {["Sistema neurológico", "Metabolismo", "Sistema muscular", "Sistema inmune", "Desarrollo cognitivo", "Desarrollo físico", "Sistema digestivo", "Sistema respiratorio"].map((item) => (
                  <div key={item} className="flex items-center gap-2 text-sm text-[var(--lu-subtle)]">
                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--lu-green)] flex-shrink-0" />
                    {item}
                  </div>
                ))}
              </div>
              <p className="mt-5 text-xs text-[var(--lu-subtle)] italic border-t border-[var(--lu-border)] pt-4">
                La mayoría son crónicas. Muchas debutan en la infancia y se diagnostican tarde.
              </p>
            </div>
          </div>

          {/* Examples */}
          <div className="rounded-2xl border border-[var(--lu-border)] bg-[var(--lu-surface)] p-7 mb-10">
            <h3 className="text-base font-bold text-[var(--lu-text)] mb-5">Algunos ejemplos conocidos</h3>
            <div className="grid sm:grid-cols-2 gap-5">
              {[
                { name: "Fibrosis quística", desc: "Afecta pulmones y sistema digestivo por mutaciones en el gen CFTR.", gene: "CFTR" },
                { name: "Distrofia muscular de Duchenne", desc: "Debilidad muscular progresiva causada por mutaciones en el gen DMD.", gene: "DMD" },
                { name: "Síndrome de Down", desc: "Alteración cromosómica (trisomía 21) con impacto en el desarrollo físico y cognitivo.", gene: "Chr 21" },
                { name: "Fenilcetonuria", desc: "Error metabólico que requiere dieta especial para evitar daño neurológico.", gene: "PAH" },
              ].map((ex) => (
                <div key={ex.name} className="flex gap-3 items-start">
                  <span className="flex-shrink-0 mt-0.5 px-2 py-0.5 rounded text-xs font-mono font-bold bg-[var(--lu-accent)]/10 text-[var(--lu-accent)]">
                    {ex.gene}
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-[var(--lu-text)]">{ex.name}</p>
                    <p className="text-xs text-[var(--lu-subtle)] leading-relaxed mt-0.5">{ex.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Bridge to Diagnostic.ar */}
          <div className="rounded-2xl bg-gradient-to-br from-[var(--lu-accent)] to-[var(--lu-green)] p-px shadow-lg">
            <div className="rounded-[calc(1rem-1px)] bg-white p-8">
              <h3 className="text-xl font-bold text-[var(--lu-text)] mb-4">
                La odisea diagnóstica — y cómo Diagnostic.ar ayuda a acortarla
              </h3>
              <p className="text-[var(--lu-subtle)] leading-relaxed mb-4">
                Uno de los mayores desafíos de las EPOF no es solo el tratamiento: es <strong className="text-[var(--lu-text)]">llegar al diagnóstico</strong>. Muchas familias pasan años — a veces más de una década — consultando especialistas sin obtener respuesta. A ese recorrido se lo llama <em className="font-semibold text-[var(--lu-text)]">&ldquo;odisea diagnóstica&rdquo;</em>, y en las enfermedades genéticas es especialmente frecuente: los síntomas se parecen a enfermedades comunes, son muy variados, y pocos médicos tienen experiencia acumulada con cuadros que afectan a tan poca gente.
              </p>
              <p className="text-[var(--lu-subtle)] leading-relaxed mb-6">
                <strong className="text-[var(--lu-text)]">Diagnostic.ar</strong> nació para ayudar en ese primer paso. A partir de los síntomas descritos por la familia o el médico tratante, el sistema orienta hacia los genes y especialidades más probablemente involucrados, usando una red neuronal entrenada sobre datos de genómica clínica. No reemplaza al médico — lo potencia: le da una pista informada para que el proceso de derivación y estudio sea más rápido y más certero.
              </p>
              <div className="flex flex-col sm:flex-row gap-3">
                <a href="/demo" className="inline-flex items-center justify-center h-11 px-6 rounded-xl bg-[var(--lu-accent)] text-white font-semibold hover:bg-[color-mix(in_oklab,var(--lu-accent)_90%,#000)] transition-colors text-sm">
                  Probar el sistema
                </a>
                <a href="#metodologia" className="inline-flex items-center justify-center h-11 px-6 rounded-xl border border-[var(--lu-border)] text-[var(--lu-subtle)] font-medium hover:bg-[var(--lu-surface)] hover:text-[var(--lu-text)] transition-colors text-sm">
                  Ver metodología
                </a>
              </div>
            </div>
          </div>

        </div>
      </section>

      {/* Footer */}
      <footer className="mt-auto border-t border-[var(--lu-border)] bg-white">
        <div className="mx-auto max-w-7xl px-5 py-12 flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="flex items-center gap-4">
            <Image
              src="/brand/logo.png"
              alt="LUCAI"
              width={120}
              height={28}
              className="h-7 w-auto invert opacity-80"
            />
            <div>
              <h2 className="text-xl font-bold text-[var(--lu-text)] mb-2">Diagnostic.ar</h2>
              <p className="text-sm text-[var(--lu-subtle)]">
                Transformando el diagnóstico con IA.
              </p>
            </div>
          </div>
          <div className="flex gap-6 text-sm text-[var(--lu-subtle)]">
            <Link href="#" className="hover:text-[var(--lu-accent)] transition-colors">Términos</Link>
            <Link href="#" className="hover:text-[var(--lu-accent)] transition-colors">Privacidad</Link>
            <a href="mailto:diagnosticar.ar@gmail.com" className="hover:text-[var(--lu-accent)] transition-colors">Contacto</a>
          </div>
        </div>
      </footer>
    </main>
  );
}
