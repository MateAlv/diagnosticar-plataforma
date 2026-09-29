"use client";

import { CheckIcon } from "./icons";

/**
 * Which list the grid shows once the answers produced another order: a view
 * state, beside "Ver detalle médico", rather than a link that reads as
 * navigation. The model's own list comes first and is the default; the order
 * with the answers is there to look at when the reader asks for it.
 */
export function ListToggle({ refined, onChange }: { refined: boolean; onChange: (refined: boolean) => void }) {
    const options = [
        { value: false, label: "Original" },
        { value: true, label: "Con tus respuestas" },
    ];
    return (
        <div
            role="radiogroup"
            aria-label="Qué lista ver"
            data-list-toggle
            className="inline-flex shrink-0 rounded-xl border border-[var(--lu-border-strong)] bg-white"
        >
            {options.map((option) => {
                const checked = option.value === refined;
                return (
                    <label key={option.label} className="flex min-h-[42px] cursor-pointer items-center p-1">
                        <input
                            type="radio"
                            name="lista-genes"
                            checked={checked}
                            onChange={() => onChange(option.value)}
                            className="peer sr-only"
                        />
                        <span
                            className={`flex h-[34px] items-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-sm motion-safe:transition-colors peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--lu-accent-text)] ${
                                checked
                                    ? "bg-[var(--lu-accent-light)] font-semibold text-[var(--lu-accent-text)] shadow-[inset_0_0_0_1px_var(--lu-accent-text)]"
                                    : "font-medium text-[var(--lu-text)] hover:bg-[var(--lu-surface)]"
                            }`}
                        >
                            {checked && <CheckIcon className="h-3.5 w-3.5 shrink-0" />}
                            {option.label}
                        </span>
                    </label>
                );
            })}
        </div>
    );
}
