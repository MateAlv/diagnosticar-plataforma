/**
 * The patient's birth date, typed as DD/MM/AAAA and kept as `YYYY-MM-DD`, and
 * the age it gives, shown the way clinical records show it: in days for a
 * newborn, in months up to two years, in years after that. An adult never
 * sees months.
 */

export const MAX_AGE_YEARS = 120;

function pad(n: number): string {
    return String(n).padStart(2, "0");
}

/** Digits typed so far, with the slashes put in as they go: "0304201" → "03/04/201". */
export function maskDmy(raw: string): string {
    const digits = raw.replace(/\D/g, "").slice(0, 8);
    if (digits.length <= 2) return digits;
    if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
    return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

export type DateCheck = { iso: string } | { error: string } | { incomplete: true };

/** Reads a complete DD/MM/AAAA: a real calendar day, not in the future, within a lifetime. */
export function readDmy(text: string, now: Date = new Date()): DateCheck {
    const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text.trim());
    if (!match) return { incomplete: true };
    const [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
    const date = new Date(y, m - 1, d);
    if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) {
        return { error: "Esa fecha no existe. Revisá el día y el mes." };
    }
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (date > today) return { error: "La fecha de nacimiento no puede ser posterior a hoy." };
    if (now.getFullYear() - y > MAX_AGE_YEARS) return { error: "Revisá el año." };
    return { iso: `${y}-${pad(m)}-${pad(d)}` };
}

/** `YYYY-MM-DD` → "DD/MM/AAAA"; empty for anything else. */
export function formatDmy(iso: string | null | undefined): string {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
    return match ? `${match[3]}/${match[2]}/${match[1]}` : "";
}

/** "12 días", "8 meses", "7 años"; null for a missing, unreadable or future date. */
export function ageText(birthDate: string | null | undefined, now: Date = new Date()): string | null {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(birthDate ?? "");
    if (!match) return null;
    const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
    const born = new Date(y, m - 1, d);
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (Number.isNaN(born.getTime()) || born > today) return null;

    let months = (now.getFullYear() - y) * 12 + (now.getMonth() - (m - 1));
    if (now.getDate() < d) months -= 1;
    if (months < 1) {
        const days = Math.round((today.getTime() - born.getTime()) / 86_400_000);
        return days === 1 ? "1 día" : `${days} días`;
    }
    if (months < 24) return months === 1 ? "1 mes" : `${months} meses`;
    const years = Math.floor(months / 12);
    return `${years} años`;
}
