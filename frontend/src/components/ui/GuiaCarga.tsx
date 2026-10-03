"use client";

import { useState } from "react";

type Variant = "historia" | "sintomas";

const escalaEspecificidad = [
  { label: "Anormalidad del aparato respiratorio", nivel: "Muy general" },
  { label: "Tos", nivel: "General" },
  { label: "Tos productiva", nivel: "Específico" },
];

const ejemplosRelato: Array<{ vago: string; preciso: string }> = [
  { vago: "tos", preciso: "tos productiva diaria desde los 2 años" },
  { vago: "problemas de crecimiento", preciso: "talla por debajo del percentil 3" },
  { vago: "cansancio", preciso: "fatiga con intolerancia al ejercicio" },
];

const queContar: Array<{ titulo: string; detalle: string }> = [
  { titulo: "Desde cuándo", detalle: "Edad de inicio y si empeoró con el tiempo." },
  { titulo: "Qué tan seguido", detalle: "Diario, en episodios, sólo con esfuerzo." },
  { titulo: "Dónde y cómo", detalle: "Qué parte del cuerpo y de qué manera se manifiesta." },
  { titulo: "Estudios previos", detalle: "Análisis, imágenes o valores fuera de rango." },
];

function Desplegable({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  const [abierto, setAbierto] = useState(false);
  return (
    <div className="mt-4 border-t border-[var(--lu-border)]">
      <button
        type="button"
        onClick={() => setAbierto((prev) => !prev)}
        aria-expanded={abierto}
        className="flex w-full items-center justify-between gap-3 px-0 py-3 text-left transition-colors"
      >
        <span className="text-sm font-semibold text-[var(--lu-accent)]">{titulo}</span>
        <svg
          className={[
            "h-4 w-4 shrink-0 text-[var(--lu-accent)] transition-transform duration-200",
            abierto ? "rotate-180" : "",
          ].join(" ")}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {abierto && <div className="pb-1">{children}</div>}
    </div>
  );
}

function Encabezado({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span
        className="mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--lu-accent-light)] text-[var(--lu-accent)]"
        aria-hidden
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 16v-4" />
          <path d="M12 8h.01" />
        </svg>
      </span>
      <div className="min-w-0">
        <h2 className="text-lg font-bold text-[var(--lu-text)]">{titulo}</h2>
        <div className="mt-1.5 text-base leading-relaxed text-[var(--lu-subtle)]">{children}</div>
      </div>
    </div>
  );
}

function GuiaSintomas() {
  return (
    <div className="overflow-hidden">
      <div className="px-0 py-0">
        <Encabezado titulo="Elegí el síntoma más preciso que corresponda">
          Buscá cada síntoma y seleccionalo de la lista. Cuanto más específico sea el término,
          mejor funciona el sistema: uno preciso descarta muchas más enfermedades que uno general.
        </Encabezado>

        <div className="mt-4 rounded-xl border border-[var(--lu-border)] bg-white px-4 py-3">
          <div className="flex items-stretch gap-1" aria-hidden>
            {escalaEspecificidad.map((item, index) => (
              <div key={item.label} className="flex flex-1 flex-col gap-1.5">
                <div
                  className="h-1.5 rounded-full"
                  style={{
                    background:
                      index === escalaEspecificidad.length - 1
                        ? "var(--lu-accent)"
                        : `color-mix(in oklab, var(--lu-accent) ${25 + index * 25}%, var(--lu-border))`,
                  }}
                />
                <p className="text-[11px] uppercase tracking-wide text-[var(--lu-subtle)]">{item.nivel}</p>
                <p
                  className={[
                    "text-sm leading-snug",
                    index === escalaEspecificidad.length - 1
                      ? "font-semibold text-[var(--lu-text)]"
                      : "text-[var(--lu-subtle)]",
                  ].join(" ")}
                >
                  {item.label}
                </p>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-dashed border-[var(--lu-border)] bg-white px-4 py-3">
          <p className="text-base font-semibold text-[var(--lu-text)]">
            ¿No encontrás el síntoma en la lista?
          </p>
          <p className="mt-1 text-sm leading-relaxed text-[var(--lu-subtle)]">
            Si el término que buscás no aparece, o preferís partir de una historia clínica ya
            escrita, usá <strong className="font-semibold text-[var(--lu-text)]">Extraer síntomas de un texto</strong>,
            debajo de la lista: pegás el texto y detectamos los síntomas automáticamente. Después
            podés revisarlos y corregirlos en la lista.
          </p>
        </div>
      </div>

      <Desplegable titulo="¿Qué es un término HPO?">
        <p className="text-sm leading-relaxed text-[var(--lu-subtle)]">
          El <strong className="font-semibold text-[var(--lu-text)]">HPO (Human Phenotype Ontology)</strong> es
          el vocabulario médico internacional que se usa para nombrar signos y síntomas de forma
          estandarizada. Cada término tiene un código como{" "}
          <code className="rounded bg-[var(--lu-surface)] px-1 py-0.5 text-xs">HP:0031245</code>, y
          eso es lo que permite comparar este caso con bases genéticas de todo el mundo: el sistema
          no entiende &quot;tos con flema&quot;, pero sí entiende su término HPO.
        </p>
        <p className="mt-2 text-sm leading-relaxed text-[var(--lu-subtle)]">
          Los términos están organizados de lo general a lo particular, como un árbol. Por eso
          conviene bajar todo lo que se pueda en esa escala, y sumar varios síntomas específicos
          en vez de cargar uno solo.
        </p>
      </Desplegable>
    </div>
  );
}

function GuiaHistoria() {
  return (
    <div className="overflow-hidden">
      <div className="px-0 py-0">
        <Encabezado titulo="Qué va en este campo">
          Escribí o pegá el relato clínico del paciente: qué le pasa, desde cuándo y qué estudios
          se hicieron. No hace falta lenguaje técnico. Vamos a leer el texto y sumar a la lista
          de arriba los síntomas que encontremos, para que los revises antes de seguir.
        </Encabezado>

        <ul className="mt-4 grid gap-x-5 gap-y-3 sm:grid-cols-2">
          {queContar.map((item) => (
            <li key={item.titulo} className="flex gap-2.5">
              <svg
                className="mt-[3px] h-4 w-4 shrink-0 text-[var(--lu-accent)]"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M20 6L9 17l-5-5" />
              </svg>
              <p className="text-sm leading-snug text-[var(--lu-subtle)]">
                <span className="font-semibold text-[var(--lu-text)]">{item.titulo}. </span>
                {item.detalle}
              </p>
            </li>
          ))}
        </ul>

        <div className="mt-4 rounded-xl border border-dashed border-[var(--lu-border)] bg-white px-4 py-3">
          <p className="text-base font-semibold text-[var(--lu-text)]">
            Si ya sabés qué síntomas cargar, es mejor elegirlos vos
          </p>
          <p className="mt-1 text-sm leading-relaxed text-[var(--lu-subtle)]">
            Este campo es útil cuando partís de una historia clínica escrita. Pero la detección
            automática puede equivocarse o quedarse en términos poco precisos: si ya tenés claros
            los síntomas, buscalos en el panel{" "}
            <strong className="font-semibold text-[var(--lu-text)]">Síntomas del paciente</strong> y
            cargalos uno por uno.
          </p>
        </div>
      </div>

      <Desplegable titulo="Ver ejemplos de cómo escribirlo">
        <ul className="space-y-2.5">
          {ejemplosRelato.map((ejemplo) => (
            <li
              key={ejemplo.vago}
              className="grid gap-2 rounded-xl border border-[var(--lu-border)] bg-white p-3 sm:grid-cols-[1fr_auto_1.4fr] sm:items-center"
            >
              <span className="text-sm text-[var(--lu-subtle)] line-through decoration-[var(--lu-border)]">
                {ejemplo.vago}
              </span>
              <svg
                className="hidden h-4 w-4 text-[var(--lu-accent)] sm:block"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
              <span className="text-base font-semibold text-[var(--lu-text)]">{ejemplo.preciso}</span>
            </li>
          ))}
        </ul>
      </Desplegable>
    </div>
  );
}

export default function GuiaCarga({ variant }: { variant: Variant }) {
  return variant === "historia" ? <GuiaHistoria /> : <GuiaSintomas />;
}
