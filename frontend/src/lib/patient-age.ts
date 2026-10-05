/**
 * The patient's age, as the wizard asks for it, and the birth date it is kept
 * as.
 *
 * Families give an age, not a date. It is stored as the birth date that age
 * implies on the day of the search, so the age keeps counting when the member
 * is searched again later, and everything that reads a birth date (the onset
 * limits, the summary) works unchanged. The day is approximate by design.
 */

export type PatientAge = { years: number; months: number };

export const MAX_AGE_YEARS = 120;

function pad(n: number): string {
    return String(n).padStart(2, "0");
}

/** Whole years and months on `now`; null for a missing, unreadable or future date. */
export function ageFromBirthDate(birthDate: string | null | undefined, now: Date = new Date()): PatientAge | null {
    if (!birthDate || !/^\d{4}-\d{2}-\d{2}/.test(birthDate)) return null;
    const [y, m, d] = birthDate.slice(0, 10).split("-").map(Number);
    const born = new Date(y, m - 1, d);
    if (Number.isNaN(born.getTime()) || born > now) return null;
    let months = (now.getFullYear() - y) * 12 + (now.getMonth() - (m - 1));
    if (now.getDate() < d) months -= 1;
    months = Math.max(0, months);
    return { years: Math.floor(months / 12), months: months % 12 };
}

/** The `YYYY-MM-DD` birth date that makes the patient `age` old on `now`. */
export function birthDateFromAge(age: PatientAge, now: Date = new Date()): string {
    const total = age.years * 12 + age.months;
    const year = now.getFullYear() + Math.floor((now.getMonth() - total) / 12);
    const month = (((now.getMonth() - total) % 12) + 12) % 12;
    const lastDay = new Date(year, month + 1, 0).getDate();
    return `${year}-${pad(month + 1)}-${pad(Math.min(now.getDate(), lastDay))}`;
}

/** "7 años y 3 meses", "5 meses", "Menos de 1 mes". */
export function ageLabel(age: PatientAge): string {
    const years = age.years === 1 ? "1 año" : `${age.years} años`;
    const months = age.months === 1 ? "1 mes" : `${age.months} meses`;
    if (age.years === 0 && age.months === 0) return "Menos de 1 mes";
    if (age.years === 0) return months;
    if (age.months === 0) return years;
    return `${years} y ${months}`;
}
