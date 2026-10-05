"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../../lib/auth-context";
import GuiaCarga from "../../components/ui/GuiaCarga";
import AyudaPopover from "../../components/ui/AyudaPopover";

type Step = 1 | 2 | 3;

type Symptom = {
  description: string;
  code: string;
  confidence?: number;
  source?: "texto" | "manual";
  onset?: SymptomOnset | null;
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
  sintomas?: Array<{ description?: string; code?: string; onset?: unknown }>;
};

const stepsMeta: Array<{ id: Step; title: string }> = [
  { id: 1, title: "Datos básicos" },
  { id: 2, title: "Síntomas del paciente" },
  { id: 3, title: "Resultados orientativos" },
];

import { GeneModal } from "./gene-modal";
import { GeneOverviewCard } from "./gene-overview-card";
import { SpecialtyCard } from "./specialty-card";
import { ListToggle } from "./list-toggle";
import { scrollBehavior } from "./panel-styles";
import {
  QuestionLauncher,
  QuestionSidePanel,
  RefineButton,
  RefineTeaser,
  useQuestionPanel,
} from "./question-dock";
import { InfoIcon } from "./icons";
import { useFlipReorder } from "./use-flip-reorder";
import { useQuestionSession } from "./use-question-session";
import { RESULTS_DISCLAIMER } from "@/lib/disclaimer";
import { OnsetInline, OnsetSummary } from "@/components/ui/OnsetReport";
import { fetchGeneProfiles, formatScore, type GeneProfile } from "@/lib/genes-api";
import { errorMessage, isSessionError, jsonOrThrow } from "@/lib/api-errors";
import { ErrorNotice } from "@/components/ui/ErrorNotice";
import { BROAD_NOTICE_MAX_SYMPTOMS, canRefine as canRefineTerm, fetchTerms, isBroadTerm, typesLabel, type HpoTerm } from "@/lib/hpo-terms";
import { RefineTermDialog, type RefineTarget } from "./refine-term-dialog";
import { AgePicker } from "./age-picker";
import { HpoLink } from "./hpo-link";
import { ResultsDownload } from "./results-download";
import { especialidadesParaConsultar } from "@/lib/especialidades";
import { isOnsetInformative } from "@/lib/onset-informative";
import { ageFromBirthDate, birthDateFromAge } from "@/lib/patient-age";
import { onsetClass, onsetForSave, onsetPayloadFields, parseOnset, showsPrecisar, type SymptomOnset } from "@/lib/onset";
import { ADJUSTED_LIST_NOTE, originsIn } from "@/lib/question-insights";
import {
  answeredFindings,
  fetchQuestionsStatus,
  toGeneRows,
  type QuestionMode,
} from "@/lib/questions-api";

const TEXTO_OCULTO_KEY = "diagnosticar:texto-oculto";

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
  const { user, logout, refreshSession, loading: authLoading } = useAuth();
  const isDemoMode = searchParams.get("demo") === "1";
  const [step, setStep] = useState<Step>(isDemoMode ? 2 : 1);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState("");
  // Seconds since the current wait began. The Spanish symptom recognizer takes
  // 20-40s on a long history; a spinner alone for that long reads as a hang.
  const [loadingElapsed, setLoadingElapsed] = useState(0);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const sintomaInputRef = useRef<HTMLInputElement | null>(null);

  // Every field is optional. País starts on Argentina, where most families
  // are, and can be changed or cleared.
  const [datosBasicos, setDatosBasicos] = useState({
    nombre: "",
    fechaNacimiento: "",
    sexo: "",
    localidad: "",
    pais: "Argentina",
  });

  const HC_DRAFT_KEY = "diagnosticar:hc-draft";
  const LOCAL_RECORDS_KEY = "diagnosticar:records";
  const [historiaClinica, setHistoriaClinica] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem(HC_DRAFT_KEY) ?? "";
    }
    return "";
  });
  const [symptoms, setSymptoms] = useState<Symptom[]>([]);
  const [draftLost, setDraftLost] = useState(false);
  // How general each loaded symptom is, by upper-cased HPO id; fetched as
  // symptoms arrive. A term that reaches many genes barely orders the ranking,
  // so the list offers to refine it. Dismissing the offer lasts the session.
  const [termInfo, setTermInfo] = useState<Map<string, HpoTerm>>(new Map());
  const [keptGeneral, setKeptGeneral] = useState<Set<string>>(new Set());
  const [refineTarget, setRefineTarget] = useState<RefineTarget | null>(null);
  const [lastAnalyzedHC, setLastAnalyzedHC] = useState("");
  // The text tool starts open; hiding it lasts the browser tab, so someone
  // who only uses the search does not have to close it on every visit.
  const [textoAbierto, setTextoAbierto] = useState(true);
  useEffect(() => {
    try {
      if (sessionStorage.getItem(TEXTO_OCULTO_KEY) === "1") setTextoAbierto(false);
    } catch {
      // Storage blocked: it simply starts open.
    }
  }, []);
  const alternarTexto = () => {
    setTextoAbierto((abierto) => {
      try {
        if (abierto) sessionStorage.setItem(TEXTO_OCULTO_KEY, "1");
        else sessionStorage.removeItem(TEXTO_OCULTO_KEY);
      } catch {
        // Not remembered; harmless.
      }
      return !abierto;
    });
  };
  const [newSymptom, setNewSymptom] = useState({ description: "", code: "" });
  const [extractError, setExtractError] = useState<string | null>(null);
  const [extractFailure, setExtractFailure] = useState<unknown>(undefined);
  const [extractInfo, setExtractInfo] = useState<string | null>(null);
  const [genphenResults, setGenphenResults] = useState<GenPhenResult[]>([]);
  const [genphenSpecialties, setGenphenSpecialties] = useState<GenPhenSpecialties | null>(null);
  const [genphenConfidence, setGenphenConfidence] = useState<number | null>(null);
  const [genphenError, setGenphenError] = useState<string | null>(null);
  const [genphenFailure, setGenphenFailure] = useState<unknown>(undefined);
  const [extractedPhenotypes, setExtractedPhenotypes] = useState<PhenotypeItem[]>([]);
  // A result that ranked but did not reach the account: why, and the request
  // to send again from "Guardar de nuevo".
  const [saveFailure, setSaveFailure] = useState<{ error: unknown; url: string; body: unknown; localId: string | null } | null>(null);
  const [savingAgain, setSavingAgain] = useState(false);
  const [hpoSearchError, setHpoSearchError] = useState<string | null>(null);
  // Where the question agent hangs its session. Null when the result was not
  // saved to the account, which is also when the refine loop is not offered.
  const [diagnosisId, setDiagnosisId] = useState<string | null>(null);
  const [questionsEnabled, setQuestionsEnabled] = useState(false);
  // The model's own list is what the grid shows. The order adjusted by the
  // answers is a second view the reader has to ask for: on 501 published
  // patients it ranked no better than the model alone. The choice holds for
  // the rest of this page, rounds included, and not beyond it.
  const [preferAnswersList, setPreferAnswersList] = useState(false);
  // Said to a screen reader when the reader switches lists, not on load.
  const [listAnnouncement, setListAnnouncement] = useState("");
  const [regenerationPatientId, setRegenerationPatientId] = useState<string | null>(null);
  const [hpoSuggestions, setHpoSuggestions] = useState<HpoSuggestion[]>([]);
  const [hpoSuggestOpen, setHpoSuggestOpen] = useState(false);
  const [hpoSuggestLoading, setHpoSuggestLoading] = useState(false);

  const canGoStep2 = symptoms.length > 0;
  const puedeAnalizarTexto =
    historiaClinica.trim().length > 12 && historiaClinica.trim() !== lastAnalyzedHC;
  const isLowConfidenceResult =
    genphenConfidence !== null && genphenConfidence < GENPHENAI_LOW_CONFIDENCE_THRESHOLD;
  // Offered where the specialities are: on a saved result worth refining.
  const canRefine =
    questionsEnabled &&
    !isDemoMode &&
    diagnosisId !== null &&
    !genphenError &&
    !isLowConfidenceResult &&
    genphenResults.length > 0;
  const questionSession = useQuestionSession(canRefine ? diagnosisId : null, refreshSession);
  const questionPanel = useQuestionPanel(questionSession.state, diagnosisId);
  const refinedResults = useMemo<GenPhenResult[] | null>(
    () =>
      questionSession.state.refined
        ? toGeneRows(questionSession.state.refined.ranking, genphenResults[0]?.input_count ?? 0)
        : null,
    [questionSession.state.refined, genphenResults],
  );
  const showingRefined = refinedResults !== null && preferAnswersList;
  // Where the model's list, the one shown before the questions, had each gene
  // of the list with the answers. Every move on screen is measured from it.
  const originalSymbols = useMemo(
    () => genphenResults.map((gene) => gene.gene_symbol || gene.gene_id),
    [genphenResults],
  );
  const refinedOrigins = useMemo(
    () =>
      showingRefined && refinedResults
        ? originsIn(originalSymbols, refinedResults.map((gene) => gene.gene_symbol || gene.gene_id))
        : null,
    [showingRefined, refinedResults, originalSymbols],
  );
  const visibleGeneResults = showingRefined ? refinedResults : genphenResults;
  // Each round re-runs the model with the confirmed findings, so its
  // specialities are those of the list with the answers, and follow it.
  const visibleSpecialties = showingRefined
    ? (questionSession.state.refinedSpecialties ?? genphenSpecialties)
    : genphenSpecialties;
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

  /**
   * What the account says the patient does *not* have ("no presenta
   * convulsiones"), once per term and never one they also list as present.
   *
   * Shown so a reader can see a negation was understood, and move it back when
   * it was misread. Never sent to the model: /rank-genes takes present
   * phenotypes only, so a negated one there would count as present.
   */
  useEffect(() => {
    const missing = symptoms
      .map((symptom) => symptom.code.trim().toUpperCase())
      .filter((code) => code && !termInfo.has(code));
    if (missing.length === 0) return;
    let cancelled = false;
    void fetchTerms(missing).then((found) => {
      if (cancelled) return;
      setTermInfo((prev) => {
        const next = new Map(prev);
        // Unknown or failed ids are recorded too, so they are not asked again.
        for (const code of missing) next.set(code, found.get(code) ?? { hpo_id: code, nombre: "", genes: 0, tiene_hijos: false });
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [symptoms, termInfo]);

  const precisarSymptoms = useMemo(
    () =>
      symptoms.filter((symptom) => {
        const code = symptom.code.trim().toUpperCase();
        return showsPrecisar({
          refinable: canRefineTerm(termInfo.get(code)),
          informative: isOnsetInformative(code),
          dismissed: keptGeneral.has(code),
          hasOnset: Boolean(symptom.onset),
        });
      }),
    [symptoms, termInfo, keptGeneral],
  );

  const openPrecisar = (symptom: Symptom) =>
    setRefineTarget({
      code: symptom.code,
      description: symptom.description,
      refinable: canRefineTerm(termInfo.get(symptom.code.trim().toUpperCase())),
    });

  const handleOnsetChange = (code: string, onset: SymptomOnset | null) =>
    setSymptoms((prev) => prev.map((symptom) => (symptom.code === code ? { ...symptom, onset } : symptom)));

  const generalSymptoms = useMemo(
    () =>
      symptoms.filter((symptom) => {
        const code = symptom.code.trim().toUpperCase();
        return canRefineTerm(termInfo.get(code)) && !keptGeneral.has(code);
      }),
    [symptoms, termInfo, keptGeneral],
  );

  // Pointed out only when high in the tree and while the list is short: with
  // many symptoms, refining one barely moved the right gene
  // (docs/PRECISAR_SINTOMAS.md). The chip stays on every refinable term.
  const broadSymptoms = useMemo(
    () =>
      symptoms.length < BROAD_NOTICE_MAX_SYMPTOMS
        ? generalSymptoms.filter((symptom) => isBroadTerm(termInfo.get(symptom.code.trim().toUpperCase())))
        : [],
    [symptoms, generalSymptoms, termInfo],
  );

  const negatedFindings = useMemo(() => {
    const present = new Set(symptoms.map((symptom) => symptom.code.trim().toUpperCase()));
    const byId = new Map<string, { code: string; label: string }>();
    for (const phenotype of extractedPhenotypes) {
      if (!phenotype?.negated || typeof phenotype.hpo_id !== "string") continue;
      const id = phenotype.hpo_id.trim().toUpperCase();
      if (!HPO_CODE_RE.test(id) || present.has(id) || byId.has(id)) continue;
      const label =
        phenotype.label_es?.trim() || phenotype.span_es?.trim() || phenotype.label?.trim() || id;
      byId.set(id, { code: phenotype.hpo_id.trim(), label });
    }
    return [...byId.values()];
  }, [symptoms, extractedPhenotypes]);

  useEffect(() => {
    if (!isLoading) {
      setLoadingElapsed(0);
      return;
    }
    const started = Date.now();
    const timer = setInterval(
      () => setLoadingElapsed(Math.floor((Date.now() - started) / 1000)),
      1000,
    );
    return () => clearInterval(timer);
  }, [isLoading]);

  const [geneProfiles, setGeneProfiles] = useState<Map<string, GeneProfile>>(new Map());
  const [profilesFailed, setProfilesFailed] = useState(false);
  const [professionalView, setProfessionalView] = useState(false);
  const questionMode: QuestionMode = professionalView ? "medico" : "paciente";

  /**
   * What the answers confirmed and ruled out. What they confirmed was added
   * to the model's input for the list with the answers, so it shows with that
   * list only. What they ruled out reaches no list at all: it is kept for the
   * consultation and shows with either.
   */
  const questionFindings = useMemo(() => {
    const present = new Set([...reportedWords.keys()]);
    const absent = new Set(negatedFindings.map((finding) => finding.code.toUpperCase()));
    const named = (items: ReturnType<typeof answeredFindings>["present"]) =>
      items
        .map((item) => ({ code: item.question.hpoId.trim().toUpperCase(), label: item.question.label }))
        .filter((item) => HPO_CODE_RE.test(item.code));
    const { present: yes, absent: no } = answeredFindings(questionSession.state.history);
    return {
      present: showingRefined ? named(yes).filter((item) => !present.has(item.code)) : [],
      absent: named(no).filter((item) => !absent.has(item.code) && !present.has(item.code)),
    };
  }, [showingRefined, reportedWords, negatedFindings, questionSession.state.history]);

  /** The reader's report plus what they confirmed in the questions, for matching genes. */
  const matchedWords = useMemo(() => {
    if (questionFindings.present.length === 0) return reportedWords;
    const words = new Map(reportedWords);
    for (const finding of questionFindings.present) words.set(finding.code, finding.label);
    return words;
  }, [reportedWords, questionFindings]);

  // Keyed on the ids alone: which terms were reported decides the profiles,
  // and a new Map with the same ids must not refetch them.
  const matchedKey = useMemo(() => [...matchedWords.keys()].join(","), [matchedWords]);

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

  const rankedSymbols = useMemo(
    () => new Set(orderedGenes.map(({ symbol }) => symbol)),
    [orderedGenes],
  );

  const modalEntries = useMemo(
    () => orderedGenes.map(({ gene, symbol, rank }) => ({ symbol, rank, score: Number(gene.score) })),
    [orderedGenes],
  );

  /** Where each gene sits in the list on screen, for the genes the question panel names. */
  const geneRanks = useMemo(
    () => new Map(orderedGenes.map(({ symbol, rank }) => [symbol.toUpperCase(), rank])),
    [orderedGenes],
  );

  const geneListRef = useRef<HTMLUListElement | null>(null);
  const genePanelRef = useRef<HTMLDivElement | null>(null);
  const flipArmed = useRef(false);
  useFlipReorder(geneListRef, orderedGenes.map(({ symbol }) => symbol).join(","), flipArmed);

  const chooseList = (refined: boolean) => {
    flipArmed.current = refined !== showingRefined;
    setPreferAnswersList(refined);
    setListAnnouncement(
      refined ? "Mostrando la lista con tus respuestas." : "Mostrando la lista original del modelo.",
    );
  };

  /** From the question panel: the list with the answers, in the grid, with focus on its title. */
  const showUpdatedList = () => {
    if (!showingRefined) chooseList(true);
    const panel = genePanelRef.current;
    panel?.scrollIntoView({ block: "start", behavior: scrollBehavior() });
    panel?.querySelector<HTMLElement>("#genes-titulo")?.focus({ preventScroll: true });
  };

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

  // What each profile was compared against and in which view, then the
  // symbol. Switching between the original and the refined list changes the
  // first key and back again, and neither direction should refetch.
  const profileCache = useRef(new Map<string, Map<string, GeneProfile | null>>());

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

    const context = `${professionalView ? "profesional" : "familia"}|${matchedKey}`;
    let known = profileCache.current.get(context);
    if (!known) {
      known = new Map();
      profileCache.current.set(context, known);
    }
    const cached = known;
    const onScreen = () => {
      const profiles = new Map<string, GeneProfile>();
      for (const symbol of symbols) {
        const profile = cached.get(symbol.toUpperCase());
        if (profile) profiles.set(symbol.toUpperCase(), profile);
      }
      return profiles;
    };

    const missing = symbols.filter((symbol) => !cached.has(symbol.toUpperCase()));
    if (missing.length === 0) {
      setGeneProfiles(onScreen());
      return;
    }

    const controller = new AbortController();
    // `symptoms` is the confirmed list — what the user reviewed and what the
    // model ranked on. `extractedPhenotypes` only holds the raw output of a
    // text analysis, so it is empty whenever symptoms were added by hand,
    // edited, or restored from a draft, and comparing against it reported no
    // overlap for every gene.
    const reported = matchedKey ? matchedKey.split(",") : [];

    // The cards keep what they show until the answer arrives: clearing them
    // first flashed "sin descripción" on every toggle.
    let failed = false;
    fetchGeneProfiles(missing, reported, {
      professional: professionalView,
      signal: controller.signal,
      onFailure: (error) => {
        console.warn("[nuevo] gene profiles failed", error);
        failed = true;
      },
    }).then((fetched) => {
      if (controller.signal.aborted) return;
      setProfilesFailed(failed);
      // An empty answer is as likely a failed request as a set of misses,
      // so only a real answer settles which genes have no profile.
      if (fetched.size > 0) {
        for (const symbol of missing) cached.set(symbol.toUpperCase(), fetched.get(symbol.toUpperCase()) ?? null);
      }
      const profiles = onScreen();
      for (const [symbol, profile] of fetched) profiles.set(symbol, profile);
      setGeneProfiles(profiles);
    });

    return () => controller.abort();
  }, [visibleGeneResults, matchedKey, professionalView, isDemoMode]);

  useEffect(() => {
    if (isDemoMode || !diagnosisId) return;
    const controller = new AbortController();
    fetchQuestionsStatus(controller.signal).then((enabled) => {
      if (!controller.signal.aborted) setQuestionsEnabled(enabled);
    });
    return () => controller.abort();
  }, [isDemoMode, diagnosisId]);

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
                    const onset = parseOnset(item?.onset);
                    const symptom: Symptom = onset ? { description, code, onset } : { description, code };
                    return symptom;
                  })
                  .filter((item): item is Symptom => item !== null)
              : [];

            // A saved search with no usable symptoms starts empty: anything
            // else would put symptoms the patient never reported into the
            // search.
            setSymptoms(parsedSymptoms);
            setDraftLost(parsedSymptoms.length === 0);

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
            setSymptoms([]);
            setDraftLost(true);
          }
          window.sessionStorage.removeItem("diagnosticar:newDiagDraft");
        } else {
          // Reached by reloading after "Regenerar": the draft is read once and
          // removed, so there is nothing to restore.
          setRegenerationPatientId(null);
          setSymptoms([]);
          setDraftLost(true);
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
        const payload = await jsonOrThrow<{ results?: unknown }>(response);
        const results = Array.isArray(payload?.results) ? payload.results : [];
        if (!controller.signal.aborted) {
          setHpoSearchError(null);
          setHpoSuggestions(results);
          setHpoSuggestOpen(true);
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          console.error("[nuevo] hpo search failed", error);
          // "Sin coincidencias" would claim the term does not exist.
          setHpoSearchError(errorMessage(error, "hpo_search"));
          setHpoSuggestions([]);
          setHpoSuggestOpen(true);
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
    setExtractFailure(undefined);
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
      const payload = await jsonOrThrow<{ phenotypes?: unknown }>(response);
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
            ? null
            : "No encontramos síntomas en el texto. Podés agregarlos buscándolos abajo."
      );
    } catch (error) {
      console.error("[nuevo] extraction failed", error);
      setExtractFailure(error);
      setExtractError(errorMessage(error, "extract"));
    } finally {
      setIsLoading(false);
      setLoadingMessage("");
    }
  };

  // Sends the result to the account. An access token that lapsed while the
  // tab was open is renewed once rather than reported as a failure.
  const enviarGuardado = async (url: string, body: unknown): Promise<string | null> => {
    const post = () => {
      const csrfToken = getCookieValue("csrf_token");
      return fetch(url, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
        },
        body: JSON.stringify(body),
      }).then((response) => jsonOrThrow<{ diagnosisId?: unknown }>(response));
    };
    let saved;
    try {
      saved = await post();
    } catch (error) {
      if (!isSessionError(error) || !(await refreshSession())) throw error;
      saved = await post();
    }
    return typeof saved?.diagnosisId === "string" ? saved.diagnosisId : null;
  };

  /** A copy on this device, so a failed save loses nothing. Null when the device would not keep it. */
  const guardarCopiaLocal = (
    results: GenPhenResult[],
    payload: { specialties?: GenPhenSpecialties; confidence?: unknown },
  ): string | null => {
    const id = Date.now().toString();
    try {
      const record = {
        id,
        nombre: datosBasicos.nombre.trim() || "Paciente sin apodo",
        savedAt: new Date().toISOString(),
        symptoms: symptoms.map((s) => ({ description: s.description, code: s.code, ...onsetForSave(s.onset) })),
        topSpecialties: payload?.specialties?.top_specialties ?? [],
        confidence: typeof payload?.confidence === "number" ? payload.confidence : null,
        topGenes: results.slice(0, 5).map((g) => g.gene_symbol),
      };
      const existing = JSON.parse(localStorage.getItem(LOCAL_RECORDS_KEY) || "[]");
      localStorage.setItem(LOCAL_RECORDS_KEY, JSON.stringify([record, ...(Array.isArray(existing) ? existing : [])]));
      return id;
    } catch {
      return null;
    }
  };

  const guardarDeNuevo = async () => {
    if (!saveFailure) return;
    setSavingAgain(true);
    try {
      setDiagnosisId(await enviarGuardado(saveFailure.url, saveFailure.body));
      setRegenerationPatientId(null);
      if (saveFailure.localId) {
        try {
          const existing = JSON.parse(localStorage.getItem(LOCAL_RECORDS_KEY) || "[]") as { id?: string }[];
          localStorage.setItem(
            LOCAL_RECORDS_KEY,
            JSON.stringify(existing.filter((record) => record?.id !== saveFailure.localId)),
          );
        } catch {
          // The account has it now; a stale local copy is harmless.
        }
      }
      setSaveFailure(null);
    } catch (error) {
      console.error("[nuevo] save retry failed", error);
      setSaveFailure({ ...saveFailure, error });
    } finally {
      setSavingAgain(false);
    }
  };

  const consultarGenPhen = async () => {
    setShowConfirmModal(false);
    setIsLoading(true);
    setLoadingMessage("Buscando genes relacionados con los síntomas…");
    setGenphenError(null);
    setGenphenFailure(undefined);
    setSaveFailure(null);
    setGenphenResults([]);
    setGenphenSpecialties(null);
    setGenphenConfidence(null);
    setDiagnosisId(null);
    try {
      const hpoIds = symptoms
        .map((symptom) => symptom.code.trim().toUpperCase())
        .filter((code) => /^HP:\d+$/.test(code));
      if (hpoIds.length === 0) {
        setGenphenError("Agregá al menos un síntoma de la lista para buscar genes.");
        return;
      }
      const response = await fetch(GENPHENAI_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hpo_ids: hpoIds, top_k: isDemoMode ? 1 : 50, ...onsetPayloadFields(symptoms) }),
      });
      const payload = await jsonOrThrow<{ results?: unknown; specialties?: GenPhenSpecialties; confidence?: unknown }>(response);
      const results = Array.isArray(payload?.results) ? payload.results : [];
      setGenphenResults(results);

      // Specialties and confidence come directly from the genphenai response
      if (payload?.specialties) setGenphenSpecialties(payload.specialties);
      if (typeof payload?.confidence === "number") setGenphenConfidence(payload.confidence);

      // Save to backend (authenticated) or localStorage (demo / fallback)
      if (!isDemoMode && user) {
        try {
          const diagnosisPayload = {
            historiaClinica: historiaClinica.trim(),
            symptomsExtracted: symptoms.map((s) => ({ description: s.description, code: s.code, ...onsetForSave(s.onset) })),
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
                // Empty: the server numbers it «Paciente N» within the account.
                nombre: datosBasicos.nombre.trim(),
                fechaNacimiento: datosBasicos.fechaNacimiento || null,
                sexo: datosBasicos.sexo || null,
                localidad: datosBasicos.localidad || null,
                pais: datosBasicos.pais || null,
                ...diagnosisPayload,
              };

          try {
            setDiagnosisId(await enviarGuardado(saveUrl, saveBody));
            setRegenerationPatientId(null);
          } catch (error) {
            console.error("[nuevo] save failed", error);
            setSaveFailure({ error, url: saveUrl, body: saveBody, localId: guardarCopiaLocal(results, payload) });
          }
        } catch (error) {
          console.error("[nuevo] save failed", error);
        }
      }

      localStorage.removeItem(HC_DRAFT_KEY);
      setStep(3);
    } catch (error) {
      console.error("[nuevo] rank-genes failed", error);
      setGenphenFailure(error);
      setGenphenError(errorMessage(error, "rank_genes"));
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

  // Skipping means giving none of it, so the país default goes too.
  const omitirDatosBasicos = () => {
    setDatosBasicos({ nombre: "", fechaNacimiento: "", sexo: "", localidad: "", pais: "" });
    setStep(2);
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

  const handleMarkPresent = (code: string, description: string) => {
    setSymptoms((prev) =>
      prev.some((symptom) => symptom.code.trim().toUpperCase() === code.toUpperCase())
        ? prev
        : [...prev, { description, code, source: "texto" }],
    );
  };

  const handleRemoveSymptom = (code: string) => {
    setSymptoms((prev) => prev.filter((symptom) => symptom.code !== code));
  };

  // The more specific term replaces the general one rather than joining it:
  // both would count the same finding twice.
  const handleRefineChoose = (parentCode: string, term: HpoTerm) => {
    const code = term.hpo_id.trim().toUpperCase();
    setTermInfo((prev) => new Map(prev).set(code, term));
    setSymptoms((prev) => {
      const parent = prev.find((symptom) => symptom.code === parentCode);
      if (!parent || code === parentCode.trim().toUpperCase()) return prev;
      const already = prev.some((symptom) => symptom.code.trim().toUpperCase() === code);
      if (already && parent.onset) {
        return prev
          .filter((symptom) => symptom.code !== parentCode)
          .map((symptom) =>
            symptom.code.trim().toUpperCase() === code && !symptom.onset ? { ...symptom, onset: parent.onset } : symptom,
          );
      }
      return already
        ? prev.filter((symptom) => symptom.code !== parentCode)
        : prev.map((symptom) =>
            symptom.code === parentCode ? { ...symptom, description: term.nombre, code } : symptom,
          );
    });
  };

  const visibleStepsMeta = isDemoMode ? stepsMeta.filter((meta) => meta.id !== 1) : stepsMeta;
  const stepTitle =
    visibleStepsMeta.find((meta) => meta.id === step)?.title ??
    stepsMeta.find((meta) => meta.id === step)?.title ??
    "";
  const displayName = user?.name?.trim() || user?.email;

  // The question panel lives beside the results, on this step only. Its ways
  // in (the launcher, the line above the grid, the grid header's button) show
  // while it is hidden, and all go when the search has nothing to ask about.
  const refineOnScreen = canRefine && step === 3;
  const refineEntries = refineOnScreen && !questionPanel.open && !questionSession.state.blocked;
  const panelDocked = refineOnScreen && questionPanel.open && questionPanel.variant === "docked";

  // Always at the foot of the results. The panel carries it too, word for
  // word, so it stays in view while the questions are.
  const disclaimer = (
    <div className="rounded-2xl border border-amber-100 bg-amber-50 px-5 py-4">
      <p className="text-xs text-amber-700 leading-relaxed">{RESULTS_DISCLAIMER}</p>
    </div>
  );

  const handleLogout = async () => {
    if (await logout()) router.replace("/login");
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

  // Clipped, not hidden: an overflow-hidden <main> is a scroll container that
  // scrollIntoView moves and the reader cannot move back, which cut the top of
  // the results off once the questions scrolled to themselves.
  return (
    <main className="page-root relative overflow-clip">
      {/* Background decoration */}
      <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full diagnostic-hero-bg blur-3xl pointer-events-none animate-breathe" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[40%] h-[40%] rounded-full diagnostic-hero-bg blur-3xl pointer-events-none animate-breathe" style={{ animationDelay: "3s" }} />

      {/* Pinned from tablets up only. On a phone the question panel pins its
          own action bar to the bottom, and a pinned header as well would leave
          little of the screen for the questions. */}
      <header className="top-0 z-20 w-full backdrop-blur-md sm:sticky bg-[color-mix(in_oklab,var(--lu-bg)_80%,transparent)] border-b border-[var(--lu-border)]">
        {/* Below md the row keeps the logo and the two actions only, and the
            logo is sized to the width: at full size it left no room and was
            squeezed off a phone's screen. "Home" is the logo's own link, and
            the account's address stays for screen readers. */}
        <div className="mx-auto max-w-7xl flex items-center justify-between gap-3 px-4 md:px-5 py-4">
          <Link href="/home" className="flex shrink-0 items-center" aria-label="Regresar al home">
            <Image
              src="/brand/logo-diagnosticar.svg"
              alt="Diagnostic.ar"
              width={360}
              height={88}
              className="h-8 w-auto min-[400px]:h-10 sm:h-12 md:h-16"
              priority
            />
          </Link>

          <nav className="flex items-center gap-3 md:gap-5">
            <Link href="/home" className="hidden md:inline text-sm font-medium text-[var(--lu-subtle)] hover:text-[var(--lu-text)] transition-colors">
              Home
            </Link>
            {isDemoMode ? (
              <>
                <span className="max-md:sr-only px-3 py-1 rounded-full bg-amber-100 text-amber-700 text-xs font-bold uppercase tracking-wider border border-amber-200">
                  Modo demostración
                </span>
                <Link href="/sign-up" className="whitespace-nowrap text-sm font-medium text-[var(--lu-accent)] hover:underline">
                  Crear cuenta
                </Link>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="inline-flex items-center gap-2 px-2 md:px-4 h-9 text-sm font-medium text-red-500 hover:text-red-700 transition-colors"
                  onClick={() => setShowCancelModal(true)}
                >
                  Cancelar
                </button>
                {displayName && (
                  <>
                    <span className="user-badge truncate max-md:sr-only">
                      {displayName}
                    </span>
                    <button type="button" onClick={handleLogout} className="nav-link whitespace-nowrap text-sm">
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
        {/* Taller at the foot while the launcher floats there, so the last
            controls can always scroll clear of it. */}
        <section className={`mx-auto max-w-[1400px] w-full px-6 lg:px-10 pt-12 flex-1 ${refineEntries ? "pb-36" : "pb-24"}`}>
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
                  {isDemoMode ? "Prueba rápida" : "Nueva búsqueda"}
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
                    <p role="status" className="text-sm font-semibold text-[var(--lu-subtle)]">
                      {loadingMessage}
                    </p>
                    {loadingElapsed >= 8 && (
                      <p className="max-w-xs text-xs leading-relaxed text-[var(--lu-subtle)]">
                        Puede tardar hasta un minuto. Seguimos trabajando, no cierres la página.{" "}
                        <span aria-hidden className="font-mono">({loadingElapsed} s)</span>
                      </p>
                    )}
                  </div>
                </div>
              )}

              {step === 1 && (
                <div className="space-y-6">
                  <p className="text-sm leading-relaxed text-[var(--lu-subtle)]">
                    Todos los datos son opcionales. La edad y el sexo ayudan a leer los resultados; si preferís no
                    darlos, podés omitir este paso.
                  </p>
                  <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 [&>*]:min-w-0">
                    <div className="lg:col-span-2">
                      <label className="block text-sm font-bold text-[var(--lu-text)]">
                        Apodo <span className="font-normal text-[var(--lu-subtle)]">(opcional)</span>
                        <input
                          type="text"
                          value={datosBasicos.nombre}
                          onChange={(event) => setDatosBasicos((prev) => ({ ...prev, nombre: event.target.value }))}
                          className="mt-2 w-full rounded-xl border border-[var(--lu-border)] bg-white px-4 py-3 text-[var(--lu-text)] focus:border-[var(--lu-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--lu-accent-light)] transition-all"
                          placeholder="Ej. Juli, Mamá, Abuelo"
                          aria-describedby="apodo-ayuda"
                          maxLength={255}
                        />
                      </label>
                      <p id="apodo-ayuda" className="mt-1.5 text-xs text-[var(--lu-subtle)]">
                        Para reconocerlo en tu cuenta. Si lo dejás vacío, lo guardamos como «Paciente 1», «Paciente 2»…
                      </p>
                    </div>

                    <AgePicker
                      value={ageFromBirthDate(datosBasicos.fechaNacimiento)}
                      onChange={(age) =>
                        setDatosBasicos((prev) => ({ ...prev, fechaNacimiento: age ? birthDateFromAge(age) : "" }))
                      }
                    />

                    <label className="block text-sm font-bold text-[var(--lu-text)]">
                      Sexo <span className="font-normal text-[var(--lu-subtle)]">(opcional)</span>
                      <select
                        value={datosBasicos.sexo}
                        onChange={(event) => setDatosBasicos((prev) => ({ ...prev, sexo: event.target.value }))}
                        className="mt-2 w-full rounded-xl border border-[var(--lu-border)] bg-white px-4 py-3 text-[var(--lu-text)] focus:border-[var(--lu-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--lu-accent-light)] transition-all appearance-none"
                      >
                        <option value="">Sin indicar</option>
                        <option value="femenino">Femenino</option>
                        <option value="masculino">Masculino</option>
                        <option value="no_binario">No binario</option>
                        <option value="prefiero_no_decir">Prefiero no decirlo</option>
                      </select>
                    </label>

                    <label className="block text-sm font-bold text-[var(--lu-text)]">
                      País <span className="font-normal text-[var(--lu-subtle)]">(opcional)</span>
                      <select
                        value={datosBasicos.pais}
                        onChange={(event) => setDatosBasicos((prev) => ({ ...prev, pais: event.target.value }))}
                        className="mt-2 w-full rounded-xl border border-[var(--lu-border)] bg-white px-4 py-3 text-[var(--lu-text)] focus:border-[var(--lu-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--lu-accent-light)] transition-all appearance-none"
                      >
                        <option value="">Sin indicar</option>
                        {countries.map((country) => (
                          <option key={country} value={country}>
                            {country}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="block text-sm font-bold text-[var(--lu-text)]">
                      Localidad <span className="font-normal text-[var(--lu-subtle)]">(opcional)</span>
                      <input
                        type="text"
                        value={datosBasicos.localidad}
                        onChange={(event) =>
                          setDatosBasicos((prev) => ({ ...prev, localidad: event.target.value }))
                        }
                        className="mt-2 w-full rounded-xl border border-[var(--lu-border)] bg-white px-4 py-3 text-[var(--lu-text)] focus:border-[var(--lu-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--lu-accent-light)] transition-all"
                        placeholder="Ciudad o localidad"
                        maxLength={255}
                      />
                    </label>
                  </div>
                </div>
              )}

              {step === 2 && (
                <div className="space-y-6">
                  {/* The list is what the model searches with, so it leads. */}
                  <div className="space-y-4">
                    <div className="rounded-2xl border border-[var(--lu-border)] bg-white p-5 shadow-sm">
                      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                        <div className="flex items-center gap-2.5">
                          <h2 className="text-lg font-bold text-[var(--lu-text)]">Lista de síntomas</h2>
                          <span
                            className="rounded-full bg-[var(--lu-accent-light)] px-2.5 py-0.5 text-sm font-bold text-[var(--lu-accent-text)]"
                            aria-label={symptoms.length === 1 ? "1 síntoma cargado" : `${symptoms.length} síntomas cargados`}
                          >
                            {symptoms.length}
                          </span>
                        </div>
                        {/* ml-auto keeps it at the right edge when it wraps, where its
                            right-aligned popover has room. */}
                        <div className="ml-auto shrink-0">
                          <AyudaPopover etiqueta="¿Qué es un término HPO?" align="right">
                            <GuiaCarga variant="sintomas" />
                          </AyudaPopover>
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
                            ) : hpoSearchError ? (
                              <div role="alert" className="px-4 py-3 text-sm text-red-800">
                                {hpoSearchError}
                              </div>
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
                        {draftLost && symptoms.length === 0 && (
                          <div role="status" className="mb-3 rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3">
                            <p className="text-sm font-semibold text-[var(--lu-text)]">
                              No pudimos recuperar los síntomas de la búsqueda anterior
                            </p>
                            <p className="mt-1 text-xs leading-relaxed text-[var(--lu-subtle)]">
                              Cargalos de nuevo acá, o volvé a{" "}
                              <Link href="/diagnosticar" className="font-semibold text-[var(--lu-accent-text)] underline underline-offset-2">
                                tus búsquedas
                              </Link>{" "}
                              y abrila otra vez.
                            </p>
                          </div>
                        )}
                        {symptoms.length === 0 ? (
                          <div className="rounded-xl border border-dashed border-[var(--lu-border)] px-4 py-8 text-center">
                            <p className="text-base font-semibold text-[var(--lu-text)]">
                              Todavía no hay síntomas cargados
                            </p>
                            <p className="mt-2 text-sm leading-relaxed text-[var(--lu-subtle)]">
                              Buscalos arriba, o pegá un relato en «Extraer síntomas de un texto», acá
                              abajo, para que los detectemos por vos.
                            </p>
                          </div>
                        ) : (
                          <ul className="flex flex-wrap gap-2">
                            {symptoms.map((symptom) => (
                              <li
                                key={symptom.code}
                                className="group inline-flex max-w-full flex-wrap items-center gap-x-2 gap-y-1 rounded-2xl border border-[var(--lu-border)] bg-white py-2 pl-4 pr-2 text-base text-[var(--lu-text)] shadow-sm sm:rounded-full"
                              >
                                <span className="break-words font-semibold">
                                  <span
                                    className={[
                                      "mr-2 inline-block h-2 w-2 rounded-full align-middle",
                                      symptom.source === "texto" ? "bg-[var(--lu-accent)]" : "bg-[var(--lu-border)]",
                                    ].join(" ")}
                                    title={symptom.source === "texto" ? "Detectado en el texto" : "Agregado a mano"}
                                    aria-hidden
                                  />
                                  {symptom.description}
                                </span>
                                {symptom.code && (
                                  <HpoLink
                                    code={symptom.code}
                                    className="shrink-0 text-sm text-[var(--lu-subtle)] underline decoration-dotted underline-offset-2 hover:text-[var(--lu-accent-text)]"
                                  >
                                    {symptom.code}
                                  </HpoLink>
                                )}
                                {symptom.onset && (
                                  <span className="shrink-0 rounded-full bg-[var(--lu-surface)] px-2 py-0.5 text-xs text-[var(--lu-subtle)]">
                                    Empezó: {onsetClass(symptom.onset.hpo_id)?.label.toLowerCase()}
                                  </span>
                                )}
                                {precisarSymptoms.includes(symptom) && (
                                  <button
                                    type="button"
                                    onClick={() => openPrecisar(symptom)}
                                    className="inline-flex min-h-[32px] items-center gap-1 rounded-full bg-amber-50 px-2.5 text-xs font-semibold text-amber-800 ring-1 ring-inset ring-amber-200 transition-colors hover:bg-amber-100"
                                    aria-label={
                                      canRefineTerm(termInfo.get(symptom.code.trim().toUpperCase()))
                                        ? `Precisar ${symptom.description}: tiene tipos más específicos`
                                        : `Precisar ${symptom.description}: indicar a qué edad empezó`
                                    }
                                  >
                                    Precisar
                                  </button>
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

                        {broadSymptoms.length > 0 && (
                          <div
                            className="mt-4 rounded-xl border border-amber-200 bg-amber-50/60 p-4"
                            data-testid="general-terms-notice"
                          >
                            <p className="text-sm font-semibold text-[var(--lu-text)]">
                              {broadSymptoms.length === 1
                                ? "Hay un síntoma muy amplio"
                                : `Hay ${broadSymptoms.length} síntomas muy amplios`}
                            </p>
                            <p className="mt-1 text-xs leading-relaxed text-[var(--lu-subtle)]">
                              Cada uno abarca muchos tipos distintos. Si sabés cuál es, elegirlo ayuda a ordenar
                              los genes, sobre todo cuando hay pocos síntomas cargados. Es opcional.
                            </p>
                            <ul className="mt-3 space-y-2">
                              {broadSymptoms.map((symptom) => {
                                const code = symptom.code.trim().toUpperCase();
                                const info = termInfo.get(code);
                                return (
                                  <li
                                    key={symptom.code}
                                    className="flex flex-col gap-2 rounded-lg bg-white px-3 py-2.5 ring-1 ring-inset ring-amber-100 sm:flex-row sm:items-center sm:gap-3"
                                  >
                                    <span className="min-w-0 flex-1 text-sm text-[var(--lu-text)]">
                                      <span className="font-semibold">{symptom.description}</span>
                                      {info?.debajo ? (
                                        <span className="text-[var(--lu-subtle)]"> · {typesLabel(info.debajo)}</span>
                                      ) : null}
                                    </span>
                                    <span className="flex gap-1.5">
                                      <button
                                        type="button"
                                        onClick={() => openPrecisar(symptom)}
                                        className="min-h-[36px] rounded-full bg-[var(--lu-accent-text)] px-3.5 text-xs font-semibold text-white hover:bg-[#134e4a]"
                                      >
                                        Precisar
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setKeptGeneral((prev) => new Set(prev).add(code))}
                                        className="min-h-[36px] rounded-full px-3 text-xs font-semibold text-[var(--lu-subtle)] hover:bg-white hover:text-[var(--lu-text)]"
                                        aria-label={`Dejar ${symptom.description} así`}
                                      >
                                        Dejarlo así
                                      </button>
                                    </span>
                                  </li>
                                );
                              })}
                            </ul>
                          </div>
                        )}

                        <RefineTermDialog
                          target={refineTarget}
                          onClose={() => setRefineTarget(null)}
                          onChoose={(term) => refineTarget && handleRefineChoose(refineTarget.code, term)}
                          onset={symptoms.find((symptom) => symptom.code === refineTarget?.code)?.onset ?? null}
                          onOnsetChange={(onset) => refineTarget && handleOnsetChange(refineTarget.code, onset)}
                          birthDate={datosBasicos.fechaNacimiento || null}
                        />

                        {negatedFindings.length > 0 && (
                          <div className="mt-4 rounded-xl border border-[var(--lu-border)] bg-[var(--lu-surface)] p-4">
                            <p className="text-sm font-semibold text-[var(--lu-text)]">
                              No presenta, según el texto
                            </p>
                            <p className="mt-1 text-xs leading-relaxed text-[var(--lu-subtle)]">
                              Entendimos que el relato los descarta, así que no se usan para buscar
                              genes. Si alguno sí lo presenta, pasalo a la lista.
                            </p>
                            <ul className="mt-3 flex flex-wrap gap-2">
                              {negatedFindings.map((finding) => (
                                <li
                                  key={finding.code}
                                  className="inline-flex items-center gap-2 rounded-full border border-dashed border-[var(--lu-border-strong)] bg-white py-1 pl-3.5 pr-1 text-sm text-[var(--lu-text)]"
                                >
                                  <span>{finding.label}</span>
                                  <button
                                    type="button"
                                    onClick={() => handleMarkPresent(finding.code, finding.label)}
                                    aria-label={`${finding.label}: sí lo presenta, agregarlo a la lista`}
                                    className="min-h-[36px] rounded-full px-3 text-xs font-semibold text-[var(--lu-accent-text)] hover:bg-[var(--lu-accent-light)]"
                                  >
                                    Sí lo presenta
                                  </button>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>

                      <ErrorNotice className="mt-3" message={genphenError} error={genphenFailure} />
                    </div>
                  </div>

                  {/* A tool that fills the list above, open by default. */}
                  <section
                    aria-labelledby="extraer-texto-titulo"
                    className="rounded-2xl border border-[var(--lu-border)] bg-white shadow-sm"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 p-5">
                      <h2 id="extraer-texto-titulo" className="text-lg font-bold text-[var(--lu-text)]">
                        <button
                          type="button"
                          onClick={alternarTexto}
                          aria-expanded={textoAbierto}
                          aria-controls="extraer-texto-panel"
                          className="group inline-flex items-center gap-2.5 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--lu-accent)]"
                        >
                          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--lu-accent-light)] text-[var(--lu-accent-text)]">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                              <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
                              <path d="M14 3v5h5M9 13h6M9 17h4" />
                            </svg>
                          </span>
                          <span>Extraer síntomas de un texto</span>
                          <svg
                            width="18"
                            height="18"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.25"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden
                            className={`shrink-0 text-[var(--lu-subtle)] transition-transform ${textoAbierto ? "rotate-180" : ""}`}
                          >
                            <path d="m6 9 6 6 6-6" />
                          </svg>
                        </button>
                      </h2>
                      <div className="ml-auto flex shrink-0 items-center gap-2">
                        <span className="text-sm text-[var(--lu-subtle)]">Opcional</span>
                        <AyudaPopover etiqueta="¿Qué escribo acá?" align="right">
                          <GuiaCarga variant="historia" />
                        </AyudaPopover>
                      </div>
                    </div>

                    {!textoAbierto && (lastAnalyzedHC || extractInfo) && (
                      <p className="-mt-2 px-5 pb-4 text-sm text-[var(--lu-subtle)]">
                        {extractInfo ?? "Ya analizaste un texto."}{" "}
                        <button
                          type="button"
                          onClick={alternarTexto}
                          className="font-semibold text-[var(--lu-accent-text)] underline underline-offset-2"
                        >
                          Ver el texto
                        </button>
                      </p>
                    )}

                    <div id="extraer-texto-panel" hidden={!textoAbierto} className="border-t border-[var(--lu-border)] p-5">
                      <p className="text-base leading-relaxed text-[var(--lu-subtle)]">
                        ¿Tenés un resumen médico o un relato escrito? Pegalo y buscamos los síntomas
                        para sumarlos a la lista. Podés analizar varias veces: nunca borramos lo que ya
                        cargaste.
                      </p>
                      <textarea
                        value={historiaClinica}
                        onChange={(event) => setHistoriaClinica(event.target.value)}
                        rows={6}
                        maxLength={10000}
                        aria-label="Relato clínico"
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
                      <ErrorNotice className="mt-3" message={extractError} error={extractFailure} />
                      {extractInfo && !extractError && (
                        <div role="status" className="mt-3 flex items-start gap-2 rounded-xl border border-[var(--lu-accent-light)] bg-[color-mix(in_oklab,var(--lu-accent-light)_45%,white)] px-4 py-2.5 text-sm text-[var(--lu-text)]">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="mt-0.5 shrink-0 text-[var(--lu-accent-text)]">
                            <path d="M20 6 9 17l-5-5" />
                          </svg>
                          <span>{extractInfo}</span>
                        </div>
                      )}
                    </div>
                  </section>
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

                    {/* The demo is what an anonymous visitor sees: the legal notice
                        has to be here as much as on a saved result. */}
                    {disclaimer}

                    {genphenError ? (
                      <ErrorNotice message={genphenError} error={genphenFailure} />
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
                                    Puntaje {formatScore(Number(demoPrimaryGene.score))}
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
                  <div className={panelDocked ? "flex items-start gap-6" : undefined}>
                  <div className={panelDocked ? "min-w-0 flex-1 space-y-6" : "space-y-6"}>
                    {saveFailure && (
                      <ErrorNotice
                        error={saveFailure.error}
                        message={`No pudimos guardar este resultado en tu cuenta. ${errorMessage(saveFailure.error, "save")} El resultado sigue en pantalla${
                          saveFailure.localId ? " y quedó una copia en este dispositivo" : ""
                        }.`}
                        onRetry={savingAgain ? undefined : guardarDeNuevo}
                        retryLabel="Guardar de nuevo"
                      />
                    )}
                    {/* The two outcomes with no ranking to show. The specialities
                        follow the genes further down, since they are derived
                        from them. */}
                    {genphenError ? (
                      <ErrorNotice message={genphenError} error={genphenFailure} />
                    ) : isLowConfidenceResult ? (
                      <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-800">
                        <p className="leading-relaxed">
                          Con los síntomas cargados todavía no alcanza para ordenar los genes de forma útil. No quiere decir que no haya nada: falta información. Sumá más síntomas, sobre todo los más específicos, y volvé a buscar.
                        </p>
                        <button
                          type="button"
                          className="mt-4 inline-flex items-center justify-center h-10 px-5 rounded-xl border border-amber-300 text-amber-900 font-medium hover:bg-amber-100 transition-colors"
                          onClick={() => setStep(2)}
                        >
                          Volver a editar los síntomas
                        </button>
                      </div>
                    ) : null}

                    {/* Gene ranking: a grid of overview cards, each opening the full detail in a modal. */}
                    {!isLowConfidenceResult && genphenResults.length > 0 && (
                      <div
                        ref={genePanelRef}
                        data-gene-panel
                        className="scroll-mt-4 overflow-clip rounded-3xl border border-[var(--lu-border)] bg-white shadow-sm sm:scroll-mt-28"
                      >
                        <div className="flex flex-wrap items-center gap-3 border-b border-[var(--lu-border)] bg-[var(--lu-surface)] px-4 py-4 sm:gap-4 sm:px-6">
                          {/* Beside a docked panel the band is too narrow for the title
                              and both controls; they go under it together. */}
                          <div
                            className={`min-w-0 basis-full ${panelDocked && refinedResults !== null ? "" : "md:basis-auto"}`}
                          >
                            <p className="text-balance font-mono text-[10.5px] uppercase tracking-[0.14em] text-[var(--lu-subtle)]">
                              Resultado orientativo&nbsp;· no es un diagnóstico
                            </p>
                            <h3
                              id="genes-titulo"
                              tabIndex={-1}
                              className="mt-1 text-xl font-semibold text-[var(--lu-text)] focus:outline-none"
                            >
                              Genes para llevar a la consulta
                            </h3>
                          </div>
                          <span className="hidden flex-grow md:block" />
                          {refineEntries && <RefineButton control={questionPanel} />}
                          {refinedResults !== null && (
                            <ListToggle refined={showingRefined} onChange={chooseList} />
                          )}
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
                          {refinedResults !== null && (
                            <p
                              data-list-note
                              className="flex basis-full items-start gap-1.5 text-xs leading-relaxed text-[var(--lu-subtle)] md:justify-end"
                            >
                              <InfoIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                              {ADJUSTED_LIST_NOTE}
                            </p>
                          )}
                        </div>

                        <p aria-live="polite" className="sr-only">
                          {listAnnouncement}
                        </p>

                        <div className="flex flex-col gap-4 px-4 py-5 sm:px-6">
                          {(reportedWords.size > 0 ||
                            negatedFindings.length > 0 ||
                            questionFindings.present.length > 0 ||
                            questionFindings.absent.length > 0) && (
                            <div className="flex flex-col gap-2 border-b border-[var(--lu-border)] pb-4">
                              <p className="text-xs font-semibold text-[var(--lu-text)]">
                                Lo que nos contaste
                              </p>
                              <ul className="flex flex-wrap gap-1.5">
                                {[...reportedWords.entries()].map(([code, said]) => (
                                  <li key={code}>
                                    <HpoLink
                                      code={code}
                                      className="inline-block rounded-full border border-[var(--lu-border)] bg-[var(--lu-surface)] px-2.5 py-1 text-xs text-[var(--lu-text)] hover:border-[var(--lu-accent-light)] hover:underline"
                                    >
                                      {said}
                                      <span aria-hidden="true" className="ml-1 text-[10px] text-[var(--lu-accent-text)]">↗</span>
                                    </HpoLink>
                                  </li>
                                ))}
                                {questionFindings.present.map((finding) => (
                                  <li key={finding.code} data-from-questions>
                                    <HpoLink
                                      code={finding.code}
                                      className="inline-block rounded-full border border-dashed border-[var(--lu-accent-text)] bg-white px-2.5 py-1 text-xs text-[var(--lu-text)] hover:underline"
                                    >
                                      {finding.label}
                                      <span className="whitespace-nowrap text-[var(--lu-subtle)]"> · de las preguntas</span>
                                      <span aria-hidden="true" className="ml-1 text-[10px] text-[var(--lu-accent-text)]">↗</span>
                                    </HpoLink>
                                  </li>
                                ))}
                              </ul>
                              {(negatedFindings.length > 0 || questionFindings.absent.length > 0) && (
                                <p className="text-xs text-[var(--lu-subtle)]">
                                  <span className="font-semibold text-[var(--lu-text)]">No presenta:</span>{" "}
                                  {[
                                    ...negatedFindings.map((finding) => ({ code: finding.code, label: finding.label })),
                                    ...questionFindings.absent.map((finding) => ({
                                      code: finding.code,
                                      label: `${finding.label} (de las preguntas)`,
                                    })),
                                  ].map((finding, index) => (
                                    <span key={finding.code}>
                                      {index > 0 && " · "}
                                      <HpoLink code={finding.code} className="hover:underline">
                                        {finding.label}
                                      </HpoLink>
                                    </span>
                                  ))}
                                  .{" "}
                                  {/* /rank-genes takes present phenotypes only,
                                      and the agent now sends it only the
                                      findings answered «Sí». */}
                                  Quedan registrados para la consulta; hoy no cambian el orden de ninguna lista.
                                </p>
                              )}
                              <p className="text-xs text-[var(--lu-subtle)]">
                                Tocá un síntoma para ver su ficha en la ontología HPO (en inglés).
                              </p>
                            </div>
                          )}

                          <ResultsDownload
                            input={() => ({
                              date: new Date(),
                              patient: {
                                name: datosBasicos.nombre,
                                birthDate: datosBasicos.fechaNacimiento || null,
                                sex: datosBasicos.sexo || null,
                              },
                              clinicalText: historiaClinica,
                              symptoms: symptoms.map((symptom) => ({
                                label: symptom.description,
                                code: symptom.code,
                                onset: symptom.onset ?? null,
                                source: symptom.source,
                              })),
                              negated: negatedFindings,
                              answers: {
                                yes: questionSession.state.history.filter((item) => item.effectiveAnswer === "si").map((item) => item.question.label),
                                no: questionSession.state.history.filter((item) => item.effectiveAnswer === "no").map((item) => item.question.label),
                                unsure: questionSession.state.history.filter((item) => item.effectiveAnswer === "no_se").map((item) => item.question.label),
                              },
                              genes: visibleGeneResults.map((gene) => {
                                const symbol = gene.gene_symbol || gene.gene_id;
                                return { symbol, summary: geneProfiles.get(symbol.toUpperCase())?.resumen_es ?? null };
                              }),
                              adjustedByAnswers: showingRefined,
                              specialties: especialidadesParaConsultar(visibleSpecialties?.top_specialties ?? []),
                            })}
                          />

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

                          {profilesFailed && (
                            <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
                              No pudimos cargar las descripciones de los genes. La lista no cambia; recargá la página
                              para intentarlo de nuevo.
                            </p>
                          )}

                          {refineEntries && (
                            <RefineTeaser phase={questionSession.state.phase} control={questionPanel} />
                          )}

                          {/* The model's own order, ungrouped. Splitting the
                              ranking put the top-scoring genes below a fold
                              and made a gene with no symptom overlap look
                              like an apology; the overlap is already on every
                              card, so it does not need a heading too. */}
                          <ul
                            ref={geneListRef}
                            data-gene-grid
                            className={`relative grid gap-4 sm:grid-cols-2 ${panelDocked ? "" : "xl:grid-cols-3"}`}
                          >
                            {orderedGenes.map(({ gene, rank, symbol }) => (
                              <GeneOverviewCard
                                key={gene.gene_id}
                                symbol={symbol}
                                rank={rank}
                                total={visibleGeneResults.length}
                                score={Number(gene.score)}
                                listOrigin={
                                  refinedOrigins ? { from: refinedOrigins.get(symbol.toUpperCase()) ?? null } : null
                                }
                                profile={geneProfiles.get(symbol.toUpperCase()) ?? null}
                                professional={professionalView}
                                reportedWords={matchedWords}
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
                          reportedWords={matchedWords}
                          listOrigins={refinedOrigins}
                        />
                      </div>
                    )}

                    {!genphenError && !isLowConfidenceResult && (
                      <SpecialtyCard
                        specialties={visibleSpecialties}
                        geneCount={visibleGeneResults.length}
                        rankedSymbols={rankedSymbols}
                        onOpenGene={setSelectedSymbol}
                      />
                    )}

                    {!genphenError && symptoms.some((symptom) => symptom.onset) && (
                      <section
                        data-onset-report
                        aria-labelledby="sintomas-informados-titulo"
                        className="rounded-2xl border border-[var(--lu-border)] bg-white px-5 py-4"
                      >
                        <h3 id="sintomas-informados-titulo" className="text-[15px] font-semibold text-[var(--lu-text)]">
                          Síntomas informados
                        </h3>
                        <ul className="mt-2 flex flex-col gap-1 text-sm text-[var(--lu-text)]">
                          {symptoms.map((symptom) => (
                            <li key={symptom.code} className="break-words">
                              <span className="font-medium">{symptom.description}</span>{" "}
                              <OnsetInline onset={symptom.onset} />
                            </li>
                          ))}
                        </ul>
                        <OnsetSummary
                          symptoms={symptoms.map((s) => ({ label: s.description, onset: s.onset }))}
                          className="mt-3 border-t border-[var(--lu-border)] pt-3"
                        />
                      </section>
                    )}

                    {disclaimer}

                    <div className="flex flex-wrap gap-3">
                      <button
                        type="button"
                        className="inline-flex items-center justify-center h-11 px-6 rounded-xl border border-[var(--lu-border)] text-[var(--lu-subtle)] font-medium hover:bg-[var(--lu-surface)] hover:text-[var(--lu-text)] transition-colors"
                        onClick={() => router.push("/diagnosticar")}
                      >
                        Guardar y cerrar
                      </button>
                      <button
                        type="button"
                        className="inline-flex items-center justify-center h-11 px-6 rounded-xl bg-[var(--lu-green)] text-white font-bold hover:bg-[color-mix(in_oklab,var(--lu-green)_90%,#000)] shadow-md transition-all"
                        onClick={() => router.push("/diagnosticar?tab=integrantes")}
                      >
                        Comenzar otra búsqueda
                      </button>
                    </div>

                  </div>
                  {refineOnScreen && (
                    <QuestionSidePanel
                      control={questionPanel}
                      state={questionSession.state}
                      disclaimer={RESULTS_DISCLAIMER}
                      onSeeList={showUpdatedList}
                      body={{
                        professional: professionalView,
                        drafts: questionSession.drafts,
                        onDraft: questionSession.updateDraft,
                        pendingSince: questionSession.pendingSince,
                        onStart: () => questionSession.start(questionMode),
                        onSubmit: (drafts) => questionSession.submit(questionMode, drafts),
                        onFinish: (drafts) => questionSession.finish(questionMode, drafts),
                        onRetry: () => questionSession.retry(questionMode),
                        originalGenes: originalSymbols,
                        symptoms: symptoms.map((s) => ({ label: s.description, onset: s.onset })),
                        showAdjusted: showingRefined,
                        geneRanks,
                        onOpenGene: setSelectedSymbol,
                      }}
                    />
                  )}
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
                  {step === 1 && (
                    <button
                      type="button"
                      onClick={omitirDatosBasicos}
                      className="inline-flex h-11 items-center justify-center rounded-xl px-5 font-semibold text-[var(--lu-subtle)] transition-colors hover:bg-[var(--lu-surface)] hover:text-[var(--lu-text)]"
                    >
                      Omitir este paso
                    </button>
                  )}
                  {step < 3 && (
                  <button
                    type="button"
                    className="inline-flex items-center justify-center h-11 px-8 rounded-xl bg-[var(--lu-green)] text-white font-bold hover:bg-[color-mix(in_oklab,var(--lu-green)_90%,#000)] shadow-md transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none"
                    onClick={handleContinue}
                    disabled={
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

      {refineEntries && <QuestionLauncher control={questionPanel} />}

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

            {negatedFindings.length > 0 && (
              <p className="mt-3 text-sm leading-relaxed text-[var(--lu-subtle)]">
                <span className="font-semibold text-[var(--lu-text)]">No presenta</span>, según el
                texto, y no se usa en la búsqueda:{" "}
                {negatedFindings.map((finding) => finding.label).join(", ")}.
              </p>
            )}

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
            <h2 className="text-xl font-bold text-[var(--lu-text)]">¿Salir de esta búsqueda?</h2>
            <p className="mt-3 text-sm text-[var(--lu-subtle)]">
              {step === 3
                ? "Los resultados ya quedaron guardados en tu cuenta."
                : "Se va a perder lo que cargaste en esta búsqueda."}
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
                Salir
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
