/**
 * Postgres rejects U+0000 in `text` columns and in `jsonb` values alike
 * ("unsupported Unicode escape sequence"). Clinical history is pasted from
 * PDFs, OCR output and hospital systems, all of which produce stray NUL bytes,
 * so an unsanitised payload turns a routine paste into a 500.
 *
 * Stripping is the right call rather than rejecting: the byte carries no
 * meaning, and refusing the whole record would lose the patient's text.
 */
/* eslint-disable no-control-regex -- matching U+0000 is the entire purpose here */
export function stripNullBytes<T>(value: T): T {
    if (typeof value === 'string') {
        return value.replace(/\u0000/g, '') as T;
    }
    if (Array.isArray(value)) {
        return value.map((item) => stripNullBytes(item)) as T;
    }
    if (value !== null && typeof value === 'object') {
        const out: Record<string, unknown> = {};
        for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
            // Keys reach jsonb too, so they need the same treatment.
            out[key.replace(/\u0000/g, '')] = stripNullBytes(nested);
        }
        return out as T;
    }
    return value;
}
