"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../../lib/auth-context";
import GuiaCarga from "../../components/ui/GuiaCarga";
import AyudaPopover from "../../components/ui/AyudaPopover";
import { traducirEspecialidad } from "../../lib/especialidades";

type Step = 1 | 2 | 3;

type Symptom = {
  description: string;
  code: string;
  confidence?: number;
  source?: "texto" | "manual";
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
  { id: 2, title: "Síntomas del paciente" },
  { id: 3, title: "Orientación diagnóstica" },
];

const defaultSymptoms: Symptom[] = [
  { description: "Fatiga persistente", code: "HP:0012378" },
  { description: "Dolor abdominal", code: "HP:0002027" },
  { description: "Cambios en peso", code: "HP:0004324" },
];

import { GeneModal } from "./gene-modal";
import { GeneOverviewCard } from "./gene-overview-card";
import { fetchGeneProfiles, type GeneProfile } from "@/lib/genes-api";

const PROFESSIONAL_VIEW_KEY = "diagnosticar:vista-profesional";

/** A symptom carries a real HPO code, or it cannot be compared against a gene. */
const HPO_CODE_RE = /^HP:\d+$/;

type RankedGene = { gene: GenPhenResult; symbol: string; rank: number };
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
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const sintomaInputRef = useRef<HTMLInputElement | null>(null);

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
  const [extractInfo, setExtractInfo] = useState<string | null>(null);
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

  const canGoStep2 = symptoms.length > 0;
  const puedeAnalizarTexto =
    historiaClinica.trim().length > 12 && historiaClinica.trim() !== lastAnalyzedHC;
  const isLowConfidenceResult =
    genphenConfidence !== null && genphenConfidence < GENPHENAI_LOW_CONFIDENCE_THRESHOLD;
  // GenPhenAI returns specialty names in English; the whole product is Spanish.
  const topSpecialtiesDisplayed = (genphenSpecialties?.top_specialties ?? [])
    .slice(0, 3)
    .map(traducirEspecialidad);
  const visibleGeneResults = genphenResults;
  // The words the reader used, keyed by the HPO term they were mapped to. The
  // results screen speaks their language back to them — "convulsiones", not
  // HP:0001250 — which is what makes a claimed match checkable.
  const reportedWords = useMemo(() => {
    // Built from `symptoms`, the confirmed list the model ranked on — not from
    // `extractedPhenotypes`, which only exists after a text analysis and is
    // empty for symptoms added by hand or restored from a draft.
    //
    // Where the extractor did run, its `span_es` is what the person actually
    // typed ("convulsiones"), which reads better back to them than the official
    // HPO label. So it wins when present, and the confirmed description is the
    // fallback.
    const spans = new Map<string, string>();
    for (const phenotype of extractedPhenotypes) {
      if (phenotype.negated) continue;
      const span = (phenotype.span_es || "").trim();
      if (span) spans.set(phenotype.hpo_id.toUpperCase(), span);
    }

    const words = new Map<string, string>();
    for (const symptom of symptoms) {
      const code = (symptom.code || "").trim().toUpperCase();
      if (!HPO_CODE_RE.test(code)) continue;
      const said = spans.get(code) || (symptom.description || "").trim();
      if (said) words.set(code, said);
    }
    return words;
  }, [symptoms, extractedPhenotypes]);
  const [geneProfiles, setGeneProfiles] = useState<Map<string, GeneProfile>>(new Map());
  const [professionalView, setProfessionalView] = useState(false);

  /** The gene open in the detail modal, or null with the grid alone on screen. */
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);

  /**
   * The ranking in the model's own order.
   *
   * Grouping by symptom overlap was tried and dropped: it buried the
   * top-scoring genes below a fold, and it made "no overlap" read as an
   * apology for a result that is not actually a failure. Every row already
   * carries its own overlap, so the ordering does not need to repeat it.
   */
  const orderedGenes = useMemo<RankedGene[]>(
    () =>
      visibleGeneResults.map((gene, index) => ({
        gene,
        symbol: gene.gene_symbol || gene.gene_id,
        rank: index + 1,
      })),
    [visibleGeneResults],
  );

  const modalEntries = useMemo(
    () => orderedGenes.map(({ gene, symbol, rank }) => ({ symbol, rank, score: Number(gene.score) })),
    [orderedGenes],
  );

  const demoPrimaryGene = isDemoMode ? genphenResults[0] : null;

  // The professional view is a display preference, not a permission: everything
  // it reveals is public reference data. It defaults off, because a clinician
  // seeing the plain view knows to turn it on, while a family dropped into the
  // technical one does not know what it is looking at.
  useEffect(() => {
    try {
      setProfessionalView(window.localStorage.getItem(PROFESSIONAL_VIEW_KEY) === "1");
    } catch {
      // Private browsing or blocked storage: the default is correct anyway.
    }
  }, []);

  // Descriptions enrich the ranking and never gate it, so a failure here leaves
  // the genes on screen with their symbols and no prose.
  useEffect(() => {
    const symbols = visibleGeneResults
      .map((gene) => gene.gene_symbol || gene.gene_id)
      .filter((symbol): symbol is string => Boolean(symbol));

    if (symbols.length === 0 || isDemoMode) {
      setGeneProfiles(new Map());
      return;
    }

    const controller = new AbortController();
    // `symptoms` is the confirmed list — what the user reviewed and what the
    // model ranked on. `extractedPhenotypes` only holds the raw output of a
    // text analysis, so it is empty whenever symptoms were added by hand,
    // edited, or restored from a draft, and comparing against it reported no
    // overlap for every gene.
    const reported = [...reportedWords.keys()];

    fetchGeneProfiles(symbols, reported, {
      professional: professionalView,
      signal: controller.signal,
    }).then(setGeneProfiles);

    return () => controller.abort();
  }, [visibleGeneResults, reportedWords, professionalView, isDemoMode]);

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
    if (targetStep === "3" || targetStep === "2") {
      setStep(2);
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

  const extraerSintomasDelTexto = async () => {
    const texto = historiaClinica.trim();
    if (!texto) return;
    setIsLoading(true);
    setLoadingMessage("Buscando síntomas en el texto...");
    setExtractError(null);
    setExtractInfo(null);
    try {
      const response = await fetch(HPO_EXTRACT_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // The access_token cookie is httpOnly, so it cannot be read here and
        // put in a header. In staging and production the gateway is the same
        // origin as the backend (/hpo-api beside /api) and the cookie's path
        // is "/", so the browser attaches it once credentials are included.
        credentials: "include",
        body: JSON.stringify({ text_es: texto, patient_locale: "es-AR" }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 401) {
          throw new Error("Tu sesión expiró. Volvé a iniciar sesión para analizar el texto.");
        }
        if (response.status === 429) {
          throw new Error("Hiciste muchas consultas seguidas. Esperá un momento y volvé a intentar.");
        }
        if (response.status === 503) {
          throw new Error("El servicio está ocupado en este momento. Probá de nuevo en unos segundos.");
        }
        const detail = payload?.detail || payload?.error || "No pudimos analizar el texto.";
        throw new Error(detail);
      }
      const phenotypes = Array.isArray(payload?.phenotypes) ? payload.phenotypes : [];
      setExtractedPhenotypes((prev) => {
        const seen = new Set(prev.map((item) => item.hpo_id));
        return [...prev, ...phenotypes.filter((item: PhenotypeItem) => !seen.has(item?.hpo_id))];
      });

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
          byId.set(hpoId, { description: rawLabel, code: hpoId, confidence, source: "texto" });
        }
      }

      const detectados = Array.from(byId.values()).sort(
        (a, b) => (b.confidence ?? 0) - (a.confidence ?? 0)
      );

      let agregados = 0;
      setSymptoms((prev) => {
        const existentes = new Set(prev.map((item) => item.code.trim().toUpperCase()));
        const nuevos = detectados.filter((item) => !existentes.has(item.code.trim().toUpperCase()));
        agregados = nuevos.length;
        return [...prev, ...nuevos];
      });

      setLastAnalyzedHC(texto);
      setExtractInfo(
        agregados > 0
          ? `Agregamos ${agregados} ${agregados === 1 ? "síntoma" : "síntomas"} a la lista.`
          : detectados.length > 0
            ? "Los síntomas detectados ya estaban en la lista."
            : "No encontramos síntomas en el texto. Podés agregarlos buscándolos abajo."
      );
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : "No pudimos analizar el texto. Reintentá en unos segundos.";
      setExtractError(message);
    } finally {
      setIsLoading(false);
      setLoadingMessage("");
    }
  };

  const consultarGenPhen = async () => {
    setShowConfirmModal(false);
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
      setStep(3);
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
  };

  const handleContinue = async () => {
    if (step === 1) {
      setStep(2);
      return;
    }
    if (step === 2) {
      setShowConfirmModal(true);
    }
  };

  const firstStep: Step = isDemoMode ? 2 : 1;

  const maxReachableStep: Step = genphenResults.length > 0 ? 3 : symptoms.length > 0 ? 2 : firstStep;

  const irAlPaso = (destino: Step) => {
    if (destino < firstStep || destino > maxReachableStep || destino === step) return;
    setExtractError(null);
    setGenphenError(null);
    setStep(destino);
  };

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

  const handlePickSuggestion = (suggestion: HpoSuggestion) => {
    const code = suggestion.hpo_id.trim().toUpperCase();
    setSymptoms((prev) =>
      prev.some((symptom) => symptom.code.trim().toUpperCase() === code)
        ? prev
        : [...prev, { description: suggestion.label_es, code, source: "manual" }]
    );
    setNewSymptom({ description: "", code: "" });
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
        <section className="mx-auto max-w-[1400px] w-full px-6 lg:px-10 pt-12 pb-24 flex-1">
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
          <div className="rounded-[32px] border border-[var(--lu-border)] bg-[var(--lu-surface)] px-8 py-10 lg:px-12 lg:py-12 shadow-[var(--lu-shadow)] relative">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--lu-border)] pb-8">
              <div className="space-y-2">
                <span className="inline-flex items-center gap-2 text-xs uppercase tracking-widest text-[var(--lu-accent)] font-semibold">
                  <span className="dot-pulse inline-flex h-2 w-2 shrink-0 rounded-full bg-current text-[var(--lu-accent)]" aria-hidden />
                  {isDemoMode ? "Prueba rápida" : "Nuevo diagnóstico"}
                </span>
                <h1 className="text-3xl font-bold text-[var(--lu-text)] leading-tight">{stepTitle}</h1>
              </div>

              <div className="flex items-center gap-3">
                {visibleStepsMeta.map((meta, index) => {
                  const isActive = step === meta.id;
                  const isCompleted = step > meta.id;
                  const stepLabel = isDemoMode ? index + 1 : meta.id;
                  const habilitado = meta.id <= maxReachableStep && meta.id >= firstStep;
                  return (
                    <button
                      key={meta.id}
                      type="button"
                      onClick={() => irAlPaso(meta.id)}
                      disabled={!habilitado || isActive}
                      aria-current={isActive ? "step" : undefined}
                      title={habilitado ? `Ir a ${meta.title}` : undefined}
                      className={[
                        "flex h-11 w-11 items-center justify-center rounded-full border text-base font-bold transition-all duration-200",
                        isActive
                          ? "border-[var(--lu-accent)] bg-[var(--lu-accent)] text-white shadow-md"
                          : isCompleted
                            ? "border-[var(--lu-accent)] bg-white text-[var(--lu-accent)]"
                            : "border-[var(--lu-border)] bg-white text-[var(--lu-subtle)]",
                        habilitado && !isActive
                          ? "cursor-pointer hover:border-[var(--lu-accent)] hover:bg-[var(--lu-accent-light)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lu-accent)]"
                          : "cursor-default",
                      ].join(" ")}
                    >
                      {stepLabel}
                    </button>
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
                <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start">
                  {/* Columna izquierda: texto libre */}
                  <div className="space-y-4">
                    <div className="rounded-2xl border border-[var(--lu-border)] bg-white p-5 shadow-sm">
                      <div className="flex items-start justify-between gap-3">
                        <h2 className="text-lg font-bold text-[var(--lu-text)]">
                          Pegá o escribí el relato clínico
                        </h2>
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-[var(--lu-subtle)]">Opcional</span>
                          <AyudaPopover etiqueta="¿Qué escribo acá?" align="right">
                            <GuiaCarga variant="historia" />
                          </AyudaPopover>
                        </div>
                      </div>
                      <p className="mt-2 text-base leading-relaxed text-[var(--lu-subtle)]">
                        Buscamos los síntomas en el texto y los sumamos a la lista. Podés analizar
                        varias veces: siempre agregamos, nunca borramos lo que ya cargaste.
                      </p>
                      <textarea
                        value={historiaClinica}
                        onChange={(event) => setHistoriaClinica(event.target.value)}
                        rows={11}
                        maxLength={10000}
                        placeholder="Ej. Nena de 7 años. Desde los 2 años tiene tos productiva casi todos los días, con sibilancias y cuadros respiratorios a repetición. Se cansa más que otros chicos al correr. En el último control pesaba menos de lo esperado para su edad."
                        className="mt-4 w-full rounded-xl border border-[var(--lu-border)] bg-white px-4 py-3.5 text-base leading-relaxed text-[var(--lu-text)] focus:border-[var(--lu-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--lu-accent-light)] transition-all"
                      />
                      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
                        <span className="text-xs text-[var(--lu-subtle)]">
                          {historiaClinica.length.toLocaleString()} / 10.000
                        </span>
                        <button
                          type="button"
                          onClick={extraerSintomasDelTexto}
                          disabled={!puedeAnalizarTexto || isLoading}
                          className="inline-flex items-center gap-2 h-10 px-5 rounded-xl bg-[var(--lu-accent)] text-white text-sm font-semibold hover:bg-[color-mix(in_oklab,var(--lu-accent)_88%,#000)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                            <circle cx="11" cy="11" r="7" />
                            <path d="M21 21l-4.3-4.3" />
                          </svg>
                          {lastAnalyzedHC ? "Analizar de nuevo" : "Buscar síntomas en el texto"}
                        </button>
                      </div>
                      {extractError && (
                        <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-xs text-red-700">
                          {extractError}
                        </div>
                      )}
                      {extractInfo && !extractError && (
                        <div className="mt-3 rounded-xl border border-[var(--lu-border)] bg-[var(--lu-surface)] px-4 py-2.5 text-xs text-[var(--lu-subtle)]">
                          {extractInfo}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Columna derecha: lista viva de síntomas */}
                  <div className="space-y-4">
                    <div className="rounded-2xl border border-[var(--lu-border)] bg-white p-5 shadow-sm">
                      <div className="flex items-start justify-between gap-3">
                        <h2 className="text-lg font-bold text-[var(--lu-text)]">
                          Síntomas del paciente
                        </h2>
                        <div className="flex items-center gap-2">
                          <AyudaPopover etiqueta="¿Qué es un término HPO?" align="right">
                            <GuiaCarga variant="sintomas" />
                          </AyudaPopover>
                          <span className="rounded-full bg-[var(--lu-accent-light)] px-3 py-1 text-sm font-bold text-[var(--lu-accent)]">
                            {symptoms.length}
                          </span>
                        </div>
                      </div>
                      <p className="mt-2 text-base leading-relaxed text-[var(--lu-subtle)]">
                        Buscá cada síntoma y elegilo de la lista. Con estos términos vamos a buscar
                        los genes candidatos.
                      </p>

                      <div className="relative mt-3">
                        <input
                          ref={sintomaInputRef}
                          type="text"
                          placeholder="Escribí un síntoma y elegí de la lista"
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
                          className="w-full rounded-xl border border-[var(--lu-border)] bg-white px-4 py-3.5 text-base text-[var(--lu-text)] focus:border-[var(--lu-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--lu-accent-light)] transition-all"
                        />
                        {hpoSuggestOpen && (
                          <div className="absolute z-20 mt-2 w-full max-h-[52vh] overflow-y-auto rounded-xl border border-[var(--lu-border)] bg-white shadow-lg">
                            {hpoSuggestLoading ? (
                              <div className="px-4 py-3 text-sm text-[var(--lu-subtle)]">Buscando...</div>
                            ) : hpoSuggestions.length === 0 ? (
                              <div className="px-4 py-3 text-sm text-[var(--lu-subtle)]">
                                Sin coincidencias.
                              </div>
                            ) : (
                              <ul className="divide-y divide-[var(--lu-border)]">
                                {hpoSuggestions.map((item) => {
                                  const yaEsta = symptoms.some(
                                    (symptom) => symptom.code.trim().toUpperCase() === item.hpo_id.toUpperCase()
                                  );
                                  return (
                                    <li key={item.hpo_id}>
                                      <button
                                        type="button"
                                        disabled={yaEsta}
                                        className="flex w-full items-center justify-between gap-3 px-4 py-2 text-left transition-colors hover:bg-[var(--lu-accent-light)] disabled:cursor-default disabled:opacity-55 disabled:hover:bg-transparent"
                                        onMouseDown={(e) => { e.preventDefault(); handlePickSuggestion(item); }}
                                      >
                                        <span className="min-w-0">
                                          <span className="block text-sm font-semibold text-[var(--lu-text)]">{item.label_es}</span>
                                          <span className="block text-xs text-[var(--lu-subtle)]">
                                            {item.hpo_id}
                                            {item.label_en ? ` · ${item.label_en}` : ""}
                                          </span>
                                        </span>
                                        {yaEsta && (
                                          <span className="shrink-0 text-xs font-semibold text-[var(--lu-accent)]">
                                            Ya está
                                          </span>
                                        )}
                                      </button>
                                    </li>
                                  );
                                })}
                              </ul>
                            )}
                          </div>
                        )}
                      </div>

                      <div className="mt-4 border-t border-[var(--lu-border)] pt-4">
                        {symptoms.length === 0 ? (
                          <div className="rounded-xl border border-dashed border-[var(--lu-border)] px-4 py-8 text-center">
                            <p className="text-base font-semibold text-[var(--lu-text)]">
                              Todavía no hay síntomas cargados
                            </p>
                            <p className="mt-2 text-sm leading-relaxed text-[var(--lu-subtle)]">
                              Buscalos arriba, o pegá el relato clínico a la izquierda para que los
                              detectemos por vos.
                            </p>
                          </div>
                        ) : (
                          <ul className="flex flex-wrap gap-2">
                            {symptoms.map((symptom) => (
                              <li
                                key={symptom.code}
                                className="group inline-flex items-center gap-2 rounded-full border border-[var(--lu-border)] bg-white py-2 pl-4 pr-2 text-base text-[var(--lu-text)] shadow-sm"
                              >
                                <span
                                  className={[
                                    "h-2 w-2 shrink-0 rounded-full",
                                    symptom.source === "texto" ? "bg-[var(--lu-accent)]" : "bg-[var(--lu-border)]",
                                  ].join(" ")}
                                  title={symptom.source === "texto" ? "Detectado en el texto" : "Agregado a mano"}
                                  aria-hidden
                                />
                                <span className="font-semibold">{symptom.description}</span>
                                {symptom.code && (
                                  <span className="text-sm text-[var(--lu-subtle)]">{symptom.code}</span>
                                )}
                                <button
                                  type="button"
                                  className="inline-flex h-8 w-8 items-center justify-center rounded-full text-lg leading-none text-[var(--lu-subtle)] transition-colors hover:bg-red-50 hover:text-red-600"
                                  onClick={() => handleRemoveSymptom(symptom.code)}
                                  aria-label={`Eliminar ${symptom.description}`}
                                >
                                  ×
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>

                      {genphenError && (
                        <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-xs text-red-700">
                          {genphenError}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {step === 3 &&
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
                            onClick={() => setStep(2)}
                          >
                            Volver a editar los síntomas
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

                    {/* Gene ranking: a grid of overview cards, each opening the full detail in a modal. */}
                    {!isLowConfidenceResult && genphenResults.length > 0 && (
                      <div className="overflow-hidden rounded-3xl border border-[var(--lu-border)] bg-white shadow-sm">
                        <div className="flex flex-wrap items-center gap-4 border-b border-[var(--lu-border)] bg-[var(--lu-surface)] px-6 py-4">
                          <div className="min-w-0">
                            <p className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-[var(--lu-subtle)]">
                              Resultado orientativo · no es un diagnóstico
                            </p>
                            <h3 className="mt-1 text-xl font-semibold text-[var(--lu-text)]">
                              Genes para llevar a la consulta
                            </h3>
                          </div>
                          <span className="flex-grow" />
                          <label className="flex min-h-[44px] shrink-0 cursor-pointer items-center gap-2 rounded-xl border border-[var(--lu-border-strong)] bg-white px-3.5 text-sm font-medium text-[var(--lu-text)]">
                            <input
                              type="checkbox"
                              checked={professionalView}
                              onChange={(event) => {
                                const next = event.target.checked;
                                setProfessionalView(next);
                                try {
                                  window.localStorage.setItem(PROFESSIONAL_VIEW_KEY, next ? "1" : "0");
                                } catch {
                                  // Preference simply does not persist.
                                }
                              }}
                              className="h-[17px] w-[17px] accent-[var(--lu-accent)]"
                            />
                            Ver detalle médico
                          </label>
                        </div>

                        <div className="flex flex-col gap-4 px-6 py-5">
                          {reportedWords.size > 0 && (
                            <div className="flex flex-col gap-2 border-b border-[var(--lu-border)] pb-4">
                              <p className="text-xs font-semibold text-[var(--lu-text)]">
                                Lo que nos contaste
                              </p>
                              <ul className="flex flex-wrap gap-1.5">
                                {[...reportedWords.entries()].map(([code, said]) => (
                                  <li
                                    key={code}
                                    className="rounded-full border border-[var(--lu-border)] bg-[var(--lu-surface)] px-2.5 py-1 text-xs text-[var(--lu-text)]"
                                  >
                                    {said}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {/* No accuracy figure. It moves with the model, the
                              phenotypes and the disease, and a number on
                              screen would be read as a promise about this
                              child. The claim that survives is about the
                              shape of the list, not its hit rate. */}
                          <p className="text-xs leading-relaxed text-[var(--lu-subtle)]">
                            El sistema sugiere <strong className="font-semibold">genes</strong>, no
                            enfermedades ni diagnósticos. Miralos como un conjunto para investigar:
                            el orden es orientativo y el primero no es una respuesta.
                          </p>

                          {/* The model's own order, ungrouped. Splitting the
                              ranking put the top-scoring genes below a fold
                              and made a gene with no symptom overlap look
                              like an apology; the overlap is already on every
                              card, so it does not need a heading too. */}
                          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                            {orderedGenes.map(({ gene, rank, symbol }) => (
                              <GeneOverviewCard
                                key={`${gene.gene_id}-${rank}`}
                                symbol={symbol}
                                rank={rank}
                                total={visibleGeneResults.length}
                                score={Number(gene.score)}
                                profile={geneProfiles.get(symbol.toUpperCase()) ?? null}
                                professional={professionalView}
                                reportedWords={reportedWords}
                                onOpen={() => setSelectedSymbol(symbol)}
                              />
                            ))}
                          </ul>
                        </div>

                        <GeneModal
                          entries={modalEntries}
                          openSymbol={selectedSymbol}
                          onOpenSymbol={setSelectedSymbol}
                          profiles={geneProfiles}
                          professional={professionalView}
                          reportedWords={reportedWords}
                        />
                      </div>
                    )}

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
                                  <td className="py-2 pr-6 font-medium text-[var(--lu-text)]">{traducirEspecialidad(row.specialty)}</td>
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

            {(step < 3 || step > firstStep) && (
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
                        sintomaInputRef.current?.focus();
                        sintomaInputRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
                      }}
                      className="inline-flex items-center justify-center h-10 px-5 rounded-xl border border-[var(--lu-accent)] text-[var(--lu-accent)] font-medium hover:bg-[var(--lu-accent)] hover:text-white transition-colors"
                    >
                      Elegir síntomas de la lista
                    </button>
                  )}
                  {step < 3 && (
                  <button
                    type="button"
                    className="inline-flex items-center justify-center h-11 px-8 rounded-xl bg-[var(--lu-green)] text-white font-bold hover:bg-[color-mix(in_oklab,var(--lu-green)_90%,#000)] shadow-md transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none"
                    onClick={handleContinue}
                    disabled={
                      (step === 1 && !canGoStep1) ||
                      (step === 2 && !canGoStep2) ||
                      isLoading
                    }
                  >
                    {step === 2 ? "Revisar y continuar" : "Continuar"}
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
                  )}
                </div>
              </div>
            )}
          </div>
        </section>
      </div>

      {showConfirmModal && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 backdrop-blur-sm px-5 animate-in fade-in duration-200">
          <div className="max-w-lg w-full rounded-[28px] border border-[var(--lu-border)] bg-white p-8 shadow-2xl">
            <h2 className="text-xl font-bold text-[var(--lu-text)]">Confirmá los síntomas</h2>
            <p className="mt-2 text-sm leading-relaxed text-[var(--lu-subtle)]">
              Vamos a buscar genes candidatos a partir de{" "}
              <strong className="font-semibold text-[var(--lu-text)]">
                {symptoms.length} {symptoms.length === 1 ? "síntoma" : "síntomas"}
              </strong>
              . Revisá que la lista esté completa: cuantos más síntomas específicos incluyas, mejor
              es el resultado.
            </p>

            <ul className="mt-5 flex max-h-64 flex-wrap gap-2 overflow-y-auto">
              {symptoms.map((symptom) => (
                <li
                  key={symptom.code}
                  className="inline-flex items-center gap-2 rounded-full border border-[var(--lu-border)] bg-[var(--lu-surface)] px-3 py-1.5 text-sm text-[var(--lu-text)]"
                >
                  <span className="font-semibold">{symptom.description}</span>
                  <span className="text-sm text-[var(--lu-subtle)]">{symptom.code}</span>
                </li>
              ))}
            </ul>

            <div className="mt-8 flex flex-wrap gap-3 justify-end">
              <button
                type="button"
                className="inline-flex items-center justify-center h-10 px-5 rounded-xl border border-[var(--lu-border)] text-[var(--lu-text)] font-medium hover:bg-[var(--lu-surface)] transition-colors"
                onClick={() => setShowConfirmModal(false)}
              >
                Seguir editando
              </button>
              <button
                type="button"
                className="inline-flex items-center justify-center h-10 px-5 rounded-xl bg-[var(--lu-green)] text-white font-bold hover:bg-[color-mix(in_oklab,var(--lu-green)_90%,#000)] shadow-md transition-all"
                onClick={consultarGenPhen}
              >
                Buscar genes candidatos
              </button>
            </div>
          </div>
        </div>
      )}

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
