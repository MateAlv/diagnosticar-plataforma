"use client";

import Image from "next/image";
import Link from "next/link";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";

type Step = 1 | 2 | 3 | 4;

type Symptom = {
    description: string;
    code: string;
};

const stepsMeta: Array<{ id: Step; title: string }> = [
    { id: 1, title: "Datos básicos" },
    { id: 2, title: "Historia Clínica" },
    { id: 3, title: "Síntomas" },
    { id: 4, title: "Orientación" },
];

const defaultSymptoms: Symptom[] = [
    { description: "Fatiga persistente", code: "HP:0012378" },
    { description: "Dolor abdominal", code: "HP:0002027" },
    { description: "Cambios en peso", code: "HP:0004324" },
];

const countries = [
    "Argentina",
    "Bolivia",
    "Brasil",
    "Chile",
    "Colombia",
    "Ecuador",
    "Paraguay",
    "Perú",
    "Uruguay",
    "Venezuela",
    "Otro",
];

function DemoScreen() {
    const [step, setStep] = useState<Step>(1);
    const [isLoading, setIsLoading] = useState(false);
    const [loadingMessage, setLoadingMessage] = useState("");
    const timeoutRef = useRef<NodeJS.Timeout | null>(null);

    const [datosBasicos, setDatosBasicos] = useState({
        nombre: "",
        fechaNacimiento: "",
        sexo: "",
        localidad: "",
        pais: "",
        datosRelevantes: "",
    });

    const [historiaClinica, setHistoriaClinica] = useState("");
    const [symptoms, setSymptoms] = useState<Symptom[]>([]);
    const [newSymptom, setNewSymptom] = useState({ description: "", code: "" });

    const canGoStep1 = useMemo(() => {
        // En demo somos más laxos, pero pedimos lo mínimo para que parezca real
        return (
            datosBasicos.nombre.trim() !== "" &&
            datosBasicos.fechaNacimiento.trim() !== ""
        );
    }, [datosBasicos]);

    const canGoStep2 = historiaClinica.trim().length > 5; // Demo más permisiva
    const canGoStep3 = symptoms.length > 0;

    useEffect(() => {
        return () => {
            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
            }
        };
    }, []);

    const handleContinue = () => {
        if (step === 1) {
            setStep(2);
            return;
        }

        if (step === 2) {
            setIsLoading(true);
            setLoadingMessage("Analizando texto (Modo Demo)...");
            timeoutRef.current = setTimeout(() => {
                setSymptoms(defaultSymptoms);
                setIsLoading(false);
                setLoadingMessage("");
                setStep(3);
            }, 2000);
            return;
        }

        if (step === 3) {
            setIsLoading(true);
            setLoadingMessage("Generando orientación preliminar...");
            timeoutRef.current = setTimeout(() => {
                setIsLoading(false);
                setLoadingMessage("");
                setStep(4);
            }, 2000);
            return;
        }
    };

    const handleAddSymptom = () => {
        if (!newSymptom.description.trim()) return;
        setSymptoms((prev) => [
            ...prev,
            {
                description: newSymptom.description.trim(),
                code: newSymptom.code.trim().toUpperCase() || "HP:???????",
            },
        ]);
        setNewSymptom({ description: "", code: "" });
    };

    const handleRemoveSymptom = (code: string) => {
        setSymptoms((prev) => prev.filter((symptom) => symptom.code !== code));
    };

    const stepTitle = stepsMeta.find((meta) => meta.id === step)?.title ?? "";

    return (
        <main className="page-root relative overflow-hidden min-h-screen bg-[var(--lu-surface)]">
            {/* Background decoration */}
            <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full diagnostic-hero-bg blur-3xl pointer-events-none animate-breathe" />

            <header className="sticky top-0 z-20 w-full backdrop-blur-md bg-white/80 border-b border-[var(--lu-border)]">
                <div className="mx-auto max-w-7xl flex items-center justify-between px-5 py-4">
                    <Link href="/" className="flex items-center" aria-label="Regresar al home">
                        <Image
                            src="/brand/logo-diagnosticar.svg"
                            alt="Diagnostic.ar"
                            width={360}
                            height={88}
                            className="h-16 w-auto"
                            priority
                        />
                    </Link>

                    <div className="flex items-center gap-4">
                        <span className="px-3 py-1 rounded-full bg-amber-100 text-amber-700 text-xs font-bold uppercase tracking-wider border border-amber-200">
                            Modo Demostración
                        </span>
                        <Link href="/sign-up" className="text-sm font-medium text-[var(--lu-accent)] hover:underline">
                            Crear cuenta
                        </Link>
                    </div>
                </div>
            </header>

            <div className="content-wrap relative z-10">
                <section className="mx-auto max-w-5xl w-full px-5 pt-8 pb-24 flex-1">

                    {/* Demo Banner */}
                    <div className="mb-6 rounded-xl bg-blue-50 border border-blue-100 p-4 flex items-start gap-3">
                        <div className="text-blue-500 mt-0.5">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" /></svg>
                        </div>
                        <div className="text-sm text-blue-800">
                            <p className="font-semibold">Estás probando Diagnostic.ar sin registrarte.</p>
                            <p className="opacity-90">Podés cargar síntomas y recibir una orientación inicial, pero la información <strong>no se guardará</strong>. Para seguimiento y múltiples perfiles, creá una cuenta gratuita.</p>
                        </div>
                    </div>

                    <div className="rounded-[32px] border border-[var(--lu-border)] bg-white px-8 py-10 shadow-sm relative overflow-hidden">
                        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--lu-border)] pb-8">
                            <div className="space-y-2">
                                <span className="inline-flex items-center gap-2 text-xs uppercase tracking-widest text-[var(--lu-subtle)] font-semibold">
                                    Prueba rápida
                                </span>
                                <h1 className="text-3xl font-bold text-[var(--lu-text)] leading-tight">{stepTitle}</h1>
                            </div>

                            <div className="flex items-center gap-3">
                                {stepsMeta.map((meta) => {
                                    const isActive = step === meta.id;
                                    const isCompleted = step > meta.id;
                                    return (
                                        <span
                                            key={meta.id}
                                            className={[
                                                "flex h-8 w-8 items-center justify-center rounded-full border text-xs font-bold transition-all duration-200",
                                                isActive
                                                    ? "border-[var(--lu-accent)] bg-[var(--lu-accent)] text-white shadow-md"
                                                    : isCompleted
                                                        ? "border-[var(--lu-accent)] bg-white text-[var(--lu-accent)]"
                                                        : "border-[var(--lu-border)] bg-slate-50 text-[var(--lu-subtle)]",
                                            ].join(" ")}
                                        >
                                            {meta.id}
                                        </span>
                                    );
                                })}
                            </div>
                        </div>

                        <div className="relative pt-8">
                            {isLoading && (
                                <div className="absolute inset-0 z-10 grid place-items-center rounded-[24px] bg-white/90 backdrop-blur-sm">
                                    <div className="flex flex-col items-center gap-4 text-center">
                                        <div className="h-12 w-12 animate-spin rounded-full border-4 border-[var(--lu-border)] border-t-[var(--lu-accent)]" aria-hidden />
                                        <p className="text-sm font-semibold text-[var(--lu-subtle)]">{loadingMessage}</p>
                                    </div>
                                </div>
                            )}

                            {step === 1 && (
                                <div className="grid gap-6 lg:grid-cols-2">
                                    <div className="lg:col-span-2">
                                        <label className="block text-sm font-bold text-[var(--lu-text)] mb-2">
                                            Nombre o apodo (Fantasía)
                                            <input
                                                type="text"
                                                value={datosBasicos.nombre}
                                                onChange={(event) => setDatosBasicos((prev) => ({ ...prev, nombre: event.target.value }))}
                                                className="mt-2 w-full rounded-xl border border-[var(--lu-border)] bg-white px-4 py-3 text-[var(--lu-text)] focus:border-[var(--lu-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--lu-accent-light)] transition-all"
                                                placeholder="Ej. Paciente A, Juan Pérez..."
                                            />
                                        </label>
                                    </div>

                                    <div className="space-y-5">
                                        <label className="block text-sm font-bold text-[var(--lu-text)] mb-2">
                                            Fecha de nacimiento (Aprox)
                                            <input
                                                type="date"
                                                value={datosBasicos.fechaNacimiento}
                                                onChange={(event) =>
                                                    setDatosBasicos((prev) => ({ ...prev, fechaNacimiento: event.target.value }))
                                                }
                                                className="mt-2 w-full rounded-xl border border-[var(--lu-border)] bg-white px-4 py-3 text-[var(--lu-text)] focus:border-[var(--lu-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--lu-accent-light)] transition-all"
                                            />
                                        </label>
                                    </div>

                                    <div className="space-y-5">
                                        <label className="block text-sm font-bold text-[var(--lu-text)] mb-2">
                                            País
                                            <select
                                                value={datosBasicos.pais}
                                                onChange={(event) => setDatosBasicos((prev) => ({ ...prev, pais: event.target.value }))}
                                                className="mt-2 w-full rounded-xl border border-[var(--lu-border)] bg-white px-4 py-3 text-[var(--lu-text)] focus:border-[var(--lu-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--lu-accent-light)] transition-all appearance-none"
                                            >
                                                <option value="">Seleccioná</option>
                                                {countries.map((country) => (
                                                    <option key={country} value={country}>
                                                        {country}
                                                    </option>
                                                ))}
                                            </select>
                                        </label>
                                    </div>
                                </div>
                            )}

                            {step === 2 && (
                                <div className="space-y-5">
                                    <p className="text-sm text-[var(--lu-subtle)]">
                                        Describí brevemente los síntomas o pegá un resumen de la historia clínica.
                                    </p>
                                    <textarea
                                        value={historiaClinica}
                                        onChange={(event) => setHistoriaClinica(event.target.value)}
                                        rows={8}
                                        placeholder="Ej. El paciente presenta dolor muscular frecuente y fatiga..."
                                        className="w-full rounded-2xl border border-[var(--lu-border)] bg-white px-4 py-3 text-[var(--lu-text)] focus:border-[var(--lu-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--lu-accent-light)] transition-all"
                                    />
                                </div>
                            )}

                            {step === 3 && (
                                <div className="space-y-6">
                                    <div className="space-y-3">
                                        <p className="text-sm text-[var(--lu-subtle)]">
                                            Estos son algunos síntomas detectados (simulados en demo).
                                        </p>
                                        <div className="flex flex-wrap gap-3">
                                            {symptoms.map((symptom, idx) => (
                                                <span
                                                    key={idx}
                                                    className="inline-flex items-center gap-3 rounded-full border border-[var(--lu-border)] bg-white px-4 py-1.5 text-sm text-[var(--lu-text)] shadow-sm"
                                                >
                                                    <span className="font-semibold">{symptom.description}</span>
                                                    {symptom.code && (
                                                        <span className="text-xs text-[var(--lu-subtle)]">{symptom.code}</span>
                                                    )}
                                                    <button
                                                        type="button"
                                                        className="ml-1 inline-flex h-6 w-6 items-center justify-center rounded-full border border-[var(--lu-border)] text-xs text-[var(--lu-subtle)] hover:text-[var(--lu-accent)] hover:border-[var(--lu-accent)] transition-colors"
                                                        onClick={() => handleRemoveSymptom(symptom.code)}
                                                    >
                                                        ×
                                                    </button>
                                                </span>
                                            ))}
                                        </div>
                                    </div>

                                    <div className="rounded-2xl border border-[var(--lu-border)] bg-slate-50 p-6 shadow-sm">
                                        <h2 className="text-sm font-bold text-[var(--lu-text)]">Agregar síntoma manualmente</h2>
                                        <div className="mt-4 grid gap-4 md:grid-cols-[1fr_auto]">
                                            <input
                                                type="text"
                                                placeholder="Descripción del síntoma"
                                                value={newSymptom.description}
                                                onChange={(event) =>
                                                    setNewSymptom((prev) => ({ ...prev, description: event.target.value }))
                                                }
                                                className="rounded-xl border border-[var(--lu-border)] bg-white px-4 py-3 text-[var(--lu-text)] focus:border-[var(--lu-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--lu-accent-light)] transition-all"
                                            />
                                            <button
                                                type="button"
                                                className="inline-flex items-center justify-center h-11 px-6 rounded-xl border border-[var(--lu-accent)] text-[var(--lu-accent)] font-medium hover:bg-[var(--lu-accent)] hover:text-white transition-colors"
                                                onClick={handleAddSymptom}
                                            >
                                                Agregar
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {step === 4 && (
                                <div className="space-y-8 text-center py-8">
                                    <div className="inline-flex h-20 w-20 items-center justify-center rounded-full bg-green-100 text-green-600 mb-4">
                                        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>
                                    </div>

                                    <h2 className="text-3xl font-bold text-[var(--lu-text)]">Análisis Preliminar Completado</h2>

                                    <p className="max-w-xl mx-auto text-[var(--lu-subtle)] text-lg">
                                        En base a los síntomas ingresados, el sistema ha generado una orientación inicial. Para ver el reporte completo, acceder a sugerencias de estudios y guardar este historial, necesitás una cuenta.
                                    </p>

                                    <div className="max-w-md mx-auto bg-white border border-[var(--lu-border)] rounded-2xl p-6 shadow-lg">
                                        <h3 className="font-bold text-lg mb-2">¿Qué obtenés al registrarte?</h3>
                                        <ul className="text-left space-y-3 mb-6">
                                            <li className="flex items-start gap-3 text-sm text-slate-600">
                                                <span className="text-green-500 mt-0.5">✓</span>
                                                Reporte detallado con orientación diagnóstica.
                                            </li>
                                            <li className="flex items-start gap-3 text-sm text-slate-600">
                                                <span className="text-green-500 mt-0.5">✓</span>
                                                Sugerencias de estudios complementarios.
                                            </li>
                                            <li className="flex items-start gap-3 text-sm text-slate-600">
                                                <span className="text-green-500 mt-0.5">✓</span>
                                                Posibilidad de guardar múltiples perfiles.
                                            </li>
                                            <li className="flex items-start gap-3 text-sm text-slate-600">
                                                <span className="text-green-500 mt-0.5">✓</span>
                                                Privacidad total: sin datos personales reales obligatorios.
                                            </li>
                                        </ul>

                                        <Link href="/sign-up" className="btn-primary w-full h-12 rounded-xl text-lg font-bold shadow-lg hover:shadow-xl transition-all flex items-center justify-center">
                                            Crear cuenta gratuita
                                        </Link>
                                        <p className="mt-4 text-xs text-slate-400">
                                            Es gratis y toma menos de 1 minuto.
                                        </p>
                                    </div>

                                    <button onClick={() => window.location.reload()} className="text-sm text-[var(--lu-subtle)] hover:text-[var(--lu-text)] underline">
                                        Probar de nuevo (borrar todo)
                                    </button>
                                </div>
                            )}
                        </div>

                        {step < 4 && (
                            <div className="mt-10 flex justify-end border-t border-[var(--lu-border)] pt-6">
                                <button
                                    type="button"
                                    className="inline-flex items-center justify-center h-12 px-8 rounded-xl bg-[var(--lu-accent)] text-white font-bold hover:bg-[color-mix(in_oklab,var(--lu-accent)_90%,#000)] shadow-md transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                                    onClick={handleContinue}
                                    disabled={
                                        (step === 1 && !canGoStep1) ||
                                        (step === 2 && !canGoStep2) ||
                                        (step === 3 && !canGoStep3) ||
                                        isLoading
                                    }
                                >
                                    {step === 3 ? "Ver Orientación" : "Continuar"}
                                </button>
                            </div>
                        )}
                    </div>
                </section>
            </div>
        </main>
    );
}

export default function DemoPage() {
    return (
        <Suspense fallback={<div>Cargando demo...</div>}>
            <DemoScreen />
        </Suspense>
    );
}
