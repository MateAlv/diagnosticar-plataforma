"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../../lib/auth-context";

type Step = 1 | 2 | 3 | 4;

type Symptom = {
  description: string;
  code: string;
  confidence?: number;
};

type GenPhenResult = {
  gene_id: string;
  gene_symbol: string;
  score: number;
  matched_hpo_ids: string[];
  matched_count: number;
  input_count: number;
  coverage: number;
  precision: number;
};

type SpecialtyRow = {
  specialty: string;
  matched_genes_count: number;
  probability_mass: number;
  genes: string[];
  fraction_of_selected_genes: number;
};

type GenPhenSpecialties = {
  top_specialty: string | null;
  top_specialties: string[];
  specialty_ranking: SpecialtyRow[];
  selected_gene_count: number;
  unmapped_genes: string[];
  unmapped_gene_count: number;
};

type HpoSuggestion = {
  hpo_id: string;
  label_es: string;
  label_en?: string;
};

type PhenotypeItem = {
  hpo_id: string;
  label: string;
  label_es: string | null;
  span_es: string;
  span_en: string;
  start_es: number;
  end_es: number;
  start_en: number;
  end_en: number;
  negated: boolean;
  confidence: number;
  matched_by: string;
};

type RegenerationDraft = {
  mode?: "regenerate";
  patientId?: string;
  sourceDiagnosisId?: string;
  nombre?: string;
  fechaNacimiento?: string | null;
  sexo?: string | null;
  localidad?: string | null;
  pais?: string | null;
  historiaClinica?: string;
  sintomas?: Array<{ description?: string; code?: string }>;
};

const stepsMeta: Array<{ id: Step; title: string }> = [
  { id: 1, title: "Datos básicos" },
  { id: 2, title: "Historia Clínica" },
  { id: 3, title: "Síntomas" },
  { id: 4, title: "Diagnóstico Final" },
];

const defaultSymptoms: Symptom[] = [
  { description: "Fatiga persistente", code: "HP:0012378" },
  { description: "Dolor abdominal", code: "HP:0002027" },
  { description: "Cambios en peso", code: "HP:0004324" },
];

const HPO_API_URL = process.env.NEXT_PUBLIC_HPO_API_URL || "http://localhost:8000";
const HPO_EXTRACT_ENDPOINT = `${HPO_API_URL.replace(/\/$/, "")}/extract-hpo`;
const HPO_SEARCH_ENDPOINT = `${HPO_API_URL.replace(/\/$/, "")}/hpo/es/search`;
const GENPHENAI_API_URL = process.env.NEXT_PUBLIC_GENPHENAI_URL || "http://localhost:18020";
const GENPHENAI_ENDPOINT = `${GENPHENAI_API_URL.replace(/\/$/, "")}/rank-genes`;
const BACKEND_API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api";
const GENPHENAI_LOW_CONFIDENCE_THRESHOLD = 0.4;
const DEMO_BLURRED_GENE_PLACEHOLDERS = 4;

function getCookieValue(name: string): string | null {
  if (typeof document === "undefined") return null;
  const escaped = name.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
  const match = document.cookie.match(new RegExp(`(?:^|; )${escaped}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

const countries = [
  "Afganistán",
  "Albania",
  "Alemania",
  "Andorra",
  "Angola",
  "Antigua y Barbuda",
  "Arabia Saudita",
  "Argelia",
  "Argentina",
  "Armenia",
  "Australia",
  "Austria",
  "Azerbaiyán",
  "Bahamas",
  "Bangladés",
  "Barbados",
  "Baréin",
  "Bélgica",
  "Belice",
  "Benín",
  "Bielorrusia",
  "Birmania",
  "Bolivia",
  "Bosnia y Herzegovina",
  "Botsuana",
  "Brasil",
  "Brunéi",
  "Bulgaria",
  "Burkina Faso",
  "Burundi",
  "Bután",
  "Cabo Verde",
  "Camboya",
  "Camerún",
  "Canadá",
  "Catar",
  "Chad",
  "Chile",
  "China",
  "Chipre",
  "Colombia",
  "Comoras",
  "Corea del Norte",
  "Corea del Sur",
  "Costa de Marfil",
  "Costa Rica",
  "Croacia",
  "Cuba",
  "Dinamarca",
  "Dominica",
  "Ecuador",
  "Egipto",
  "El Salvador",
  "Emiratos Árabes Unidos",
  "Eritrea",
  "Eslovaquia",
  "Eslovenia",
  "España",
  "Estados Unidos",
  "Estonia",
  "Etiopía",
  "Filipinas",
  "Finlandia",
  "Fiyi",
  "Francia",
  "Gabón",
  "Gambia",
  "Georgia",
  "Ghana",
  "Granada",
  "Grecia",
  "Guatemala",
  "Guinea",
  "Guinea-Bisáu",
  "Guinea Ecuatorial",
  "Guyana",
  "Haití",
  "Honduras",
  "Hungría",
  "India",
  "Indonesia",
  "Irak",
  "Irán",
  "Irlanda",
  "Islandia",
  "Islas Marshall",
  "Islas Salomón",
  "Israel",
  "Italia",
  "Jamaica",
  "Japón",
  "Jordania",
  "Kazajistán",
  "Kenia",
  "Kirguistán",
  "Kiribati",
  "Kuwait",
  "Laos",
  "Lesoto",
  "Letonia",
  "Líbano",
  "Liberia",
  "Libia",
  "Liechtenstein",
  "Lituania",
  "Luxemburgo",
  "Macedonia del Norte",
  "Madagascar",
  "Malasia",
  "Malaui",
  "Maldivas",
  "Malí",
  "Malta",
  "Marruecos",
  "Mauricio",
  "Mauritania",
  "México",
  "Micronesia",
  "Moldavia",
  "Mónaco",
  "Mongolia",
  "Montenegro",
  "Mozambique",
  "Namibia",
  "Nauru",
  "Nepal",
  "Nicaragua",
  "Níger",
  "Nigeria",
  "Noruega",
  "Nueva Zelanda",
  "Omán",
  "Países Bajos",
  "Pakistán",
  "Palaos",
  "Panamá",
  "Papúa Nueva Guinea",
  "Paraguay",
  "Perú",
  "Polonia",
  "Portugal",
  "Reino Unido",
  "República Centroafricana",
  "República Checa",
  "República del Congo",
  "República Democrática del Congo",
  "República Dominicana",
  "Ruanda",
  "Rumania",
  "Rusia",
  "Samoa",
  "San Cristóbal y Nieves",
  "San Marino",
  "San Vicente y las Granadinas",
  "Santa Lucía",
  "Santo Tomé y Príncipe",
  "Senegal",
  "Serbia",
  "Seychelles",
  "Sierra Leona",
  "Singapur",
  "Siria",
  "Somalia",
  "Sri Lanka",
  "Suazilandia",
  "Sudáfrica",
  "Sudán",
  "Sudán del Sur",
  "Suecia",
  "Suiza",
  "Surinam",
  "Tailandia",
  "Tanzania",
  "Tayikistán",
  "Timor Oriental",
  "Togo",
  "Tonga",
  "Trinidad y Tobago",
  "Túnez",
  "Turkmenistán",
  "Turquía",
  "Tuvalu",
  "Ucrania",
  "Uganda",
  "Uruguay",
  "Uzbekistán",
  "Vanuatu",
  "Vaticano",
  "Venezuela",
  "Vietnam",
  "Yemen",
  "Yibuti",
  "Zambia",
  "Zimbabue",
];

function NuevoDiagnosticoScreen() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, logout, loading: authLoading } = useAuth();
  const isDemoMode = searchParams.get("demo") === "1";
  const [step, setStep] = useState<Step>(isDemoMode ? 2 : 1);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState("");
  const [showCancelModal, setShowCancelModal] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const [datosBasicos, setDatosBasicos] = useState({
    nombre: "",
    fechaNacimiento: "",
    sexo: "",
    localidad: "",
    pais: "",
  });

  const HC_DRAFT_KEY = "diagnosticar:hc-draft";
  const [historiaClinica, setHistoriaClinica] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem(HC_DRAFT_KEY) ?? "";
    }
    return "";
  });
  const [symptoms, setSymptoms] = useState<Symptom[]>([]);
  const [lastAnalyzedHC, setLastAnalyzedHC] = useState("");
  const [newSymptom, setNewSymptom] = useState({ description: "", code: "" });
  const [extractError, setExtractError] = useState<string | null>(null);
  const [genphenResults, setGenphenResults] = useState<GenPhenResult[]>([]);
  const [genphenSpecialties, setGenphenSpecialties] = useState<GenPhenSpecialties | null>(null);
  const [genphenConfidence, setGenphenConfidence] = useState<number | null>(null);
  const [genphenError, setGenphenError] = useState<string | null>(null);
  const [extractedPhenotypes, setExtractedPhenotypes] = useState<PhenotypeItem[]>([]);
  const [saveWarning, setSaveWarning] = useState(false);
  const [regenerationPatientId, setRegenerationPatientId] = useState<string | null>(null);
  const [hpoSuggestions, setHpoSuggestions] = useState<HpoSuggestion[]>([]);
  const [hpoSuggestOpen, setHpoSuggestOpen] = useState(false);
  const [hpoSuggestLoading, setHpoSuggestLoading] = useState(false);

  const canGoStep1 = useMemo(() => {
    return (
      datosBasicos.nombre.trim() !== "" &&
      datosBasicos.fechaNacimiento.trim() !== "" &&
      datosBasicos.sexo.trim() !== "" &&
      datosBasicos.localidad.trim() !== "" &&
      datosBasicos.pais.trim() !== ""
    );
  }, [datosBasicos]);

  const canGoStep2 = historiaClinica.trim().length > 12;
  const canGoStep3 = symptoms.length > 0;
  const isLowConfidenceResult =
    genphenConfidence !== null && genphenConfidence < GENPHENAI_LOW_CONFIDENCE_THRESHOLD;
  const topSpecialtiesDisplayed = (genphenSpecialties?.top_specialties ?? []).slice(0, 3);
  const visibleGeneResults = genphenResults;
  const demoPrimaryGene = isDemoMode ? genphenResults[0] : null;
  const demoBlurredGeneRows =
    isDemoMode && genphenResults.length > 0 ? DEMO_BLURRED_GENE_PLACEHOLDERS : 0;

  useEffect(() => {
    if (!isDemoMode && !authLoading && !user) {
      router.replace("/login");
    }
  }, [isDemoMode, authLoading, user, router]);

  // Persist draft HC text so navigating away doesn't lose work
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (historiaClinica.trim()) {
      localStorage.setItem(HC_DRAFT_KEY, historiaClinica);
    } else {
      localStorage.removeItem(HC_DRAFT_KEY);
    }
  }, [historiaClinica]);

  useEffect(() => {
    if (isDemoMode && step === 1) {
      setStep(2);
    }
  }, [isDemoMode, step]);

  useEffect(() => {
    const targetStep = searchParams.get("step");
    if (targetStep === "3") {
      setStep(3);
      if (typeof window !== "undefined") {
        const stored = window.sessionStorage.getItem("diagnosticar:newDiagDraft");
        if (stored) {
          try {
            const parsed = JSON.parse(stored) as RegenerationDraft;
            const isRegenerateDraft = parsed?.mode === "regenerate" && typeof parsed?.patientId === "string";
            setRegenerationPatientId(isRegenerateDraft ? parsed.patientId ?? null : null);

            const parsedSymptoms = Array.isArray(parsed?.sintomas)
              ? parsed.sintomas
                  .map((item) => {
                    const code = typeof item?.code === "string" ? item.code.trim().toUpperCase() : "";
                    const description =
                      typeof item?.description === "string" && item.description.trim()
                        ? item.description.trim()
                        : code;
                    if (!description) return null;
                    return { description, code };
                  })
                  .filter((item): item is Symptom => item !== null)
              : [];

            if (parsedSymptoms.length > 0) {
              setSymptoms(parsedSymptoms);
            } else {
              setSymptoms(defaultSymptoms.map((symptom) => ({ ...symptom })));
            }

            setDatosBasicos((prev) => ({
              ...prev,
              nombre:
                typeof parsed?.nombre === "string" && parsed.nombre.trim()
                  ? parsed.nombre.trim()
                  : prev.nombre,
              fechaNacimiento:
                typeof parsed?.fechaNacimiento === "string" ? parsed.fechaNacimiento : prev.fechaNacimiento,
              sexo: typeof parsed?.sexo === "string" ? parsed.sexo : prev.sexo,
              localidad: typeof parsed?.localidad === "string" ? parsed.localidad : prev.localidad,
              pais: typeof parsed?.pais === "string" ? parsed.pais : prev.pais,
            }));

            if (typeof parsed?.historiaClinica === "string" && parsed.historiaClinica.trim()) {
              setHistoriaClinica(parsed.historiaClinica);
            }
          } catch {
            setRegenerationPatientId(null);
            setSymptoms(defaultSymptoms.map((symptom) => ({ ...symptom })));
          }
          window.sessionStorage.removeItem("diagnosticar:newDiagDraft");
        } else {
          setRegenerationPatientId(null);
          setSymptoms(defaultSymptoms.map((symptom) => ({ ...symptom })));
        }
      }
    }
  }, [searchParams]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const query = newSymptom.description.trim();
    if (query.length < 2) {
      setHpoSuggestions([]);
      setHpoSuggestOpen(false);
      setHpoSuggestLoading(false);
      return;
    }
    const controller = new AbortController();
    setHpoSuggestLoading(true);
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(
          `${HPO_SEARCH_ENDPOINT}?q=${encodeURIComponent(query)}&limit=20`,
          { signal: controller.signal }
        );
        const payload = await response.json().catch(() => ({}));
        const results = Array.isArray(payload?.results) ? payload.results : [];
        if (!controller.signal.aborted) {
          setHpoSuggestions(results);
          setHpoSuggestOpen(true);
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setHpoSuggestions([]);
          setHpoSuggestOpen(false);
        }
      } finally {
        if (!controller.signal.aborted) {
          setHpoSuggestLoading(false);
        }
      }
    }, 220);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [newSymptom.description]);

  const handleContinue = async () => {
    if (step === 1) {
      setStep(2);
      return;
    }

    if (step === 2) {
      // Volver al paso 2 y avanzar sin editar el texto no debe pisar los síntomas editados a mano
      if (historiaClinica.trim() === lastAnalyzedHC && symptoms.length > 0) {
        setStep(3);
        return;
      }
      setIsLoading(true);
      setLoadingMessage("Analizando historia clínica...");
      setExtractError(null);
      try {
        const response = await fetch(HPO_EXTRACT_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text_es: historiaClinica.trim(),
            patient_locale: "es-AR",
          }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          const detail = payload?.detail || payload?.error || "No pudimos analizar el texto.";
          throw new Error(detail);
        }
        const phenotypes = Array.isArray(payload?.phenotypes) ? payload.phenotypes : [];
        setExtractedPhenotypes(phenotypes);
        const byId = new Map<string, Symptom>();
        for (const phenotype of phenotypes) {
          const hpoId = typeof phenotype?.hpo_id === "string" ? phenotype.hpo_id : "";
          if (!hpoId) continue;
          if (phenotype?.negated) continue;
          // Prefer official HPO Spanish label over extracted span
          const rawLabel = typeof phenotype?.label_es === "string" && phenotype.label_es.trim()
            ? phenotype.label_es.trim()
            : typeof phenotype?.span_es === "string" && phenotype.span_es.trim()
              ? phenotype.span_es.trim()
              : typeof phenotype?.label === "string" && phenotype.label.trim()
                ? phenotype.label.trim()
                : typeof phenotype?.span_en === "string" && phenotype.span_en.trim()
                  ? phenotype.span_en.trim()
                  : hpoId;
          const confidence = typeof phenotype?.confidence === "number" ? phenotype.confidence : 0;
          const existing = byId.get(hpoId);
          if (!existing || (existing.confidence ?? 0) < confidence) {
            byId.set(hpoId, {
              description: rawLabel,
              code: hpoId,
              confidence,
            });
          }
        }
        setSymptoms(Array.from(byId.values()).sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0)));
        setLastAnalyzedHC(historiaClinica.trim());
        setStep(3);
      } catch (error) {
        const message =
          error instanceof Error && error.message
            ? error.message
            : "No pudimos analizar la historia clínica. Reintentá en unos segundos.";
        setExtractError(message);
      } finally {
        setIsLoading(false);
        setLoadingMessage("");
      }
      return;
    }

    if (step === 3) {
      setIsLoading(true);
      setLoadingMessage("Consultando a GenPhenAI...");
      setGenphenError(null);
      setGenphenResults([]);
      setGenphenSpecialties(null);
      setGenphenConfidence(null);
      try {
        const hpoIds = symptoms
          .map((symptom) => symptom.code.trim().toUpperCase())
          .filter((code) => /^HP:\d+$/.test(code));
        if (hpoIds.length === 0) {
          setGenphenError("Agregá al menos un código HPO válido para consultar GenPhenIA.");
          return;
        }
        const response = await fetch(GENPHENAI_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ hpo_ids: hpoIds, top_k: isDemoMode ? 1 : 50 }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          const detail = payload?.detail || payload?.error || "No pudimos consultar GenPhenIA.";
          throw new Error(detail);
        }
        const results = Array.isArray(payload?.results) ? payload.results : [];
        setGenphenResults(results);

        // Specialties and confidence come directly from the genphenai response
        if (payload?.specialties) setGenphenSpecialties(payload.specialties);
        if (typeof payload?.confidence === "number") setGenphenConfidence(payload.confidence);

        // Save to backend (authenticated) or localStorage (demo / fallback)
        if (!isDemoMode && user) {
          try {
            const csrfToken = getCookieValue("csrf_token");
            const historiaClinicaToSave =
              historiaClinica.trim() || "Carga manual de síntomas sin historia clínica detallada.";
            const diagnosisPayload = {
              historiaClinica: historiaClinicaToSave,
              symptomsExtracted: symptoms.map((s) => ({ description: s.description, code: s.code })),
              phenotypes: extractedPhenotypes,
              genphenGenes: results,
              genphenSpecialties: payload?.specialties ?? null,
              genphenConfidence: typeof payload?.confidence === "number" ? payload.confidence : null,
            };
            const saveUrl = regenerationPatientId
              ? `${BACKEND_API_URL}/patients/${regenerationPatientId}/diagnoses`
              : `${BACKEND_API_URL}/patients`;
            const saveBody = regenerationPatientId
              ? diagnosisPayload
              : {
                  nombre: datosBasicos.nombre.trim() || "Paciente",
                  fechaNacimiento: datosBasicos.fechaNacimiento || null,
                  sexo: datosBasicos.sexo || null,
                  localidad: datosBasicos.localidad || null,
                  pais: datosBasicos.pais || null,
                  ...diagnosisPayload,
                };

            const saveRes = await fetch(saveUrl, {
              method: "POST",
              credentials: "include",
              headers: {
                "Content-Type": "application/json",
                ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
              },
              body: JSON.stringify(saveBody),
            });
            if (!saveRes.ok) throw new Error(`HTTP ${saveRes.status}`);
            setRegenerationPatientId(null);
          } catch {
            // Backend save failed — fall back to localStorage so data is never lost
            const record = {
              id: Date.now().toString(),
              nombre: datosBasicos.nombre.trim() || "Paciente",
              savedAt: new Date().toISOString(),
              symptoms: symptoms.map((s) => ({ description: s.description, code: s.code })),
              topSpecialties: payload?.specialties?.top_specialties ?? [],
              confidence: typeof payload?.confidence === "number" ? payload.confidence : null,
              topGenes: results.slice(0, 5).map((g: GenPhenResult) => g.gene_symbol),
            };
            const existing = JSON.parse(localStorage.getItem("diagnosticar:records") || "[]");
            localStorage.setItem("diagnosticar:records", JSON.stringify([record, ...existing]));
            setSaveWarning(true);
          }
        }

        localStorage.removeItem(HC_DRAFT_KEY);
        setStep(4);
      } catch (error) {
        const message =
          error instanceof Error && error.message
            ? error.message
            : "No pudimos consultar GenPhenIA. Reintentá en unos segundos.";
        setGenphenError(message);
      } finally {
        setIsLoading(false);
        setLoadingMessage("");
      }
      return;
    }
  };

  const firstStep: Step = isDemoMode ? 2 : 1;

  const handleBack = () => {
    setExtractError(null);
    setGenphenError(null);
    setStep((prev) => (prev > firstStep ? ((prev - 1) as Step) : prev));
  };

  const handleCancelFlow = () => {
    setShowCancelModal(false);
    setRegenerationPatientId(null);
    localStorage.removeItem(HC_DRAFT_KEY);
    router.push(isDemoMode ? "/home" : "/diagnosticar");
  };

  const handleAddSymptom = () => {
    if (!newSymptom.description.trim() || !newSymptom.code.trim()) return;
    setSymptoms((prev) => [
      ...prev,
      {
        description: newSymptom.description.trim(),
        code: newSymptom.code.trim().toUpperCase(),
      },
    ]);
    setNewSymptom({ description: "", code: "" });
  };

  const handlePickSuggestion = (suggestion: HpoSuggestion) => {
    setNewSymptom({ description: suggestion.label_es, code: suggestion.hpo_id });
    setHpoSuggestOpen(false);
    setHpoSuggestions([]);
  };

  const handleRemoveSymptom = (code: string) => {
    setSymptoms((prev) => prev.filter((symptom) => symptom.code !== code));
  };

  const visibleStepsMeta = isDemoMode ? stepsMeta.filter((meta) => meta.id !== 1) : stepsMeta;
  const stepTitle =
    visibleStepsMeta.find((meta) => meta.id === step)?.title ??
    stepsMeta.find((meta) => meta.id === step)?.title ??
    "";
  const displayName = user?.name?.trim() || user?.email;

  const handleLogout = async () => {
    await logout();
    router.replace("/login");
  };

  if (!isDemoMode && authLoading) {
    return (
      <main className="page-root relative min-h-screen flex items-center justify-center bg-[var(--lu-bg)]">
        <div className="text-sm text-[var(--lu-subtle)]">Verificando sesión…</div>
      </main>
    );
  }

  if (!isDemoMode && !user) {
    return null;
  }

  return (
    <main className="page-root relative overflow-hidden">
      {/* Background decoration */}
      <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full diagnostic-hero-bg blur-3xl pointer-events-none animate-breathe" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[40%] h-[40%] rounded-full diagnostic-hero-bg blur-3xl pointer-events-none animate-breathe" style={{ animationDelay: "3s" }} />

      <header className="sticky top-0 z-20 w-full backdrop-blur-md bg-[color-mix(in_oklab,var(--lu-bg)_80%,transparent)] border-b border-[var(--lu-border)]">
        <div className="mx-auto max-w-7xl flex items-center justify-between px-5 py-4">
          <Link href="/home" className="flex items-center" aria-label="Regresar al home">
            <Image
              src="/brand/logo-diagnosticar.svg"
              alt="Diagnostic.ar"
              width={360}
              height={88}
              className="h-16 w-auto"
              priority
            />
          </Link>

          <nav className="flex items-center gap-5">
            <Link href="/home" className="text-sm font-medium text-[var(--lu-subtle)] hover:text-[var(--lu-text)] transition-colors">
              Home
            </Link>
            {isDemoMode ? (
              <>
                <span className="px-3 py-1 rounded-full bg-amber-100 text-amber-700 text-xs font-bold uppercase tracking-wider border border-amber-200">
                  Modo demostración
                </span>
                <Link href="/sign-up" className="text-sm font-medium text-[var(--lu-accent)] hover:underline">
                  Crear cuenta
                </Link>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="inline-flex items-center gap-2 px-4 h-9 text-sm font-medium text-red-500 hover:text-red-700 transition-colors"
                  onClick={() => setShowCancelModal(true)}
                >
                  Cancelar
                </button>
                {displayName && (
                  <>
                    <span className="user-badge truncate">
                      {displayName}
                    </span>
                    <button type="button" onClick={handleLogout} className="nav-link text-sm">
                      Cerrar sesión
                    </button>
                  </>
                )}
              </>
            )}
          </nav>
        </div>
      </header>

      <div className="content-wrap relative z-10">
        <section className="mx-auto max-w-5xl w-full px-5 pt-12 pb-24 flex-1">
          {isDemoMode && (
            <div className="mb-6 rounded-xl bg-blue-50 border border-blue-100 p-4 flex items-start gap-3">
              <div className="text-blue-500 mt-0.5">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" /></svg>
              </div>
              <div className="text-sm text-blue-800">
                <p className="font-semibold">Estás probando Diagnostic.ar sin registrarte.</p>
                <p className="opacity-90">Este modo no guarda datos y muestra resultados limitados. Para ver todo el informe y guardar pacientes, creá una cuenta.</p>
              </div>
            </div>
          )}
          <div className="rounded-[32px] border border-[var(--lu-border)] bg-[var(--lu-surface)] px-8 py-10 shadow-[var(--lu-shadow)] relative">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--lu-border)] pb-8">
              <div className="space-y-2">
                <span className="inline-flex items-center gap-2 text-xs uppercase tracking-widest text-[var(--lu-accent)] font-semibold">
                  <span className="inline-flex h-2 w-2 rounded-full bg-[var(--lu-accent)]" aria-hidden />
                  {isDemoMode ? "Prueba rápida" : "Nuevo diagnóstico"}
                </span>
                <h1 className="text-3xl font-bold text-[var(--lu-text)] leading-tight">{stepTitle}</h1>
              </div>

              <div className="flex items-center gap-3">
                {visibleStepsMeta.map((meta, index) => {
                  const isActive = step === meta.id;
                  const isCompleted = step > meta.id;
                  const stepLabel = isDemoMode ? index + 1 : meta.id;
                  return (
                    <span
                      key={meta.id}
                      className={[
                        "flex h-10 w-10 items-center justify-center rounded-full border text-sm font-bold transition-all duration-200",
                        isActive
                          ? "border-[var(--lu-accent)] bg-[var(--lu-accent)] text-white shadow-md"
                          : isCompleted
                            ? "border-[var(--lu-accent)] bg-white text-[var(--lu-accent)]"
                            : "border-[var(--lu-border)] bg-white text-[var(--lu-subtle)]",
                      ].join(" ")}
                    >
                      {stepLabel}
                    </span>
                  );
                })}
              </div>
            </div>

            <div className="relative pt-8">
              {isLoading && (
                <div className="absolute inset-0 z-10 grid place-items-center rounded-[24px] bg-white/80 backdrop-blur-sm">
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
                      Nombre o apodo del integrante
                      <input
                        type="text"
                        value={datosBasicos.nombre}
                        onChange={(event) => setDatosBasicos((prev) => ({ ...prev, nombre: event.target.value }))}
                        className="mt-2 w-full rounded-xl border border-[var(--lu-border)] bg-white px-4 py-3 text-[var(--lu-text)] focus:border-[var(--lu-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--lu-accent-light)] transition-all"
                        placeholder="Ej. Marcelo, Mamá, Equipo Beta..."
                      />
                    </label>
                  </div>

                  <div className="space-y-5">
                    <label className="block text-sm font-bold text-[var(--lu-text)] mb-2">
                      Fecha de nacimiento
                      <input
                        type="date"
                        value={datosBasicos.fechaNacimiento}
                        onChange={(event) =>
                          setDatosBasicos((prev) => ({ ...prev, fechaNacimiento: event.target.value }))
                        }
                        className="mt-2 w-full rounded-xl border border-[var(--lu-border)] bg-white px-4 py-3 text-[var(--lu-text)] focus:border-[var(--lu-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--lu-accent-light)] transition-all"
                      />
                    </label>
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

                  <div className="space-y-5">
                    <label className="block text-sm font-bold text-[var(--lu-text)] mb-2">
                      Sexo
                      <select
                        value={datosBasicos.sexo}
                        onChange={(event) => setDatosBasicos((prev) => ({ ...prev, sexo: event.target.value }))}
                        className="mt-2 w-full rounded-xl border border-[var(--lu-border)] bg-white px-4 py-3 text-[var(--lu-text)] focus:border-[var(--lu-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--lu-accent-light)] transition-all appearance-none"
                      >
                        <option value="">Seleccioná</option>
                        <option value="femenino">Femenino</option>
                        <option value="masculino">Masculino</option>
                        <option value="no_binario">No binario</option>
                        <option value="prefiero_no_decir">Prefiero no decirlo</option>
                      </select>
                    </label>
                    <label className="block text-sm font-bold text-[var(--lu-text)] mb-2">
                      Localidad
                      <input
                        type="text"
                        value={datosBasicos.localidad}
                        onChange={(event) =>
                          setDatosBasicos((prev) => ({ ...prev, localidad: event.target.value }))
                        }
                        className="mt-2 w-full rounded-xl border border-[var(--lu-border)] bg-white px-4 py-3 text-[var(--lu-text)] focus:border-[var(--lu-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--lu-accent-light)] transition-all"
                        placeholder="Ciudad o localidad"
                      />
                    </label>
                  </div>

                </div>
              )}

              {step === 2 && (
                <div className="space-y-5">
                  <p className="text-sm text-[var(--lu-subtle)]">
                    Pegá o escribí la Historia Clínica relevante. Diagnostic.ar analizará el texto y extraerá los síntomas
                    clave antes de consultar a GenPhenIA.
                  </p>
                  <textarea
                    value={historiaClinica}
                    onChange={(event) => setHistoriaClinica(event.target.value)}
                    rows={12}
                    maxLength={10000}
                    placeholder="Ej. Paciente con historial de dolor abdominal intermitente..."
                    className="w-full rounded-2xl border border-[var(--lu-border)] bg-white px-4 py-3 text-[var(--lu-text)] focus:border-[var(--lu-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--lu-accent-light)] transition-all"
                  />
                  <div className="text-xs text-[var(--lu-subtle)] text-right mt-1">
                    {historiaClinica.length.toLocaleString()} / 10.000 caracteres
                  </div>
                  {extractError && (
                    <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                      {extractError}
                    </div>
                  )}
                </div>
              )}

              {step === 3 && (
                <div className="space-y-6">
                  <div className="space-y-3">
                    <p className="text-sm text-[var(--lu-subtle)]">
                      Editá los síntomas detectados por Diagnostic.ar antes de enviar la consulta a GenPhenIA.
                    </p>
                    {genphenError && (
                      <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                        {genphenError}
                      </div>
                    )}
                    {symptoms.length === 0 && (
                      <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
                        No detectamos síntomas en el texto. Podés agregarlos manualmente.
                      </div>
                    )}
                    <div className="flex flex-wrap gap-3">
                      {symptoms.map((symptom) => (
                        <span
                          key={symptom.code}
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
                            aria-label={`Eliminar ${symptom.description}`}
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-[var(--lu-border)] bg-white p-6 shadow-sm">
                    <h2 className="text-sm font-bold text-[var(--lu-text)]">Agregar síntoma manualmente</h2>
                    <div className="mt-4 grid gap-4 md:grid-cols-[2fr_1fr_auto]">
                      <div className="relative">
                        <input
                          type="text"
                          placeholder="Descripción"
                          value={newSymptom.description}
                          onChange={(event) =>
                            setNewSymptom((prev) => ({ ...prev, description: event.target.value }))
                          }
                          onFocus={() => {
                            if (hpoSuggestions.length > 0) {
                              setHpoSuggestOpen(true);
                            }
                          }}
                          onBlur={() => {
                            setTimeout(() => setHpoSuggestOpen(false), 120);
                          }}
                          className="rounded-xl border border-[var(--lu-border)] bg-white px-4 py-3 text-[var(--lu-text)] focus:border-[var(--lu-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--lu-accent-light)] transition-all w-full"
                        />
                        {hpoSuggestOpen && (
                          <div className="absolute z-20 mt-2 w-full max-h-[72vh] overflow-y-auto rounded-xl border border-[var(--lu-border)] bg-white shadow-lg">
                            {hpoSuggestLoading ? (
                              <div className="px-4 py-3 text-sm text-[var(--lu-subtle)]">Buscando...</div>
                            ) : hpoSuggestions.length === 0 ? (
                              <div className="px-4 py-3 text-sm text-[var(--lu-subtle)]">
                                Sin coincidencias.
                              </div>
                            ) : (
                              <ul className="divide-y divide-[var(--lu-border)]">
                                {hpoSuggestions.map((item) => (
                                  <li key={item.hpo_id}>
                                    <button
                                      type="button"
                                      className="w-full px-4 py-2 text-left hover:bg-[var(--lu-accent-light)] transition-colors"
                                      onMouseDown={(e) => { e.preventDefault(); handlePickSuggestion(item); }}
                                    >
                                      <div className="text-sm font-semibold text-[var(--lu-text)]">{item.label_es}</div>
                                      <div className="text-xs text-[var(--lu-subtle)]">
                                        {item.hpo_id}
                                        {item.label_en ? ` · ${item.label_en}` : ""}
                                      </div>
                                    </button>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        )}
                      </div>
                      <input
                        type="text"
                        placeholder="Código HPO (HP:0001027)"
                        value={newSymptom.code}
                        onChange={(event) => setNewSymptom((prev) => ({ ...prev, code: event.target.value }))}
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

              {step === 4 &&
                (isDemoMode ? (
                  <div className="space-y-6">
                    <div className="flex justify-start">
                      <Link
                        href="/login"
                        className="inline-flex items-center justify-center h-11 px-6 rounded-xl border border-[var(--lu-accent)] text-[var(--lu-accent)] font-medium hover:bg-[var(--lu-accent)] hover:text-white transition-colors"
                      >
                        Iniciar sesión
                      </Link>
                    </div>

                    {genphenError ? (
                      <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                        {genphenError}
                      </div>
                    ) : (
                      <div className="rounded-3xl border border-[var(--lu-border)] bg-white p-8 shadow-sm">
                        <p className="text-xs uppercase tracking-widest text-[var(--lu-subtle)]">Detalle técnico</p>
                        <h3 className="mt-2 text-lg font-semibold text-[var(--lu-text)]">Genes candidatos priorizados</h3>
                        <div className="mt-5 space-y-3">
                          {demoPrimaryGene && (
                            <div className="rounded-2xl border border-[var(--lu-border)] bg-[var(--lu-surface)] p-4">
                              <div className="flex flex-wrap items-center justify-between gap-3">
                                <div className="flex items-center gap-3">
                                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[var(--lu-accent)] text-xs font-bold text-white">
                                    1
                                  </span>
                                  <p className="text-base font-semibold text-[var(--lu-text)]">
                                    {demoPrimaryGene.gene_symbol || demoPrimaryGene.gene_id}
                                  </p>
                                </div>
                                <div className="flex flex-wrap gap-2 text-xs text-[var(--lu-subtle)]">
                                  <span className="rounded-full border border-[var(--lu-border)] bg-white px-2 py-1">
                                    Score {Number(demoPrimaryGene.score).toFixed(3)}
                                  </span>
                                </div>
                              </div>
                            </div>
                          )}

                          {Array.from({ length: demoBlurredGeneRows }).map((_, idx) => (
                          <div
                            key={`demo-locked-gene-${idx}`}
                            className="relative rounded-2xl border border-[var(--lu-border)] bg-[var(--lu-surface)] p-4 pointer-events-none select-none"
                          >
                            <div className="absolute inset-0 z-10 grid place-items-center rounded-2xl bg-white/55 backdrop-blur-[1px]">
                              <span className="rounded-full border border-[var(--lu-border)] bg-white px-3 py-1 text-xs font-semibold text-[var(--lu-subtle)]">
                                Iniciá sesión para ver el ranking completo
                              </span>
                            </div>
                            <div className="blur-sm opacity-70">
                              <div className="flex flex-wrap items-center justify-between gap-3">
                                <div className="flex items-center gap-3">
                                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[var(--lu-accent)] text-xs font-bold text-white">
                                    {idx + 2}
                                  </span>
                                  <p className="text-base font-semibold text-[var(--lu-text)]">GENE_******</p>
                                </div>
                                <div className="flex flex-wrap gap-2 text-xs text-[var(--lu-subtle)]">
                                  <span className="rounded-full border border-[var(--lu-border)] bg-white px-2 py-1">
                                    Score ***
                                  </span>
                                </div>
                              </div>
                              <p className="mt-3 text-xs text-[var(--lu-subtle)]">HPO: HP:*******</p>
                            </div>
                          </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-6">
                    {saveWarning && (
                      <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                        No se pudo guardar en tu cuenta. Los datos quedaron guardados localmente en este dispositivo.
                      </div>
                    )}
                    {/* Main recommendation card */}
                    <div className="rounded-3xl border border-[var(--lu-border)] bg-white p-8 shadow-sm">
                      <div className="flex items-center gap-2 mb-5">
                        <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-700 border border-amber-200">
                          BETA
                        </span>
                        <span className="text-xs uppercase tracking-widest text-[var(--lu-subtle)]">
                          Orientación diagnóstica
                        </span>
                      </div>

                      {genphenError ? (
                        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                          {genphenError}
                        </div>
                      ) : isLowConfidenceResult ? (
                        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-800">
                          <p className="leading-relaxed">
                            Los síntomas provistos no son suficientes para realizar una guía diagnóstica precisa. Intentá cargando más síntomas.
                          </p>
                          <button
                            type="button"
                            className="mt-4 inline-flex items-center justify-center h-10 px-5 rounded-xl border border-amber-300 text-amber-900 font-medium hover:bg-amber-100 transition-colors"
                            onClick={() => setStep(3)}
                          >
                            Volver al paso 3: cargar síntomas
                          </button>
                        </div>
                      ) : genphenSpecialties && topSpecialtiesDisplayed.length > 0 ? (
                        <>
                          <p className="text-base text-[var(--lu-text)] leading-relaxed">
                            En base a los genes probables predichos por nuestro sistema, recomendamos que busque algún especialista de las siguientes áreas:
                          </p>
                          <div className="mt-4 flex flex-wrap gap-2">
                            {topSpecialtiesDisplayed.map((sp) => (
                              <span
                                key={sp}
                                className="rounded-full bg-[var(--lu-accent)] text-white px-4 py-1.5 text-sm font-semibold shadow-sm"
                              >
                                {sp}
                              </span>
                            ))}
                          </div>
                        </>
                      ) : (
                        <p className="text-base text-[var(--lu-subtle)] leading-relaxed">
                          No se pudo determinar una especialidad recomendada para los síntomas ingresados. Consultá con un genetista clínico.
                        </p>
                      )}

                      <div className="mt-6">
                        <button
                          type="button"
                          disabled
                          title="Función en desarrollo"
                          className="inline-flex items-center justify-center gap-2 h-11 px-6 rounded-xl border border-[var(--lu-border)] bg-[var(--lu-surface)] text-[var(--lu-subtle)] font-medium cursor-not-allowed opacity-60"
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            className="h-4 w-4"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={2}
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                            />
                          </svg>
                          Descargar informe PDF — Próximamente
                        </button>
                      </div>
                    </div>

                    {/* Specialty ranking detail */}
                    {!isLowConfidenceResult && genphenSpecialties && genphenSpecialties.specialty_ranking.length > 0 && (
                      <div className="rounded-3xl border border-[var(--lu-border)] bg-white p-8 shadow-sm">
                        <p className="text-xs uppercase tracking-widest text-[var(--lu-subtle)] mb-4">
                          Detalle por especialidad
                        </p>
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm border-collapse">
                            <thead>
                              <tr className="border-b border-[var(--lu-border)] text-left text-xs uppercase tracking-wide text-[var(--lu-subtle)]">
                                <th className="pb-2 pr-6">Especialidad</th>
                                <th className="pb-2 pr-6 text-right">Genes</th>
                                <th className="pb-2">Genes candidatos</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-[var(--lu-border)]">
                              {genphenSpecialties.specialty_ranking.map((row) => (
                                <tr key={row.specialty}>
                                  <td className="py-2 pr-6 font-medium text-[var(--lu-text)]">{row.specialty}</td>
                                  <td className="py-2 pr-6 text-right text-[var(--lu-subtle)]">
                                    {row.matched_genes_count}
                                  </td>
                                  <td className="py-2 text-xs text-[var(--lu-subtle)]">{row.genes.join(", ")}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        {genphenSpecialties.unmapped_genes.length > 0 && (
                          <p className="mt-4 text-xs text-[var(--lu-subtle)]">
                            Genes sin especialidad mapeada: {genphenSpecialties.unmapped_genes.join(", ")}
                          </p>
                        )}
                      </div>
                    )}

                    {/* Gene ranking – technical detail */}
                    {!isLowConfidenceResult && genphenResults.length > 0 && (
                      <div className="rounded-3xl border border-[var(--lu-border)] bg-white p-8 shadow-sm">
                        <p className="text-xs uppercase tracking-widest text-[var(--lu-subtle)]">Detalle técnico</p>
                        <h3 className="mt-2 text-lg font-semibold text-[var(--lu-text)]">Genes candidatos priorizados</h3>
                        <p className="mt-1 text-sm text-[var(--lu-subtle)] leading-relaxed">
                          Ranking computacional a partir de los síntomas HPO. Usarlo como guía inicial junto con el equipo clínico.
                        </p>
                        <div className="mt-5 space-y-3">
                          {visibleGeneResults.map((gene, index) => (
                            <div
                              key={`${gene.gene_id}-${index}`}
                              className="rounded-2xl border border-[var(--lu-border)] bg-[var(--lu-surface)] p-4"
                            >
                              <div className="flex flex-wrap items-center justify-between gap-3">
                                <div className="flex items-center gap-3">
                                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[var(--lu-accent)] text-xs font-bold text-white">
                                    {index + 1}
                                  </span>
                                  <p className="text-base font-semibold text-[var(--lu-text)]">
                                    {gene.gene_symbol || gene.gene_id}
                                  </p>
                                </div>
                                <div className="flex flex-wrap gap-2 text-xs text-[var(--lu-subtle)]">
                                  <span className="rounded-full border border-[var(--lu-border)] bg-white px-2 py-1">
                                    Score {Number(gene.score).toFixed(3)}
                                  </span>
                                  {gene.matched_count > 0 && (
                                    <span className="rounded-full border border-[var(--lu-border)] bg-white px-2 py-1">
                                      Match {gene.matched_count}/{gene.input_count}
                                    </span>
                                  )}
                                </div>
                              </div>
                              {gene.matched_hpo_ids?.length > 0 && (
                                <p className="mt-3 text-xs text-[var(--lu-subtle)]">
                                  HPO: {gene.matched_hpo_ids.join(", ")}
                                </p>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Medical disclaimer */}
                    <div className="rounded-2xl border border-amber-100 bg-amber-50 px-5 py-4">
                      <p className="text-xs text-amber-700 leading-relaxed">
                        Este resultado no constituye un diagnóstico médico. Es una orientación generada por métodos computacionales basada en información genómica y fenotípica. Siempre consultá con un profesional médico calificado.
                      </p>
                    </div>

                    <div className="flex flex-wrap gap-3">
                      <button
                        type="button"
                        className="inline-flex items-center justify-center h-11 px-6 rounded-xl border border-[var(--lu-border)] text-[var(--lu-subtle)] font-medium hover:bg-[var(--lu-surface)] hover:text-[var(--lu-text)] transition-colors"
                        onClick={() => router.push("/diagnosticar")}
                      >
                        Guardar diagnóstico y cerrar
                      </button>
                      <button
                        type="button"
                        className="inline-flex items-center justify-center h-11 px-6 rounded-xl bg-[var(--lu-green)] text-white font-bold hover:bg-[color-mix(in_oklab,var(--lu-green)_90%,#000)] shadow-md transition-all"
                        onClick={() => router.push("/diagnosticar?tab=integrantes")}
                      >
                        Comenzar otro diagnóstico
                      </button>
                    </div>
                  </div>
                ))}
            </div>

            {step < 4 && (
              <div className="mt-10 flex flex-wrap items-center justify-between gap-3">
                {step > firstStep ? (
                  <button
                    type="button"
                    onClick={handleBack}
                    disabled={isLoading}
                    className="inline-flex items-center justify-center h-10 px-5 rounded-xl border border-[var(--lu-border)] text-[var(--lu-subtle)] font-medium hover:bg-[var(--lu-surface)] hover:text-[var(--lu-text)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 16 16"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                      className="mr-2"
                    >
                      <path d="M11 3L5 8l6 5" />
                    </svg>
                    Atrás
                  </button>
                ) : (
                  <span />
                )}

                <div className="flex flex-wrap items-center gap-3">
                  {step === 2 && (
                    <button
                      type="button"
                      onClick={() => {
                        setExtractError(null);
                        setStep(3);
                      }}
                      className="inline-flex items-center justify-center h-10 px-5 rounded-xl border border-[var(--lu-accent)] text-[var(--lu-accent)] font-medium hover:bg-[var(--lu-accent)] hover:text-white transition-colors"
                    >
                      Cargar manualmente
                    </button>
                  )}
                  <button
                    type="button"
                    className="inline-flex items-center justify-center h-11 px-8 rounded-xl bg-[var(--lu-green)] text-white font-bold hover:bg-[color-mix(in_oklab,var(--lu-green)_90%,#000)] shadow-md transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none"
                    onClick={handleContinue}
                    disabled={
                      (step === 1 && !canGoStep1) ||
                      (step === 2 && !canGoStep2) ||
                      (step === 3 && !canGoStep3) ||
                      isLoading
                    }
                  >
                    Continuar
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 16 16"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                      className="ml-2"
                    >
                      <path d="M5 3l6 5-6 5" />
                    </svg>
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>

      {showCancelModal && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 backdrop-blur-sm px-5 animate-in fade-in duration-200">
          <div className="max-w-md w-full rounded-[28px] border border-[var(--lu-border)] bg-white p-8 shadow-2xl">
            <h2 className="text-xl font-bold text-[var(--lu-text)]">¿Seguro que querés cancelar?</h2>
            <p className="mt-3 text-sm text-[var(--lu-subtle)]">
              Vas a borrar lo que ingresaste. Confirmá si deseás salir de este diagnóstico asistido.
            </p>
            <div className="mt-8 flex flex-wrap gap-3 justify-end">
              <button
                type="button"
                className="inline-flex items-center justify-center h-10 px-5 rounded-xl border border-[var(--lu-border)] text-[var(--lu-text)] font-medium hover:bg-[var(--lu-surface)] transition-colors"
                onClick={() => setShowCancelModal(false)}
              >
                Seguir editando
              </button>
              <button
                type="button"
                className="inline-flex items-center justify-center h-10 px-5 rounded-xl bg-red-50 text-red-600 font-medium hover:bg-red-100 transition-colors"
                onClick={handleCancelFlow}
              >
                Sí, cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

export default function NuevoDiagnosticoPage() {
  return (
    <Suspense
      fallback={
        <main className="page-root relative min-h-screen flex items-center justify-center bg-[var(--lu-bg)]">
          <div className="text-sm text-[var(--lu-subtle)]">Preparando Diagnostic.ar…</div>
        </main>
      }
    >
      <NuevoDiagnosticoScreen />
    </Suspense>
  );
}
