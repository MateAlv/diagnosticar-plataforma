import { ONSET_HINT, onsetPhrase, onsetSummaryLine, type SymptomOnset } from "../../lib/onset";

type Reported = { label: string; onset?: SymptomOnset | null };

/** The onset of one symptom, as text, for use inside a symptom list item. */
export function OnsetInline({ onset }: { onset?: SymptomOnset | null }) {
    if (!onset) return null;
    const phrase = onsetPhrase(onset);
    if (!phrase) return null;
    return (
        <span data-onset className="text-xs text-[var(--lu-subtle)]">
            · {phrase}
        </span>
    );
}

/** The patient-level onset line with its hint; renders nothing when no symptom has onset. */
export function OnsetSummary({ symptoms, className = "" }: { symptoms: readonly Reported[]; className?: string }) {
    const line = onsetSummaryLine(symptoms);
    if (!line) return null;
    return (
        <div data-onset-summary className={className}>
            <p className="text-sm font-semibold text-[var(--lu-text)]">{line}</p>
            <p className="mt-0.5 text-xs leading-relaxed text-[var(--lu-subtle)]">{ONSET_HINT}</p>
        </div>
    );
}
