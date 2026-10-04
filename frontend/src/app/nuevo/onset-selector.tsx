"use client";

import { useEffect, useId, useState } from "react";
import {
    ONSET_CLASSES,
    ageAllowed,
    ageContext,
    classAllowed,
    classForAge,
    fromYears,
    onsetClass,
    patientAgeYears,
    toYears,
    type AgeUnit,
    type SymptomOnset,
} from "@/lib/onset";

/**
 * "¿A qué edad empezó este síntoma?" Optional, and never blocks anything.
 *
 * The quick picks are the HPO onset classes in plain words; the exact age is a
 * second way to say the same thing and selects the matching pick. The classes
 * are native radio buttons, so a keyboard moves between them with the arrows
 * and a screen reader announces "3 de 10" and which one is chosen. With a known
 * birth date, picks that start after the patient's current age are disabled,
 * and an exact age beyond it is refused with the reason.
 */

type Props = {
    value: SymptomOnset | null;
    onChange: (next: SymptomOnset | null) => void;
    /** `YYYY-MM-DD`, when the wizard has it. */
    birthDate?: string | null;
    /** Overridable so the age limits can be tested on a fixed day. */
    now?: Date;
    /** The symptom's name, for the group's accessible description. */
    symptomName?: string;
};

const UNKNOWN = "unknown";

export function OnsetSelector({ value, onChange, birthDate, now, symptomName }: Props) {
    const uid = useId();
    const patientYears = patientAgeYears(birthDate, now);

    const initial = value?.age_years != null ? fromYears(value.age_years) : null;
    const [amount, setAmount] = useState(initial ? String(initial.amount) : "");
    const [unit, setUnit] = useState<AgeUnit>(initial?.unit ?? "years");
    const [error, setError] = useState<string | null>(null);

    // A value that arrives from outside (another symptom opened, onset cleared)
    // replaces what is typed; typing itself never loops back through here.
    const externalAge = value?.age_years ?? null;
    useEffect(() => {
        if (externalAge === null) {
            setAmount((current) => (error ? current : ""));
            return;
        }
        const typed = toYears(Number(amount.replace(",", ".")), unit);
        if (amount.trim() !== "" && typed === externalAge) return;
        const shown = fromYears(externalAge);
        setAmount(String(shown.amount));
        setUnit(shown.unit);
        setError(null);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [externalAge]);

    const choose = (id: string) => {
        setError(null);
        if (id === UNKNOWN) {
            setAmount("");
            onChange(null);
            return;
        }
        // An exact age that no longer fits the chosen class is dropped, not kept beside it.
        const keepAge = value?.age_years != null && classForAge(value.age_years).hpo_id === id;
        if (!keepAge) setAmount("");
        onChange({ hpo_id: id, age_years: keepAge ? value!.age_years : null });
    };

    const typeAge = (nextAmount: string, nextUnit: AgeUnit) => {
        setAmount(nextAmount);
        setUnit(nextUnit);
        if (nextAmount.trim() === "") {
            setError(null);
            if (value?.age_years != null) onChange({ hpo_id: value.hpo_id, age_years: null });
            return;
        }
        const years = toYears(Number(nextAmount.replace(",", ".")), nextUnit);
        if (years === null) {
            setError("Escribí una edad con números, por ejemplo 3.");
            return;
        }
        if (!ageAllowed(years, patientYears)) {
            setError(`No puede ser más que la edad actual. ${ageContext(patientYears ?? 0)}.`);
            return;
        }
        setError(null);
        onChange({ hpo_id: classForAge(years).hpo_id, age_years: years });
    };

    const selected = value ? onsetClass(value.hpo_id)?.hpo_id ?? UNKNOWN : UNKNOWN;
    const hintId = `${uid}-hint`;
    const errorId = `${uid}-error`;
    const amountId = `${uid}-amount`;
    const someDisabled = ONSET_CLASSES.some((cls) => !classAllowed(cls, patientYears));

    return (
        <div data-testid="onset-selector">
            <fieldset aria-describedby={hintId} className="min-w-0">
                <legend className="text-sm font-semibold text-[var(--lu-text)]">
                    ¿A qué edad empezó este síntoma?{" "}
                    <span className="font-normal text-[var(--lu-subtle)]">(opcional)</span>
                </legend>
                <p id={hintId} className="mb-2 mt-0.5 text-xs leading-relaxed text-[var(--lu-subtle)]">
                    {patientYears !== null && <strong className="font-semibold">{ageContext(patientYears)}. </strong>}
                    Elegí la opción que más se acerque
                    {symptomName ? <span className="sr-only"> para {symptomName}</span> : null}. Si no estás seguro, «No sé».
                    {someDisabled ? " Las edades mayores que la actual no se pueden elegir." : ""}
                </p>
                <div role="radiogroup" aria-label="Edad de inicio" className="flex flex-wrap gap-2">
                    {[...ONSET_CLASSES.map((cls) => ({ id: cls.hpo_id, label: cls.label, cls })), { id: UNKNOWN, label: "No sé", cls: null }].map(
                        ({ id, label, cls }) => {
                            const disabled = cls ? !classAllowed(cls, patientYears) : false;
                            const checked = selected === id;
                            return (
                                <label
                                    key={id}
                                    className={[
                                        "relative inline-flex min-h-[44px] cursor-pointer items-center rounded-full border px-3.5 text-sm font-medium transition-colors",
                                        "focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--lu-accent)]",
                                        disabled
                                            ? "cursor-not-allowed border-[var(--lu-border)] bg-[var(--lu-surface)] text-[var(--lu-subtle)] line-through decoration-[var(--lu-border-strong)]"
                                            : checked
                                              ? "border-[var(--lu-accent-text)] bg-[var(--lu-accent-text)] text-white"
                                              : "border-[var(--lu-border-strong)] bg-white text-[var(--lu-text)] hover:border-[var(--lu-accent)] hover:bg-[var(--lu-accent-light)]/40",
                                    ].join(" ")}
                                >
                                    <input
                                        type="radio"
                                        name={`${uid}-onset`}
                                        value={id}
                                        checked={checked}
                                        disabled={disabled}
                                        onChange={() => choose(id)}
                                        className="absolute inset-0 h-full w-full cursor-[inherit] opacity-0"
                                    />
                                    <span>{label}</span>
                                </label>
                            );
                        },
                    )}
                </div>
            </fieldset>

            <div className="mt-4">
                <label htmlFor={amountId} className="text-sm font-semibold text-[var(--lu-text)]">
                    Edad exacta <span className="font-normal text-[var(--lu-subtle)]">(opcional)</span>
                </label>
                <div className="mt-1.5 flex items-center gap-2">
                    <input
                        id={amountId}
                        type="text"
                        inputMode="decimal"
                        autoComplete="off"
                        value={amount}
                        onChange={(event) => typeAge(event.target.value, unit)}
                        aria-invalid={error ? true : undefined}
                        aria-describedby={error ? errorId : undefined}
                        placeholder="Ej. 3"
                        className="min-h-[44px] w-24 rounded-xl border border-[var(--lu-border-strong)] bg-white px-3 text-base text-[var(--lu-text)] placeholder:text-[var(--lu-subtle)] focus:border-[var(--lu-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--lu-accent-light)]"
                    />
                    <select
                        aria-label="Unidad: años o meses"
                        value={unit}
                        onChange={(event) => typeAge(amount, event.target.value as AgeUnit)}
                        className="min-h-[44px] rounded-xl border border-[var(--lu-border-strong)] bg-white px-3 text-base text-[var(--lu-text)] focus:border-[var(--lu-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--lu-accent-light)]"
                    >
                        <option value="years">años</option>
                        <option value="months">meses</option>
                    </select>
                    {value && (
                        <button
                            type="button"
                            onClick={() => choose(UNKNOWN)}
                            className="min-h-[44px] rounded-xl px-3 text-sm font-semibold text-[var(--lu-accent-text)] underline-offset-2 hover:underline"
                        >
                            Borrar edad
                        </button>
                    )}
                </div>
                <p id={errorId} role="alert" className={error ? "mt-1.5 text-sm font-medium text-red-700" : "sr-only"}>
                    {error}
                </p>
            </div>
        </div>
    );
}
