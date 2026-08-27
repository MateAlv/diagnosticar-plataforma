"use client";

import { useEffect, useId, useRef, useState } from "react";

type Props = {
  etiqueta: string;
  children: React.ReactNode;
  align?: "left" | "right";
};

export default function AyudaPopover({ etiqueta, children, align = "left" }: Props) {
  const [abierto, setAbierto] = useState(false);
  const contenedorRef = useRef<HTMLDivElement | null>(null);
  const cierreRef = useRef<number | null>(null);
  const panelId = useId();

  useEffect(() => {
    if (!abierto) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAbierto(false);
    };
    const onClickFuera = (event: MouseEvent) => {
      if (!contenedorRef.current?.contains(event.target as Node)) setAbierto(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClickFuera);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClickFuera);
    };
  }, [abierto]);

  useEffect(() => () => {
    if (cierreRef.current) window.clearTimeout(cierreRef.current);
  }, []);

  const cancelarCierre = () => {
    if (cierreRef.current) {
      window.clearTimeout(cierreRef.current);
      cierreRef.current = null;
    }
  };

  const programarCierre = () => {
    cancelarCierre();
    cierreRef.current = window.setTimeout(() => setAbierto(false), 180);
  };

  return (
    <div
      ref={contenedorRef}
      className="relative inline-flex"
      onMouseEnter={() => {
        cancelarCierre();
        setAbierto(true);
      }}
      onMouseLeave={programarCierre}
    >
      <button
        type="button"
        aria-expanded={abierto}
        aria-controls={panelId}
        onClick={() => setAbierto((prev) => !prev)}
        onFocus={() => setAbierto(true)}
        className="inline-flex items-center gap-1.5 rounded-full border border-[var(--lu-border)] bg-white px-3 py-1 text-xs font-semibold text-[var(--lu-accent)] transition-colors hover:border-[var(--lu-accent)] hover:bg-[var(--lu-accent-light)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lu-accent)]"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M12 16v-4" />
          <path d="M12 8h.01" />
        </svg>
        {etiqueta}
      </button>

      {abierto && (
        <div
          id={panelId}
          role="tooltip"
          className={[
            "absolute top-full z-30 mt-2 w-[min(30rem,calc(100vw-3rem))] rounded-2xl border border-[var(--lu-border)] bg-white p-5 text-left shadow-xl",
            align === "right" ? "right-0" : "left-0",
          ].join(" ")}
        >
          {children}
        </div>
      )}
    </div>
  );
}
