"use client";

import { useEffect, useId, useState } from "react";
import { ageText, formatDmy, maskDmy, readDmy } from "@/lib/patient-age";

/**
 * «Fecha de nacimiento», typed as DD/MM/AAAA with the slashes put in as the
 * digits go. No calendar: picking a birth date decades back in one is slow,
 * and typing it is what people already know. Below it, the age it gives, so a
 * typo in the year shows at once.
 *
 * `value` is `YYYY-MM-DD`, or empty while the date is missing or incomplete.
 */
export function BirthDateInput({ value, onChange }: { value: string; onChange: (iso: string) => void }) {
    const id = useId();
    const hintId = `${id}-hint`;
    const [text, setText] = useState(() => formatDmy(value));
    const [touched, setTouched] = useState(false);

    // A value set from outside (a restored draft, «Omitir este paso») replaces
    // what is on screen; a half-typed date is left alone.
    useEffect(() => {
        const shown = readDmy(text);
        const shownIso = "iso" in shown ? shown.iso : "";
        if (value === shownIso) return;
        if (value) setText(formatDmy(value));
        else if (shownIso) setText("");
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value]);

    const check = readDmy(text);
    const error = "error" in check ? check.error : touched && text && "incomplete" in check ? "Completá la fecha: DD/MM/AAAA." : null;
    const age = "iso" in check ? ageText(check.iso) : null;

    const type = (raw: string) => {
        const next = maskDmy(raw);
        setText(next);
        const read = readDmy(next);
        onChange("iso" in read ? read.iso : "");
    };

    return (
        <div>
            <label htmlFor={id} className="block text-sm font-bold text-[var(--lu-text)]">
                Fecha de nacimiento <span className="font-normal text-[var(--lu-subtle)]">(opcional)</span>
            </label>
            <input
                id={id}
                type="text"
                inputMode="numeric"
                autoComplete="bday"
                placeholder="DD/MM/AAAA"
                maxLength={10}
                value={text}
                onChange={(event) => type(event.target.value)}
                onBlur={() => setTouched(true)}
                aria-invalid={error ? true : undefined}
                aria-describedby={hintId}
                className={[
                    "mt-2 w-full rounded-xl border bg-white px-4 py-3 tabular-nums text-[var(--lu-text)] transition-all focus:outline-none focus:ring-2",
                    error
                        ? "border-red-300 focus:border-red-400 focus:ring-red-100"
                        : "border-[var(--lu-border)] focus:border-[var(--lu-accent)] focus:ring-[var(--lu-accent-light)]",
                ].join(" ")}
            />
            <p
                id={hintId}
                aria-live="polite"
                className={`mt-1.5 text-xs ${error ? "font-medium text-red-700" : "text-[var(--lu-subtle)]"}`}
            >
                {error ?? (age ? `Edad: ${age}` : "Por ejemplo, 03/04/2018.")}
            </p>
        </div>
    );
}
