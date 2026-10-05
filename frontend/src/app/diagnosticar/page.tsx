"use client";

import Image from "next/image";
import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "../../lib/auth-context";
import { ConsultaGenetica } from "../../components/ui/ConsultaGenetica";
import { ErrorNotice } from "../../components/ui/ErrorNotice";
import { errorMessage, isSessionError, jsonOrThrow } from "../../lib/api-errors";
import { RESULTS_DISCLAIMER } from "../../lib/disclaimer";
import { especialidadesParaConsultar } from "../../lib/especialidades";
import { parseOnset, type SymptomOnset } from "../../lib/onset";
import { OnsetInline, OnsetSummary } from "../../components/ui/OnsetReport";

type TabId = "overview" | "integrantes";

type Symptom = {
  id: string;
  label: string;
  codigo?: string;
  onset?: SymptomOnset;
};

type Member = {
  id: string;
  nombre: string;
  savedAt: string;
  fechaNacimiento: string | null;
  sexo: string | null;
  localidad: string | null;
  pais: string | null;
  historiaClinica: string;
  sintomas: Symptom[];
  diagnostico: string;
  latestDiagnosisId: string | null;
};

type SavedDiagnostic = {
  id: string;
  nombre: string;
  savedAt: string;
  symptoms: Array<{ description: string; code: string }>;
  topSpecialties: string[];
  confidence: number | null;
  topGenes: string[];
};

const LS_KEY = "diagnosticar:records";
const BACKEND_API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api";

const tabs: Array<{ id: TabId; label: string }> = [
  { id: "overview", label: "Resumen" },
  { id: "integrantes", label: "Integrantes" },
];


function formatRelativeTime(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 2) return "Hace un momento";
  if (mins < 60) return `Hace ${mins} min`;
  if (hours < 24) return `Hace ${hours}h`;
  return `Hace ${days}d`;
}

type ApiPatient = {
  id: string;
  nombre: string;
  fecha_nacimiento: string | null;
  sexo: string | null;
  localidad: string | null;
  pais: string | null;
  created_at: string;
  latest_diagnosis: {
    id: string;
    historia_clinica: string;
    symptoms_extracted: Array<{ description?: string; code?: string }>;
    genphen_confidence: number | null;
    genphen_specialties: { top_specialties?: string[] } | null;
    genphen_genes_top5: Array<{ gene_symbol: string }>;
    created_at: string;
  } | null;
};

function mapSymptoms(rawSymptoms: unknown, memberId: string): Symptom[] {
  if (!Array.isArray(rawSymptoms)) {
    return [];
  }
  const symptoms: Symptom[] = [];
  rawSymptoms.forEach((item, index) => {
    if (!item || typeof item !== "object") {
      return;
    }
    const maybe = item as { description?: unknown; code?: unknown; onset?: unknown };
    const codigoRaw =
      typeof maybe.code === "string" && maybe.code.trim()
        ? maybe.code.trim().toUpperCase()
        : "";
    const label =
      typeof maybe.description === "string" && maybe.description.trim()
        ? maybe.description.trim()
        : codigoRaw;
    if (!label) {
      return;
    }
    const onset = parseOnset(maybe.onset);
    symptoms.push({
      id: `${memberId}-${codigoRaw || `sym-${index}`}-${index}`,
      label,
      codigo: codigoRaw || undefined,
      ...(onset ? { onset } : {}),
    });
  });
  return symptoms;
}


/**
 * The backend used to store this sentence of ours when no history was
 * written. Existing rows still hold it; it is not the family's account, so it
 * is read as "nothing written" rather than shown or re-submitted as theirs.
 */
const LEGACY_EMPTY_HISTORY = "Carga manual de síntomas sin historia clínica detallada.";

function writtenHistory(raw: unknown): string {
  const text = typeof raw === "string" ? raw.trim() : "";
  return text === LEGACY_EMPTY_HISTORY ? "" : text;
}

/** The specialties to consult, in Spanish, or what to say when there are none. */
function orientacion(topSpecialties: string[]): string {
  const especialidades = especialidadesParaConsultar(topSpecialties);
  return especialidades.length > 0
    ? `Te sugerimos consultar con: ${especialidades.join(", ")}.`
    : "Con estos síntomas no pudimos sugerir una especialidad en particular.";
}

function apiPatientToMember(p: ApiPatient): Member {
  const diag = p.latest_diagnosis;
  const topSpecialties = diag?.genphen_specialties?.top_specialties ?? [];
  const diagnostico = orientacion(topSpecialties);
  const savedAt = diag?.created_at ?? p.created_at;
  const historiaClinica = writtenHistory(diag?.historia_clinica);
  return {
    id: p.id,
    nombre: p.nombre,
    savedAt,
    fechaNacimiento: p.fecha_nacimiento,
    sexo: p.sexo,
    localidad: p.localidad,
    pais: p.pais,
    historiaClinica,
    sintomas: mapSymptoms(diag?.symptoms_extracted ?? [], p.id),
    diagnostico,
    latestDiagnosisId: diag?.id ?? null,
  };
}

function savedToMember(record: SavedDiagnostic): Member {
  const diag = orientacion(record.topSpecialties);

  return {
    id: record.id,
    nombre: record.nombre,
    savedAt: record.savedAt,
    fechaNacimiento: null,
    sexo: null,
    localidad: null,
    pais: null,
    historiaClinica: "",
    sintomas: record.symptoms.map((s, i) => ({
      id: `${record.id}-${i}`,
      label: s.description,
      codigo: s.code,
    })),
    diagnostico: diag,
    latestDiagnosisId: null,
  };
}

function DiagnosticarContent() {
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<TabId>(
    searchParams.get("tab") === "integrantes" ? "integrantes" : "overview"
  );
  const [members, setMembers] = useState<Member[]>([]);
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const router = useRouter();
  const { user, loading, logout, refreshSession } = useAuth();
  const [listState, setListState] = useState<"loading" | "ready" | "failed">("loading");
  const [listError, setListError] = useState<unknown>(null);
  const [listAttempt, setListAttempt] = useState(0);

  // Load saved diagnostics — from backend when authenticated, localStorage as fallback
  useEffect(() => {
    if (!user) return;

    const applyMembers = (loaded: Member[]) => {
      setMembers(loaded);
      if (loaded.length > 0) {
        setSelectedMemberId(loaded[0].id);
      }
    };

    let cancelled = false;
    const fetchPatients = () =>
      fetch(`${BACKEND_API_URL}/patients`, { credentials: "include" }).then((r) => jsonOrThrow<ApiPatient[]>(r));

    setListState("loading");
    setListError(null);
    fetchPatients()
      // An access token that lapsed while the tab slept is renewed once, not
      // reported as a failure.
      .catch(async (error) => {
        if (isSessionError(error) && (await refreshSession())) return fetchPatients();
        throw error;
      })
      .then((data) => {
        if (cancelled) return;
        applyMembers(data.map(apiPatientToMember));
        setListState("ready");
      })
      .catch((error) => {
        if (cancelled) return;
        console.error("[diagnosticar] patients failed", error);
        setListError(error);
        setListState("failed");
        // Searches kept on this device when saving to the account failed.
        try {
          const raw = localStorage.getItem(LS_KEY);
          const records: SavedDiagnostic[] = raw ? JSON.parse(raw) : [];
          applyMembers(records.map(savedToMember));
        } catch {
          // ignore corrupted data
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a renewed session must not refetch
  }, [user?.id, listAttempt]);

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/login");
    }
  }, [loading, user, router]);

  // Hooks must be called unconditionally — before any early returns
  const selectedMember = members.find((m) => m.id === selectedMemberId) ?? null;

  const activeMember = useMemo(() => selectedMember, [selectedMember]);

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center text-sm text-[var(--lu-subtle)]">
        Cargando…
      </main>
    );
  }

  if (!user) {
    return null;
  }

  const displayName = user.name?.trim() || user.email;

  const handleLogout = async () => {
    if (await logout()) router.replace("/login");
  };

  const handleSelectMember = (member: Member) => {
    setSelectedMemberId(member.id);
  };

  const jumpToSymptomStep = () => {
    if (!activeMember) {
      router.push("/nuevo");
      return;
    }
    if (!activeMember.latestDiagnosisId) {
      router.push("/nuevo");
      return;
    }
    if (typeof window !== "undefined") {
      const payload = {
        mode: "regenerate" as const,
        patientId: activeMember.id,
        sourceDiagnosisId: activeMember.latestDiagnosisId,
        nombre: activeMember.nombre,
        fechaNacimiento: activeMember.fechaNacimiento,
        sexo: activeMember.sexo,
        localidad: activeMember.localidad,
        pais: activeMember.pais,
        historiaClinica: activeMember.historiaClinica,
        sintomas: activeMember.sintomas.map((s) => ({
          description: s.label,
          code: s.codigo ?? "",
          ...(s.onset ? { onset: s.onset } : {}),
        })),
      };
      window.sessionStorage.setItem("diagnosticar:newDiagDraft", JSON.stringify(payload));
    }
    router.push("/nuevo?step=3&mode=regenerate");
  };

  const hasMembers = members.length > 0;

  return (
    <main className="page-root relative overflow-hidden">
      <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full diagnostic-hero-bg blur-3xl pointer-events-none animate-breathe" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[40%] h-[40%] rounded-full diagnostic-hero-bg blur-3xl pointer-events-none animate-breathe" style={{ animationDelay: "3s" }} />

      <header className="sticky top-0 z-20 w-full backdrop-blur-md bg-[color-mix(in_oklab,var(--lu-bg)_80%,transparent)] border-b border-[var(--lu-border)]">
        <div className="mx-auto max-w-7xl flex items-center justify-between px-5 py-4">
          <Link href="/home" className="flex items-center" aria-label="Regresar al home">
            <Image src="/brand/logo-diagnosticar.svg" alt="Diagnostic.ar" width={360} height={88} className="h-16 w-auto" priority />
          </Link>
          <nav className="flex items-center gap-5">
            <Link href="/home" className="text-sm font-medium text-[var(--lu-subtle)] hover:text-[var(--lu-text)] transition-colors">Home</Link>
            <span className="user-badge truncate">{displayName}</span>
            <button type="button" onClick={handleLogout} className="nav-link text-sm">Cerrar sesión</button>
          </nav>
        </div>
      </header>

      <div className="content-wrap relative z-10">
        <section className="mx-auto max-w-7xl w-full px-5 pt-12 pb-24 flex-1">
          <div className="rounded-[32px] border border-[var(--lu-border)] bg-[var(--lu-surface)] px-6 py-8 shadow-[var(--lu-shadow)]">
            <div className="flex flex-wrap items-center justify-between gap-3 pb-6 border-b border-[var(--lu-border)]">
              <span className="inline-flex items-center gap-2 text-xs uppercase tracking-widest text-[var(--lu-accent)] font-semibold">
                <span className="inline-flex h-2 w-2 rounded-full bg-[var(--lu-accent)]" aria-hidden />
                Diagnostic.ar
              </span>
            </div>

            <div className="flex flex-wrap gap-3 border-b border-[var(--lu-border)] pb-5 pt-6">
              {tabs.map((tab) => {
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    className={[
                      "relative rounded-full px-6 py-2.5 text-sm font-semibold transition-all duration-200",
                      isActive
                        ? "bg-white text-[var(--lu-accent)] shadow-sm ring-1 ring-[var(--lu-border)]"
                        : "text-[var(--lu-subtle)] hover:text-[var(--lu-text)] hover:bg-[color-mix(in_oklab,var(--lu-surface)_90%,#000)]",
                    ].join(" ")}
                  >
                    {tab.label}
                    {isActive && (
                      <span className="absolute bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-[var(--lu-accent)]" aria-hidden />
                    )}
                  </button>
                );
              })}

              <button
                type="button"
                onClick={() => router.push("/nuevo")}
                className="relative rounded-full px-6 py-2.5 text-sm font-semibold transition-all duration-200 text-white bg-[var(--lu-accent)] hover:bg-[color-mix(in_oklab,var(--lu-accent)_90%,#000)] shadow-md hover:shadow-lg"
              >
                Nueva búsqueda +
              </button>
            </div>

            <div className="pt-8">
              {activeTab === "overview" && (
                <div className="grid gap-6 lg:grid-cols-[0.55fr_0.45fr]">
                  <div className="rounded-3xl border border-[var(--lu-border)] bg-white p-8 shadow-sm">
                    <div className="space-y-5">
                      <h2 className="text-3xl font-bold text-[var(--lu-text)] leading-tight">
                        Diagnóstico asistido para médicos y familias
                      </h2>
                      <p className="text-[var(--lu-subtle)] text-base leading-relaxed">
                        Diagnostic.ar reúne historias clínicas, síntomas y modelos predictivos para que equipos de salud y
                        personas que buscan respuestas interpreten su cuadro con la guía del modelo de Diagnostic.ar.
                      </p>
                    </div>
                  </div>

                  <div className="grid gap-4">
                    <div className="rounded-3xl border border-[var(--lu-border)] bg-white p-6 shadow-sm hover:shadow-md transition-shadow">
                      <h3 className="text-lg font-bold mb-2 text-[var(--lu-text)]">Onboarding guiado</h3>
                      <p className="text-[var(--lu-subtle)] text-sm leading-relaxed">
                        Registro y autenticación simple para usuarios no técnicos, con recordatorios de secciones incompletas y carga segura de historias clínicas.
                      </p>
                    </div>
                    <div className="rounded-3xl border border-[var(--lu-border)] bg-white p-6 shadow-sm hover:shadow-md transition-shadow">
                      <h3 className="text-lg font-bold mb-2 text-[var(--lu-text)]">Conversación inteligente</h3>
                      <p className="text-[var(--lu-subtle)] text-sm leading-relaxed">
                        Diagnostic.ar guía preguntas de seguimiento para capturar síntomas clave y dejar un registro claro para profesionales y pacientes.
                      </p>
                    </div>
                    <div className="rounded-3xl border border-[var(--lu-border)] bg-white p-6 shadow-sm hover:shadow-md transition-shadow">
                      <h3 className="text-lg font-bold mb-2 text-[var(--lu-text)]">Diagnóstico asistido</h3>
                      <p className="text-[var(--lu-subtle)] text-sm leading-relaxed">
                        Entregamos devoluciones accionables: diagnósticos sugeridos, recomendaciones y próximos pasos listos para compartir con clínicos y pacientes.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === "integrantes" && (
                <>
                  {listState === "failed" && (
                    <ErrorNotice
                      className="mb-6"
                      error={listError}
                      message={`No pudimos cargar tus búsquedas guardadas. ${errorMessage(listError, "patients_list")}${
                        hasMembers ? " Mientras tanto, abajo ves las que quedaron guardadas en este dispositivo." : ""
                      }`}
                      onRetry={() => setListAttempt((n) => n + 1)}
                    />
                  )}
                  {listState === "loading" && !hasMembers ? (
                    <p role="status" className="py-20 text-center text-sm text-[var(--lu-subtle)]">
                      Cargando tus búsquedas…
                    </p>
                  ) : listState === "failed" && !hasMembers ? null : !hasMembers ? (
                    /* ── Empty state ── */
                    <div className="flex flex-col items-center justify-center py-20 text-center">
                      <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-[var(--lu-surface)] border border-[var(--lu-border)]">
                        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--lu-subtle)]" aria-hidden>
                          <path d="M9 12h6M12 9v6M12 3C7.03 3 3 7.03 3 12s4.03 9 9 9 9-4.03 9-9-4.03-9-9-9z" />
                        </svg>
                      </div>
                      <h3 className="text-xl font-bold text-[var(--lu-text)] mb-2">Todavía no tenés diagnósticos guardados</h3>
                      <p className="text-[var(--lu-subtle)] text-base max-w-md leading-relaxed mb-8">
                        Acá vas a poder ver todos los diagnósticos que realizaste. Para empezar tu primer diagnóstico, hacé click en el botón de abajo.
                      </p>
                      <button
                        type="button"
                        onClick={() => router.push("/nuevo")}
                        className="inline-flex items-center gap-2 rounded-full bg-[var(--lu-accent)] px-8 py-3 text-sm font-semibold text-white shadow-md hover:bg-[color-mix(in_oklab,var(--lu-accent)_90%,#000)] transition-all"
                      >
                        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-white/20 text-sm font-bold">+</span>
                        Nueva búsqueda
                      </button>
                    </div>
                  ) : activeMember ? (
                    /* ── Members list + detail ── */
                    <div className="grid gap-6 lg:grid-cols-[minmax(0,0.42fr)_minmax(0,0.58fr)]">
                      <div className="space-y-3">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-xs uppercase tracking-[0.32em] text-[var(--lu-subtle)]">Selecciona un integrante</p>
                          <button
                            type="button"
                            className="flex items-center gap-2 rounded-full border border-[color-mix(in_oklab,var(--lu-accent)_55%,#8c3d00)] px-3 py-1.5 text-xs font-semibold text-[var(--lu-accent)] hover:bg-[rgba(31,20,10,0.65)] transition-colors"
                            onClick={() => router.push("/nuevo")}
                          >
                            <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-[var(--lu-accent)] text-[var(--lu-bg)] text-[11px] font-bold">+</span>
                            Nuevo
                          </button>
                        </div>
                        <div className="flex flex-col gap-3">
                          {members.map((member) => {
                            const isSelected = member.id === activeMember.id;
                            return (
                              <button
                                key={member.id}
                                type="button"
                                onClick={() => handleSelectMember(member)}
                                className={[
                                  "flex items-center justify-between rounded-3xl border px-4 py-3 text-left transition-all duration-150",
                                  isSelected
                                    ? "border-[var(--lu-accent)] bg-white text-[var(--lu-text)] shadow-md ring-1 ring-[var(--lu-accent)]"
                                    : "border-[var(--lu-border)] bg-[var(--lu-surface)] text-[var(--lu-subtle)] hover:text-[var(--lu-text)] hover:border-[var(--lu-subtle)]",
                                ].join(" ")}
                              >
                                <div>
                                  <p className="text-base font-semibold">{member.nombre}</p>
                                  <p className="text-xs text-[var(--lu-subtle)]">{formatRelativeTime(member.savedAt)}</p>
                                </div>
                                <span className={["inline-flex h-2.5 w-2.5 rounded-full", isSelected ? "bg-[var(--lu-accent)]" : "bg-[var(--lu-border)]"].join(" ")} aria-hidden />
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div className="min-w-0 rounded-[28px] border border-[var(--lu-border)] bg-white p-8 shadow-lg">
                        <div className="flex items-center justify-between gap-4">
                          <div>
                            <p className="text-xs uppercase tracking-widest text-[var(--lu-subtle)]">Integrante</p>
                            <h2 className="mt-2 text-2xl font-bold text-[var(--lu-text)]">{activeMember.nombre}</h2>
                          </div>
                          <div className="rounded-full border border-[var(--lu-border)] bg-[var(--lu-surface)] px-4 py-2 text-xs font-medium text-[var(--lu-subtle)]">
                            Resultado orientativo
                          </div>
                        </div>

                        <div className="mt-6 space-y-6 text-sm text-[var(--lu-subtle)]">
                          <div>
                            {/* What was pasted can be a clinical history, a doctor's report or a
                                family's notes, so it is named for what the platform did with it. */}
                            <p className="mb-1 text-xs uppercase tracking-widest text-[var(--lu-subtle)]">Texto analizado</p>
                            {activeMember.historiaClinica ? (
                              <details className="group min-w-0 rounded-2xl border border-[var(--lu-border)] bg-[var(--lu-surface)] px-4 py-3">
                                <summary className="flex min-w-0 cursor-pointer list-none items-center gap-2">
                                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
                                    <path d="M14 2H6a2 2 0 0 0-2 2v16l4-2 4 2 4-2 4 2V8z" />
                                    <polyline points="14 2 14 8 20 8" />
                                  </svg>
                                  <span className="min-w-0 flex-1 truncate font-medium group-open:hidden">
                                    {activeMember.historiaClinica}
                                  </span>
                                  <span className="hidden flex-1 font-medium group-open:block">Texto completo</span>
                                  <svg
                                    width="16"
                                    height="16"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    aria-hidden="true"
                                    className="shrink-0 text-[var(--lu-accent)] transition-transform group-open:rotate-180"
                                  >
                                    <path d="M6 9l6 6 6-6" />
                                  </svg>
                                </summary>
                                <p className="mt-3 whitespace-pre-wrap break-words border-t border-[var(--lu-border)] pt-3 leading-relaxed">
                                  {activeMember.historiaClinica}
                                </p>
                              </details>
                            ) : (
                              <p className="rounded-2xl border border-dashed border-[var(--lu-border)] px-4 py-3 leading-relaxed">
                                No se analizó ningún texto: los síntomas se eligieron de la lista.
                              </p>
                            )}
                          </div>

                          <div>
                            <p className="mb-2 text-xs uppercase tracking-widest text-[var(--lu-subtle)]">Síntomas reportados</p>
                            <ul className="flex min-w-0 flex-wrap gap-2">
                              {activeMember.sintomas.length === 0 ? (
                                <li className="text-xs text-[var(--lu-subtle)]">No hay síntomas cargados para esta búsqueda.</li>
                              ) : activeMember.sintomas.map((symptom) => (
                                <li key={symptom.id} className="flex items-center gap-2 rounded-full border border-[var(--lu-border)] bg-[var(--lu-surface)] px-3 py-1 text-xs text-[var(--lu-text)]">
                                  <span className="font-semibold">{symptom.label}</span>
                                  {symptom.codigo && <span className="text-[10px] text-[var(--lu-subtle)]">{symptom.codigo}</span>}
                                  <OnsetInline onset={symptom.onset} />
                                </li>
                              ))}
                            </ul>
                            <OnsetSummary
                              symptoms={activeMember.sintomas.map((s) => ({ label: s.label, onset: s.onset }))}
                              className="mt-3"
                            />
                          </div>

                          <div>
                            <p className="mb-2 text-xs uppercase tracking-widest text-[var(--lu-subtle)]">Especialidades sugeridas</p>
                            <p className="rounded-2xl border border-[var(--lu-border)] bg-[var(--lu-surface)] p-4 text-sm leading-relaxed text-[var(--lu-text)] break-words">
                              {activeMember.diagnostico}
                            </p>
                            <ConsultaGenetica className="mt-3" />
                            <p className="mt-3 text-xs leading-relaxed text-[var(--lu-subtle)]">{RESULTS_DISCLAIMER}</p>
                            <div className="mt-4 flex flex-wrap gap-3">
                              <button
                                type="button"
                                className="inline-flex items-center justify-center h-10 px-4 rounded-xl border border-[var(--lu-accent)] text-[var(--lu-accent)] font-medium hover:bg-[var(--lu-accent)] hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                onClick={jumpToSymptomStep}
                                disabled={!activeMember.latestDiagnosisId}
                              >
                                Volver a buscar
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </>
              )}
            </div>
          </div>
        </section>

        <div className="grow" />
      </div>

      <footer className="border-t border-[var(--lu-border)] bg-[var(--lu-surface)] py-12">
        <div className="mx-auto max-w-7xl px-5 flex flex-col gap-8 items-start">
          <div>
            <h2 className="text-xl font-bold text-[var(--lu-text)] mb-2">Diagnostic.ar</h2>
            <p className="text-[var(--lu-subtle)] max-w-lg">
              Potenciamos tu práctica clínica con orientación diagnóstica basada en evidencia y modelos de fenotipado.
            </p>
          </div>
          <div>
            <h2 className="text-xl font-bold text-[var(--lu-text)] mb-2">Contactanos</h2>
            <p className="text-[var(--lu-subtle)]">
              <a href="mailto:diagnosticar.ar@gmail.com" className="hover:text-[var(--lu-accent)] transition-colors">diagnosticar.ar@gmail.com</a>
            </p>
          </div>
        </div>
      </footer>
    </main>
  );
}

export default function DiagnosticarPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen flex items-center justify-center text-sm text-[var(--lu-subtle)]">
          Cargando…
        </main>
      }
    >
      <DiagnosticarContent />
    </Suspense>
  );
}
