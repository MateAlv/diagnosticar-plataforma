"use client";

import { useId } from "react";
import { MAX_AGE_YEARS, ageLabel, type PatientAge } from "@/lib/patient-age";

/**
 * "Edad": years and months, each with its own stepper and a field to type in.
 * Optional; empty until the first step or keystroke. Months roll over into
 * years in both directions, so a stepper never stalls at 11 or 0.
 */

type Props = {
    value: PatientAge | null;
    onChange: (next: PatientAge | null) => void;
};

function clamp(total: number): PatientAge {
    const bounded = Math.min(Math.max(total, 0), MAX_AGE_YEARS * 12 + 11);
    return { years: Math.floor(bounded / 12), months: bounded % 12 };
}

function Stepper({
    label,
    unit,
    shown,
    onStep,
    onType,
    canDecrease,
    canIncrease,
}: {
    label: string;
    unit: string;
    shown: string;
    onStep: (delta: number) => void;
    onType: (raw: string) => void;
    canDecrease: boolean;
    canIncrease: boolean;
}) {
    const id = useId();
    const button =
        "grid h-11 w-11 shrink-0 place-items-center rounded-lg text-xl leading-none text-[var(--lu-text)] transition-colors hover:bg-[var(--lu-accent-light)] disabled:cursor-not-allowed disabled:text-[var(--lu-border-strong)] disabled:hover:bg-transparent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--lu-accent)]";
    return (
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <label htmlFor={id} className="text-xs font-semibold uppercase tracking-wide text-[var(--lu-subtle)]">
                {label}
            </label>
            <div className="flex items-center gap-1 rounded-xl border border-[var(--lu-border)] bg-white p-1 focus-within:border-[var(--lu-accent)] focus-within:ring-2 focus-within:ring-[var(--lu-accent-light)]">
                <button type="button" className={button} onClick={() => onStep(-1)} disabled={!canDecrease} aria-label={`Restar un ${unit}`}>
                    −
                </button>
                <input
                    id={id}
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    value={shown}
                    placeholder="—"
                    onChange={(event) => onType(event.target.value)}
                    size={3}
                    className="w-0 min-w-0 flex-1 bg-transparent text-center text-xl font-semibold tabular-nums text-[var(--lu-text)] placeholder:text-[var(--lu-border-strong)] focus:outline-none"
                />
                <button type="button" className={button} onClick={() => onStep(1)} disabled={!canIncrease} aria-label={`Sumar un ${unit}`}>
                    +
                </button>
            </div>
        </div>
    );
}

export function AgePicker({ value, onChange }: Props) {
    const titleId = useId();
    const summaryId = useId();
    const total = value ? value.years * 12 + value.months : null;

    const step = (deltaMonths: number) => onChange(clamp((total ?? 0) + deltaMonths));

    const type = (raw: string, part: "years" | "months") => {
        const digits = raw.replace(/\D/g, "").slice(0, 3);
        const current = value ?? { years: 0, months: 0 };
        if (digits === "") {
            const rest = part === "years" ? current.months : current.years;
            onChange(value && rest > 0 ? { ...current, [part]: 0 } : null);
            return;
        }
        const n = Number(digits);
        const next = part === "years" ? { ...current, years: Math.min(n, MAX_AGE_YEARS) } : clamp(current.years * 12 + n);
        onChange(next);
    };

    return (
        <div role="group" aria-labelledby={titleId} aria-describedby={summaryId} data-testid="age-picker">
            <div className="mb-2 flex items-baseline justify-between gap-3">
                <span id={titleId} className="block text-sm font-bold text-[var(--lu-text)]">
                    Edad <span className="font-normal text-[var(--lu-subtle)]">(opcional)</span>
                </span>
                {value && (
                    <button
                        type="button"
                        onClick={() => onChange(null)}
                        className="text-xs font-semibold text-[var(--lu-accent-text)] underline-offset-2 hover:underline"
                    >
                        Borrar
                    </button>
                )}
            </div>
            <div className="flex min-w-0 gap-3">
                <Stepper
                    label="Años"
                    unit="año"
                    shown={value ? String(value.years) : ""}
                    onStep={(delta) => step(delta * 12)}
                    onType={(raw) => type(raw, "years")}
                    canDecrease={total !== null && total >= 12}
                    canIncrease={total === null || value!.years < MAX_AGE_YEARS}
                />
                <Stepper
                    label="Meses"
                    unit="mes"
                    shown={value ? String(value.months) : ""}
                    onStep={step}
                    onType={(raw) => type(raw, "months")}
                    canDecrease={total !== null && total > 0}
                    canIncrease={total === null || total < MAX_AGE_YEARS * 12 + 11}
                />
            </div>
            <p id={summaryId} aria-live="polite" className="mt-1.5 text-xs text-[var(--lu-subtle)]">
                {value ? ageLabel(value) : "Sin indicar. Para bebés, alcanza con los meses."}
            </p>
        </div>
    );
}
