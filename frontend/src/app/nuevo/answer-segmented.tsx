"use client";

import { useRef } from "react";
import { ANSWER_VALUES, answerLabel, type AnswerValue } from "@/lib/questions-api";
import { CheckIcon } from "./icons";

/**
 * Sí / No / No sé as one segmented control: three equal cells, none of which
 * ever wraps.
 *
 * The chosen cell looks the same whichever answer it is. A no is not a bad
 * answer and «No sé» is a real one, so none of them gets a colour of its own.
 *
 * Native radios underneath, so the arrow keys move between the answers and a
 * screen reader hears a group of three. `onChange` says whether the answer
 * came from a pointer: only then may the form scroll on to the next question,
 * since scrolling away from a keyboard user's focus loses them.
 */
export function AnswerSegmented({
    name,
    value,
    onChange,
    labelledBy,
    describedBy,
    invalid,
}: {
    name: string;
    value: AnswerValue | null;
    onChange: (value: AnswerValue, viaPointer: boolean) => void;
    labelledBy: string;
    describedBy?: string;
    invalid: boolean;
}) {
    const pointer = useRef(false);

    return (
        <div
            role="radiogroup"
            aria-labelledby={labelledBy}
            aria-describedby={describedBy}
            aria-invalid={invalid || undefined}
            onPointerDown={() => {
                pointer.current = true;
            }}
            onKeyDown={() => {
                pointer.current = false;
            }}
            className="grid w-full grid-cols-3 rounded-xl border border-[var(--lu-border-strong)] bg-white @lg:w-[372px]"
        >
            {ANSWER_VALUES.map((option, index) => {
                const checked = value === option;
                // A hairline between cells, dropped beside the chosen one,
                // whose own outline already separates it.
                const divider =
                    index > 0 && !checked && value !== ANSWER_VALUES[index - 1]
                        ? "before:absolute before:inset-y-3 before:left-0 before:w-px before:bg-[var(--lu-border-strong)] before:content-['']"
                        : "";
                return (
                    <label key={option} className={`relative flex cursor-pointer p-1 ${divider}`}>
                        <input
                            type="radio"
                            name={name}
                            value={option}
                            checked={checked}
                            onChange={() => onChange(option, pointer.current)}
                            className="peer sr-only"
                        />
                        <span
                            className={`flex h-12 w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-lg text-[15px] motion-safe:transition-colors peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--lu-accent-text)] ${
                                checked
                                    ? "bg-[var(--lu-accent-light)] font-semibold text-[var(--lu-accent-text)] shadow-[inset_0_0_0_1.5px_var(--lu-accent-text)]"
                                    : "font-medium text-[var(--lu-text)] hover:bg-[var(--lu-surface)] hover:text-[var(--lu-accent-text)] peer-focus-visible:bg-[var(--lu-surface)]"
                            }`}
                        >
                            {checked && <CheckIcon className="h-4 w-4 shrink-0" />}
                            {answerLabel(option)}
                        </span>
                    </label>
                );
            })}
        </div>
    );
}
