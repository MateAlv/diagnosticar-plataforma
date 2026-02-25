"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "../../lib/auth-context";

type TabId = "overview" | "integrantes";

type Symptom = {
  id: string;
  label: string;
  codigo?: string;
};

type Member = {
  id: string;
  nombre: string;
  savedAt: string;
  historiaClinica: string;
  sintomas: Symptom[];
  diagnostico: string;
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

const tabs: Array<{ id: TabId; label: string }> = [
  { id: "overview", label: "Resumen" },
  { id: "integrantes", label: "Integrantes" },
];

const createSymptomId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `sym-${Math.random().toString(16).slice(2)}-${Date.now()}`;
};

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

function savedToMember(record: SavedDiagnostic): Member {
  const diag =
    record.topSpecialties.length > 0
      ? `Especialidad/es recomendada/s: ${record.topSpecialties.join(", ")}.`
      : "Sin orientación diagnóstica disponible.";

  return {
    id: record.id,
    nombre: record.nombre,
    savedAt: record.savedAt,
    historiaClinica: `Diagnóstico · ${new Date(record.savedAt).toLocaleDateString("es-AR")}`,
    sintomas: record.symptoms.map((s, i) => ({
      id: `${record.id}-${i}`,
      label: s.description,
      codigo: s.code,
    })),
    diagnostico: diag,
  };
}

export default function DiagnosticarPage() {
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<TabId>(
    searchParams.get("tab") === "integrantes" ? "integrantes" : "overview"
  );
  const [members, setMembers] = useState<Member[]>([]);
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [symptomDrafts, setSymptomDrafts] = useState<Record<string, Symptom[]>>({});
  const [newSymptom, setNewSymptom] = useState<Record<string, { label: string; code: string }>>({});
  const router = useRouter();
  const { user, loading, logout } = useAuth();

  // Load saved diagnostics from localStorage
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = localStorage.getItem(LS_KEY);
      const records: SavedDiagnostic[] = raw ? JSON.parse(raw) : [];
      const loaded = records.map(savedToMember);
      setMembers(loaded);
      if (loaded.length > 0) {
        setSelectedMemberId(loaded[0].id);
        const drafts: Record<string, Symptom[]> = {};
        const inputs: Record<string, { label: string; code: string }> = {};
        for (const m of loaded) {
          drafts[m.id] = m.sintomas.map((s) => ({ ...s }));
          inputs[m.id] = { label: "", code: "" };
        }
        setSymptomDrafts(drafts);
        setNewSymptom(inputs);
      }
    } catch {
      // ignore corrupted data
    }
  }, []);

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/login");
    }
  }, [loading, user, router]);

  // Hooks must be called unconditionally — before any early returns
  const selectedMember = members.find((m) => m.id === selectedMemberId) ?? null;

  const activeMember = useMemo(() => {
    if (!selectedMember) return null;
    return {
      ...selectedMember,
      sintomas: symptomDrafts[selectedMember.id] ?? [],
    };
  }, [selectedMember, symptomDrafts]);

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
    await logout();
    router.replace("/login");
  };

  const handleSelectMember = (member: Member) => {
    setSelectedMemberId(member.id);
    setNewSymptom((prev) => ({
      ...prev,
      [member.id]: prev[member.id] ?? { label: "", code: "" },
    }));
  };

  const handleDraftChange = (memberId: string, field: "label" | "code", value: string) => {
    setNewSymptom((prev) => ({
      ...prev,
      [memberId]: { ...prev[memberId], [field]: value },
    }));
  };

  const handleAddSymptom = (memberId: string) => {
    const draft = newSymptom[memberId];
    if (!draft?.label.trim() || !draft.code.trim()) return;
    setSymptomDrafts((prev) => {
      const nextList = [...(prev[memberId] ?? [])];
      nextList.push({ id: createSymptomId(), label: draft.label.trim(), codigo: draft.code.trim().toUpperCase() });
      return { ...prev, [memberId]: nextList };
    });
    setNewSymptom((prev) => ({ ...prev, [memberId]: { label: "", code: "" } }));
  };

  const handleRemoveSymptom = (memberId: string, symptomId: string) => {
    setSymptomDrafts((prev) => ({
      ...prev,
      [memberId]: (prev[memberId] ?? []).filter((s) => s.id !== symptomId),
    }));
  };

  const jumpToSymptomStep = () => {
    if (!activeMember) {
      router.push("/nuevo");
      return;
    }
    if (typeof window !== "undefined") {
      const payload = {
        nombre: activeMember.nombre,
        sintomas: (symptomDrafts[activeMember.id] ?? []).map((s) => ({
          description: s.label,
          code: s.codigo ?? "",
        })),
      };
      window.sessionStorage.setItem("diagnosticar:newDiagDraft", JSON.stringify(payload));
    }
    router.push("/nuevo?step=3");
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
                Nuevo Diagnóstico +
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
                        personas que buscan respuestas interpreten su cuadro con la guía de GenPhenIA.
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
                        GenPhenIA guía preguntas de seguimiento para capturar síntomas clave y dejar un registro claro para profesionales y pacientes.
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
                  {!hasMembers ? (
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
                        Nuevo diagnóstico
                      </button>
                    </div>
                  ) : activeMember ? (
                    /* ── Members list + detail ── */
                    <div className="grid gap-6 lg:grid-cols-[0.42fr_0.58fr]">
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

                      <div className="rounded-[28px] border border-[var(--lu-border)] bg-white p-8 shadow-lg">
                        <div className="flex items-center justify-between gap-4">
                          <div>
                            <p className="text-xs uppercase tracking-widest text-[var(--lu-subtle)]">Integrante</p>
                            <h2 className="mt-2 text-2xl font-bold text-[var(--lu-text)]">{activeMember.nombre}</h2>
                          </div>
                          <div className="rounded-full border border-[var(--lu-border)] bg-[var(--lu-surface)] px-4 py-2 text-xs font-medium text-[var(--lu-subtle)]">
                            Diagnóstico automático
                          </div>
                        </div>

                        <div className="mt-6 space-y-6 text-sm text-[var(--lu-subtle)]">
                          <div>
                            <p className="mb-1 text-xs uppercase tracking-widest text-[var(--lu-subtle)]">Historia Clínica</p>
                            <div className="flex items-center gap-2 rounded-2xl border border-[var(--lu-border)] bg-[var(--lu-surface)] px-4 py-3">
                              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <path d="M14 2H6a2 2 0 0 0-2 2v16l4-2 4 2 4-2 4 2V8z" />
                                <polyline points="14 2 14 8 20 8" />
                              </svg>
                              <span className="truncate font-medium">{activeMember.historiaClinica}</span>
                            </div>
                          </div>

                          <div>
                            <p className="mb-2 text-xs uppercase tracking-widest text-[var(--lu-subtle)]">Síntomas reportados</p>
                            <div className="space-y-3">
                              <ul className="flex flex-wrap gap-2">
                                {activeMember.sintomas.map((symptom) => (
                                  <li key={symptom.id} className="flex items-center gap-2 rounded-full border border-[var(--lu-border)] bg-[var(--lu-surface)] px-3 py-1 text-xs text-[var(--lu-text)]">
                                    <span className="font-semibold">{symptom.label}</span>
                                    {symptom.codigo && <span className="text-[10px] text-[var(--lu-subtle)]">{symptom.codigo}</span>}
                                    <button
                                      type="button"
                                      className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-[var(--lu-border)] text-[10px] text-[var(--lu-subtle)] hover:text-[var(--lu-accent)] hover:border-[var(--lu-accent)] transition-colors"
                                      onClick={() => handleRemoveSymptom(activeMember.id, symptom.id)}
                                      aria-label={`Eliminar ${symptom.label}`}
                                    >
                                      ×
                                    </button>
                                  </li>
                                ))}
                              </ul>
                              <div className="grid gap-3 md:grid-cols-[2fr_1fr_auto]">
                                <input
                                  type="text"
                                  placeholder="Descripción"
                                  value={newSymptom[activeMember.id]?.label ?? ""}
                                  onChange={(e) => handleDraftChange(activeMember.id, "label", e.target.value)}
                                  className="rounded-xl border border-[var(--lu-border)] bg-[var(--lu-surface)] px-4 py-2 text-[var(--lu-text)] focus:border-[var(--lu-accent)] focus:outline-none focus:ring-1 focus:ring-[var(--lu-accent)]"
                                />
                                <input
                                  type="text"
                                  placeholder="Código HPO (HP:0001027)"
                                  value={newSymptom[activeMember.id]?.code ?? ""}
                                  onChange={(e) => handleDraftChange(activeMember.id, "code", e.target.value)}
                                  className="rounded-xl border border-[var(--lu-border)] bg-[var(--lu-surface)] px-4 py-2 text-[var(--lu-text)] focus:border-[var(--lu-accent)] focus:outline-none focus:ring-1 focus:ring-[var(--lu-accent)]"
                                />
                                <button
                                  type="button"
                                  className="inline-flex items-center justify-center h-10 px-4 rounded-xl border border-[var(--lu-accent)] text-[var(--lu-accent)] font-medium hover:bg-[var(--lu-accent)] hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                  onClick={() => handleAddSymptom(activeMember.id)}
                                  disabled={!newSymptom[activeMember.id]?.label.trim() || !newSymptom[activeMember.id]?.code.trim()}
                                >
                                  Agregar
                                </button>
                              </div>
                            </div>
                          </div>

                          <div>
                            <p className="mb-2 text-xs uppercase tracking-widest text-[var(--lu-subtle)]">Orientación diagnóstica</p>
                            <p className="rounded-2xl border border-[var(--lu-border)] bg-[var(--lu-surface)] p-4 text-sm leading-relaxed text-[var(--lu-text)]">
                              {activeMember.diagnostico}
                            </p>
                            <div className="mt-4 flex flex-wrap gap-3">
                              <button type="button" className="inline-flex items-center justify-center h-10 px-4 rounded-xl border border-[var(--lu-accent)] text-[var(--lu-accent)] font-medium hover:bg-[var(--lu-accent)] hover:text-white transition-colors" onClick={jumpToSymptomStep}>
                                Regenerar diagnóstico
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
