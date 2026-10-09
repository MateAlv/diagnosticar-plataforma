/**
 * What the model may use about the patient besides the symptoms: sex, age and
 * age at onset, as the optional fields of /rank-genes. Each is left out when
 * it is not known, so a search with none of them is the request it always was.
 *
 * The onset is the earliest exact age given in «Precisar». A range alone is
 * not sent: the model was trained with exact ages only.
 */

import { earliestOnset, type SymptomOnset } from "./onset";

export type ModelCaseFields = { sex?: "male" | "female"; age_years?: number; onset_years?: number };

const SEX: Record<string, "male" | "female"> = { masculino: "male", femenino: "female" };
const DAY_MS = 86_400_000;

/** Age in years, to the day, from a `YYYY-MM-DD` birth date; null for a missing, unreadable or future one. */
export function ageInYears(birthDate: string | null | undefined, now: Date = new Date()): number | null {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(birthDate ?? "");
    if (!match) return null;
    const born = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    if (Number.isNaN(born) || born > today) return null;
    return Math.round(((today - born) / DAY_MS / 365.25) * 100) / 100;
}

export function modelCaseFields(
    patient: { sexo?: string | null; fechaNacimiento?: string | null },
    symptoms: readonly { code: string; onset?: SymptomOnset | null }[],
    now: Date = new Date(),
): ModelCaseFields {
    const fields: ModelCaseFields = {};
    const sex = SEX[(patient.sexo ?? "").trim().toLowerCase()];
    if (sex) fields.sex = sex;
    const age = ageInYears(patient.fechaNacimiento, now);
    if (age !== null) fields.age_years = age;
    const onset = earliestOnset(symptoms)?.age_years ?? null;
    if (onset !== null) fields.onset_years = onset;
    return fields;
}
