"use client";

import Link from "next/link";

type Props = {
    checked: boolean;
    onChange: (checked: boolean) => void;
    className?: string;
};

/**
 * The one checkbox that accepts /terminos. The terms are also the express
 * consent Ley 25.326 asks for health data, so the label says so in plain words
 * instead of a second, alarming box.
 */
export function TermsCheckbox({ checked, onChange, className = "" }: Props) {
    return (
        <label className={`flex items-start gap-3 text-sm text-[color:var(--lu-subtle)] ${className}`}>
            <input
                type="checkbox"
                checked={checked}
                onChange={(event) => onChange(event.target.checked)}
                className="mt-1 h-4 w-4 shrink-0 rounded border-[var(--lu-border)] accent-[var(--lu-accent)]"
            />
            <span>
                Leí y acepto los{" "}
                <Link
                    href="/terminos"
                    target="_blank"
                    className="font-semibold text-[var(--lu-accent-text)] underline underline-offset-2"
                >
                    términos y condiciones
                </Link>
                , que explican qué datos de salud guardamos y cómo los usamos.
            </span>
        </label>
    );
}
