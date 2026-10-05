/**
 * When a symptom began, as the HPO "age of onset" classes.
 *
 * The boundaries are the ones in the HPO definitions (hp-base.json):
 * antenatal "prior to birth", congenital "present at birth", neonatal "within
 * the first 28 days", infantile "28 days to one year", childhood "1 to 5
 * years", juvenile "5 to 15 years", young adult "16 to 40", middle age "40 to
 * 60", late "after 60". HPO leaves the span between 15 and 16 unassigned; here
 * it belongs to juvenile, so every age falls in exactly one class.
 *
 * Onset is optional everywhere. It is stored per symptom, and the earliest one
 * is sent to the model service as extra fields it may ignore.
 */

export type SymptomOnset = {
    /** HPO onset class. */
    hpo_id: string;
    /** Exact age in years when the person gave one. */
    age_years: number | null;
};

export type OnsetClass = {
    hpo_id: string;
    /** Plain-language chip text. */
    label: string;
    /** HPO label, for screen readers and logs. */
    hpo_label: string;
    /** First age (in years) that belongs to the class. */
    from_years: number;
};

const DAYS_PER_YEAR = 365.2425;
const NEONATAL_END_YEARS = 28 / DAYS_PER_YEAR;

export const ONSET_CLASSES: readonly OnsetClass[] = [
    { hpo_id: "HP:0030674", label: "Antes de nacer", hpo_label: "Antenatal onset", from_years: Number.NEGATIVE_INFINITY },
    { hpo_id: "HP:0003577", label: "Al nacer", hpo_label: "Congenital onset", from_years: 0 },
    { hpo_id: "HP:0003623", label: "En el primer mes", hpo_label: "Neonatal onset", from_years: 0 },
    { hpo_id: "HP:0003593", label: "Entre 1 y 12 meses", hpo_label: "Infantile onset", from_years: NEONATAL_END_YEARS },
    { hpo_id: "HP:0011463", label: "Entre 1 y 5 años", hpo_label: "Childhood onset", from_years: 1 },
    { hpo_id: "HP:0003621", label: "Entre 5 y 15 años", hpo_label: "Juvenile onset", from_years: 5 },
    { hpo_id: "HP:0011462", label: "Entre 16 y 40 años", hpo_label: "Young adult onset", from_years: 16 },
    { hpo_id: "HP:0003596", label: "Entre 40 y 60 años", hpo_label: "Middle age onset", from_years: 40 },
    { hpo_id: "HP:0003584", label: "Después de los 60", hpo_label: "Late onset", from_years: 60 },
];

const BY_ID = new Map(ONSET_CLASSES.map((cls, index) => [cls.hpo_id, { cls, index }]));

export function onsetClass(id: string | null | undefined): OnsetClass | null {
    return (id && BY_ID.get(id.toUpperCase())?.cls) || null;
}

/** Where the class sits in time, 0 being the earliest. -1 for an unknown id. */
function rank(id: string): number {
    return BY_ID.get(id.toUpperCase())?.index ?? -1;
}

/**
 * The class an exact age falls in. Zero is "al nacer"; "antes de nacer" has no
 * age, so it is only ever picked as a class. A shared end (1, 5, 40) goes to
 * the later class, and 60 to middle age since "late" is after 60.
 */
export function classForAge(years: number): OnsetClass {
    if (years <= 0) return ONSET_CLASSES[1];
    if (years < NEONATAL_END_YEARS) return ONSET_CLASSES[2];
    if (years < 1) return ONSET_CLASSES[3];
    if (years < 5) return ONSET_CLASSES[4];
    if (years < 16) return ONSET_CLASSES[5];
    if (years < 40) return ONSET_CLASSES[6];
    if (years <= 60) return ONSET_CLASSES[7];
    return ONSET_CLASSES[8];
}

export type AgeUnit = "years" | "months";

/** Years from a number and its unit; null when it is not a usable, non-negative number. */
export function toYears(amount: number, unit: AgeUnit): number | null {
    if (!Number.isFinite(amount) || amount < 0) return null;
    const years = unit === "months" ? amount / 12 : amount;
    return Math.round(years * 1000) / 1000;
}

/** The number and unit to show for an exact age: months under a year, else years. */
export function fromYears(years: number): { amount: number; unit: AgeUnit } {
    if (years < 1) return { amount: Math.round(years * 12), unit: "months" };
    return { amount: Math.round(years * 10) / 10, unit: "years" };
}

/** The patient's age in years on `now`; null for a missing, unreadable or future birth date. */
export function patientAgeYears(birthDate: string | null | undefined, now: Date = new Date()): number | null {
    if (!birthDate || !/^\d{4}-\d{2}-\d{2}/.test(birthDate)) return null;
    const birth = new Date(`${birthDate.slice(0, 10)}T00:00:00Z`);
    if (Number.isNaN(birth.getTime())) return null;
    const years = (now.getTime() - birth.getTime()) / (DAYS_PER_YEAR * 86_400_000);
    return years < 0 ? null : years;
}

/** "Hoy tiene 7 años", "Hoy tiene 5 meses". */
export function ageContext(years: number): string {
    if (years < 1) {
        const months = Math.floor(years * 12);
        return `Hoy tiene ${months} ${months === 1 ? "mes" : "meses"}`;
    }
    const whole = Math.floor(years);
    return `Hoy tiene ${whole} ${whole === 1 ? "año" : "años"}`;
}

/** Whether the class could already have begun at the patient's age. Unknown age allows all. */
export function classAllowed(cls: OnsetClass, patientYears: number | null): boolean {
    return patientYears === null || cls.from_years <= patientYears;
}

/** Whether an exact age is not later than the patient's current age. */
export function ageAllowed(years: number, patientYears: number | null): boolean {
    return patientYears === null || years <= patientYears + 1 / DAYS_PER_YEAR;
}

/** Reads an stored value defensively; anything off becomes "no onset". */
export function parseOnset(raw: unknown): SymptomOnset | null {
    if (!raw || typeof raw !== "object") return null;
    const { hpo_id, age_years } = raw as { hpo_id?: unknown; age_years?: unknown };
    if (typeof hpo_id !== "string" || !onsetClass(hpo_id)) return null;
    const age = typeof age_years === "number" && Number.isFinite(age_years) && age_years >= 0 ? age_years : null;
    return { hpo_id: hpo_id.toUpperCase(), age_years: age };
}

type WithOnset = { code: string; onset?: SymptomOnset | null };

/** The earliest class and the earliest exact age among the symptoms; null when none has onset. */
export function earliestOnset(symptoms: readonly WithOnset[]): SymptomOnset | null {
    let best: string | null = null;
    let age: number | null = null;
    for (const symptom of symptoms) {
        const onset = symptom.onset;
        if (!onset) continue;
        if (best === null || rank(onset.hpo_id) < rank(best)) best = onset.hpo_id;
        if (onset.age_years !== null && (age === null || onset.age_years < age)) age = onset.age_years;
    }
    return best === null ? null : { hpo_id: best, age_years: age };
}

export type OnsetPayloadFields = {
    onset_hpo_id?: string;
    onset_age_years?: number;
    symptom_onsets?: Array<{ hpo_id: string; onset_hpo_id: string; onset_age_years?: number }>;
};

/**
 * The optional onset fields for the /rank-genes request. Empty when no symptom
 * has onset, so the request is then exactly what it was before.
 */
export function onsetPayloadFields(symptoms: readonly WithOnset[]): OnsetPayloadFields {
    const earliest = earliestOnset(symptoms);
    if (!earliest) return {};
    const fields: OnsetPayloadFields = { onset_hpo_id: earliest.hpo_id };
    if (earliest.age_years !== null) fields.onset_age_years = earliest.age_years;
    fields.symptom_onsets = symptoms.flatMap((symptom) => {
        const code = symptom.code.trim().toUpperCase();
        if (!symptom.onset || !/^HP:\d+$/.test(code)) return [];
        const entry: { hpo_id: string; onset_hpo_id: string; onset_age_years?: number } = {
            hpo_id: code,
            onset_hpo_id: symptom.onset.hpo_id,
        };
        if (symptom.onset.age_years !== null) entry.onset_age_years = symptom.onset.age_years;
        return [entry];
    });
    return fields;
}

/** Clean the stored `onset` off a symptom for saving: only when there is one. */
export function onsetForSave(onset: SymptomOnset | null | undefined): { onset: SymptomOnset } | Record<string, never> {
    return onset ? { onset: { hpo_id: onset.hpo_id, age_years: onset.age_years } } : {};
}

/** Ids of the terms whose onset is informative, from the JSON file; empty for a malformed one. */
export function onsetInformativeIds(data: unknown): Set<string> {
    const ids = new Set<string>();
    const terms = (data as { terms?: unknown } | null)?.terms;
    if (!Array.isArray(terms)) return ids;
    for (const term of terms) {
        const id = (term as { hpo_id?: unknown } | null)?.hpo_id;
        if (typeof id === "string" && /^HP:\d{7}$/i.test(id.trim())) ids.add(id.trim().toUpperCase());
    }
    return ids;
}

/**
 * Whether a symptom shows "Precisar": it can be refined or its onset is
 * informative, unless the person dismissed it. A symptom that already has an
 * onset keeps the button so the value can be edited.
 */
export function showsPrecisar(opts: {
    refinable: boolean;
    informative: boolean;
    dismissed: boolean;
    hasOnset: boolean;
}): boolean {
    if (opts.hasOnset) return true;
    return (opts.refinable || opts.informative) && !opts.dismissed;
}

export const ONSET_HINT = "Dato clínico informado por el paciente; no modifica el orden de genes.";

/** "empezó entre 1 y 5 años", or with an exact age "empezó a los 3 años" / "a los 8 meses". */
export function onsetPhrase(onset: SymptomOnset): string {
    const cls = onsetClass(onset.hpo_id);
    if (onset.age_years === null) return cls ? `empezó ${cls.label.toLowerCase()}` : "";
    const { amount, unit } = fromYears(onset.age_years);
    if (unit === "months" && amount === 0) return "empezó al nacer";
    const text = String(amount).replace(".", ",");
    const one = amount === 1;
    if (unit === "months") return one ? "empezó al mes" : `empezó a los ${text} meses`;
    return one ? "empezó al año" : `empezó a los ${text} años`;
}

export type ReportedSymptom = { label: string; onset?: SymptomOnset | null };
type Reported = ReportedSymptom;

/** The symptom whose onset came first; among equals, the one with the earlier exact age. */
function earliestReported<T extends Reported>(symptoms: readonly T[]): (T & { onset: SymptomOnset }) | null {
    let best: (T & { onset: SymptomOnset }) | null = null;
    for (const symptom of symptoms) {
        const onset = symptom.onset;
        if (!onset || rank(onset.hpo_id) < 0) continue;
        const current = best?.onset;
        const earlier =
            !current ||
            rank(onset.hpo_id) < rank(current.hpo_id) ||
            (rank(onset.hpo_id) === rank(current.hpo_id) &&
                onset.age_years !== null &&
                (current.age_years === null || onset.age_years < current.age_years));
        if (earlier) best = symptom as T & { onset: SymptomOnset };
    }
    return best;
}

/** "Inicio de los síntomas: entre 1 y 5 años (Convulsiones)"; null when no symptom has onset. */
export function onsetSummaryLine(symptoms: readonly Reported[]): string | null {
    const first = earliestReported(symptoms);
    if (!first) return null;
    const phrase = onsetPhrase(first.onset).replace(/^empezó /, "");
    return `Inicio de los síntomas: ${phrase} (${first.label})`;
}

/** "Convulsiones · empezó entre 1 y 5 años"; just the label when there is no onset. */
export function symptomWithOnset(symptom: Reported): string {
    const phrase = symptom.onset && onsetClass(symptom.onset.hpo_id) ? onsetPhrase(symptom.onset) : "";
    return phrase ? `${symptom.label} · ${phrase}` : symptom.label;
}

/** The report lines for plain text: the summary line, the symptoms with onset and the hint. Empty when none. */
export function onsetReportLines(symptoms: readonly Reported[]): string[] {
    const line = onsetSummaryLine(symptoms);
    if (!line) return [];
    return [line, ...symptoms.filter((s) => s.onset).map((s) => `- ${symptomWithOnset(s)}`), ONSET_HINT];
}
