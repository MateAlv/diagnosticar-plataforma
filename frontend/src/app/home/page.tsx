"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../../lib/auth-context";

const MICROIN_LINK = process.env.NEXT_PUBLIC_MICROIN_URL ?? "/microin";
const MICROIN_LINK_IS_EXTERNAL = /^https?:\/\//.test(MICROIN_LINK);

export default function HomePage() {
  const r = useRouter();
  const { user, loading, logout } = useAuth();
  const [pending, setPending] = useState(false);
  const slides = useMemo(() => {
    const chatSlide = {
      id: "chat",
      title: "Unlocking biology’s true power with AI",
      description: "We built LUCAI Chat to help biotech teams connect with their data, models, and insights — conversationally.",
      ctaLabel: "Open AI Chat",
      ctaHref: "/chat",
      ctaExternal: false,
      bullets: ["Consult your Database", "Ask related questions", "Ask info related to us!"],
      image: "/brand/pelota-luca.png",
      imageAlt: "LUCAI sphere",
    };

    if (user?.permissions?.microin) {
      const slidesWithMicroin = [{
        id: "microin",
        title: "MicroIN, powered by LUCAI",
        description: "Upload microorganisms, consortia, and mixes in a workflow designed and developed by LUCAI.",
        ctaLabel: "Open MicroIN",
        ctaHref: MICROIN_LINK,
        ctaExternal: MICROIN_LINK_IS_EXTERNAL,
        bullets: ["Easy access", "Secure, audited uploads", "Integrated with LUCAI"],
        image: "/brand/microin-logo.png",
        imageAlt: "MicroIN logo",
      }, chatSlide];
      return slidesWithMicroin;
    }
    return [chatSlide];
  }, [user]);
  const [activeSlideIndex, setActiveSlideIndex] = useState(0);

  useEffect(() => {
    if (!loading && !user) {
      r.replace("/login");
    }
  }, [loading, user, r]);

  useEffect(() => {
    setActiveSlideIndex(0);
  }, [slides.length]);

  useEffect(() => {
    if (slides.length <= 1) {
      return undefined;
    }

    const timer = setInterval(() => {
      setActiveSlideIndex((prev) => (prev + 1) % slides.length);
    }, 10000);

    return () => clearInterval(timer);
  }, [slides.length]);

  const handleLogout = async () => {
    try {
      setPending(true);
      await logout();
      r.replace("/login");
    } finally {
      setPending(false);
    }
  };

  if (loading) {
    return (
      <main className="page-root relative flex items-center justify-center">
        <p className="text-sm text-[color:var(--lu-subtle)]">Cargando sesión…</p>
      </main>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <main className="page-root relative">
      <div className="hex-zoomed" aria-hidden />

      {/* Header */}
      <header className="header-dark">
        <div className="mx-auto max-w-7xl flex items-center justify-between px-5 py-4">
          {/* Logo → lucai.bio */}
          <a
            href="https://lucai.bio/"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3"
            aria-label="Ir a lucai.bio"
          >
            <Image
              src="/brand/logo.png"
              alt="LUCAI"
              width={140}
              height={32}
              className="brand-logo"
              priority
            />
          </a>

          <nav className="flex items-center gap-5">
            {/* AI Chat botón outline (a la izquierda) */}
            <Link href="/chat" className="btn-outline inline-flex items-center h-10 px-4 rounded-md">
              AI Chat
            </Link>

            {/* MedPhenAI botón */}
            <Link href="/medphenai" className="btn-outline inline-flex items-center h-10 px-4 rounded-md">
              MedPhenAI
            </Link>

            {/* MicroIN - visible sólo si el usuario tiene permiso */}
            {user.permissions?.microin &&
              (MICROIN_LINK_IS_EXTERNAL ? (
                <a
                  href={MICROIN_LINK}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-outline inline-flex items-center h-10 px-4 rounded-md"
                >
                  MicroIN
                </a>
              ) : (
                <Link href={MICROIN_LINK} className="btn-outline inline-flex items-center h-10 px-4 rounded-md">
                  MicroIN
                </Link>
              ))}

            {/* LUCAI (texto) */}
            <a
              href="https://lucai.bio/"
              target="_blank"
              rel="noopener noreferrer"
              className="nav-link"
            >
              LUCAI
            </a>

            {/* Log out (texto) */}
            <button onClick={handleLogout} className="nav-link" disabled={pending}>
              {pending ? "Saliendo…" : "Log out"}
            </button>
          </nav>
        </div>
      </header>

      {/* Contenido principal */}
      <div className="content-wrap">
        {/* HERO */}
        <section className="mx-auto max-w-7xl px-5 pt-20 pb-16 lg:pt-28 lg:pb-24">
          {slides.length > 0 && (
            <div className="hero-grid relative">
              {slides.length > 1 && (
                <>
                  <button
                    className="hidden md:flex absolute left-[-42px] top-1/2 -translate-y-1/2 h-10 w-10 items-center justify-center rounded-full bg-black/20 text-white/70 hover:bg-black/40 hover:text-white transition"
                    onClick={() => setActiveSlideIndex((prev) => (prev - 1 + slides.length) % slides.length)}
                    aria-label="Ver highlight anterior"
                  >
                    ‹
                  </button>
                  <button
                    className="hidden md:flex absolute right-[-18px] top-1/2 -translate-y-1/2 h-10 w-10 items-center justify-center rounded-full bg-black/20 text-white/70 hover:bg-black/40 hover:text-white transition"
                    onClick={() => setActiveSlideIndex((prev) => (prev + 1) % slides.length)}
                    aria-label="Ver siguiente highlight"
                  >
                    ›
                  </button>
                </>
              )}
              <div className="space-y-6 transition-all duration-500">
                <h1 className="hero-title">{slides[activeSlideIndex].title}</h1>
                <p className="hero-sub">{slides[activeSlideIndex].description}</p>

                <div className="flex items-center gap-3 flex-wrap">
                  {slides[activeSlideIndex].ctaExternal ? (
                    <a
                      href={slides[activeSlideIndex].ctaHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn-outline h-11 px-5 rounded-md flex items-center"
                    >
                      {slides[activeSlideIndex].ctaLabel}
                    </a>
                  ) : (
                    <Link
                      href={slides[activeSlideIndex].ctaHref}
                      className="btn-outline h-11 px-5 rounded-md flex items-center"
                    >
                      {slides[activeSlideIndex].ctaLabel}
                    </Link>
                  )}
                </div>

                <div className="flex items-center gap-4 pt-4 text-[13px] text-[color:var(--lu-subtle)] flex-wrap">
                  {slides[activeSlideIndex].bullets.map((badge) => (
                    <span key={badge} className="badge-dot">
                      {badge}
                    </span>
                  ))}
                </div>

                {slides.length > 1 && (
                  <div className="flex gap-2 pt-4" aria-label="Hero highlights">
                    {slides.map((slide, idx) => (
                      <button
                        key={slide.id}
                        className={`h-2 w-8 rounded-full transition-colors ${
                          idx === activeSlideIndex ? "bg-[color:var(--lu-accent)]" : "bg-[color:var(--lu-border)]"
                        }`}
                        onClick={() => setActiveSlideIndex(idx)}
                        aria-label={`Mostrar ${slide.title}`}
                      />
                    ))}
                  </div>
                )}
              </div>

              <div className="relative flex items-center justify-center">
                <Image
                  src={slides[activeSlideIndex].image}
                  alt={slides[activeSlideIndex].imageAlt}
                  width={slides[activeSlideIndex].id === "chat" ? 820 : 560}
                  height={slides[activeSlideIndex].id === "chat" ? 820 : 560}
                  className={`w-full h-auto brand-sphere-large select-none pointer-events-none object-contain ${
                    slides[activeSlideIndex].id === "chat" ? "max-w-full" : "max-w-[360px]"
                  }`}
                  priority
                />
              </div>
            </div>
          )}
        </section>

        {/* spacer para empujar el footer al final */}
        <div className="grow" />
      </div>

        {/* Footer  */}
        <footer className="footer-soft">
        <div className="px-5 flex flex-col gap-10 items-start">
            <div>
            <h2 className="section-title">LUCAI</h2>
            <p className="section-p">
                We partner with labs & startups to ship real value—fast.
            </p>
            </div>
            <div>
            <h2 className="section-title">Contact</h2>
            <p className="section-p">
                <a href="mailto:mateo@lucai.bio" className="nav-link">
                mateo@lucai.bio
                </a>
            </p>
            </div>
        </div>
        </footer>


    </main>
  );
}
