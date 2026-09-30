// The specialty to consult, as a family would ask for a referral in Argentina.
//
// The model's post-processing names PanelApp's categories in English
// (specialist_recommendation.py in diagnostic.ar-api, SPECIALTY_CANONICAL):
// Audiology, Cancer, Gastrohepatology, Growth disorders, Haematology,
// Respiratory, ... Every one of them is mapped here, plus PanelApp's raw
// labels and older names, because an untranslated name used to reach the
// screen as it came. A name that is not a specialty anyone can be referred to
// is dropped, and so is any name not listed: an English label is never shown.

export const ESPECIALIDADES_ES: Record<string, string> = {
  // What the model's post-processing returns today.
  "audiology": "Otorrinolaringología (audición)",
  "cancer": "Oncología",
  "cardiology": "Cardiología",
  "dermatology": "Dermatología",
  "developmental disorders": "Neuropediatría (neurodesarrollo)",
  "endocrinology": "Endocrinología",
  "gastrohepatology": "Gastroenterología y hepatología",
  "growth disorders": "Endocrinología (crecimiento)",
  "haematology": "Hematología",
  "immunology": "Inmunología",
  "metabolic": "Enfermedades metabólicas",
  "musculoskeletal": "Traumatología y ortopedia",
  "neurology": "Neurología",
  "ophthalmology": "Oftalmología",
  "renal": "Nefrología",
  "respiratory": "Neumonología",
  "ultra-rare disorders": "Genética médica",

  // PanelApp's own labels, should a caller pass them through uncanonicalised.
  "cancer programme": "Oncología",
  "cancer susceptibility": "Oncología",
  "inherited cancer": "Oncología",
  "tumour syndromes": "Oncología",
  "cardiovascular disorders": "Cardiología",
  "ciliopathies": "Genética médica",
  "dermatological disorders": "Dermatología",
  "dysmorphic and congenital abnormality syndromes": "Genética médica",
  "endocrine disorders": "Endocrinología",
  "fetal (including nipd)": "Genética médica",
  "gastroenterological disorders": "Gastroenterología y hepatología",
  "haematological disorders": "Hematología",
  "haematological and immunological disorders": "Hematología e inmunología",
  "hearing and ear disorders": "Otorrinolaringología (audición)",
  "lipids": "Endocrinología (lípidos)",
  "metabolic disorders": "Enfermedades metabólicas",
  "mitochondrial": "Enfermedades metabólicas (mitocondriales)",
  "neurology and neurodevelopmental disorders": "Neurología",
  "ophthalmological disorders": "Oftalmología",
  "renal and urinary tract disorders": "Nefrología",
  "respiratory disorders": "Neumonología",
  "rheumatological disorders": "Reumatología",
  "skeletal disorders": "Traumatología y ortopedia",

  // Older names still stored in saved searches and used by the mocks.
  "hematology": "Hematología",
  "gastroenterology": "Gastroenterología",
  "pulmonology": "Neumonología",
  "oncology": "Oncología",
  "otolaryngology": "Otorrinolaringología",
  "psychiatry": "Psiquiatría",
  "rheumatology": "Reumatología",
  "urology": "Urología",
  "gynecology": "Ginecología",
  "craniofacial": "Cirugía craneofacial",
};

/**
 * Categories that are not somewhere a person can be referred to: a panel
 * spanning many specialties, a research panel, or no category at all.
 */
const NO_CONSULTABLES = new Set(["multispecialty", "viral research", "unknown", ""]);

/** The Spanish name, or null when it is not a specialty to consult or not known. */
export function traducirEspecialidad(nombre: string): string | null {
  const clave = nombre.trim().toLowerCase();
  if (NO_CONSULTABLES.has(clave)) return null;
  return ESPECIALIDADES_ES[clave] ?? null;
}

/**
 * The specialties to show, in the order given, translated, without the ones
 * that are not consultable and without repeats (several categories map to
 * the same specialty, e.g. "Ultra-rare disorders" and "Ciliopathies" are both
 * Genética médica).
 */
export function especialidadesParaConsultar(nombres: readonly string[]): string[] {
  const vistas = new Set<string>();
  const resultado: string[] = [];
  for (const nombre of nombres) {
    const es = traducirEspecialidad(nombre);
    if (es && !vistas.has(es)) {
      vistas.add(es);
      resultado.push(es);
    }
  }
  return resultado;
}
