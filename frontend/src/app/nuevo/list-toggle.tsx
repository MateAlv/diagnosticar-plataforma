"use client";

/**
 * Which list the grid shows once the answers produced another order, as one
 * button beside "Ver detalle médico": on the list with the answers it goes
 * back to the model's own, and from there it brings the other one back.
 */
export function ListToggle({ refined, onChange }: { refined: boolean; onChange: (refined: boolean) => void }) {
    return (
        <button
            type="button"
            data-list-toggle
            data-showing={refined ? "refined" : "original"}
            onClick={() => onChange(!refined)}
            className="inline-flex min-h-[44px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl border border-[var(--lu-border-strong)] bg-white px-3.5 text-sm font-semibold text-[var(--lu-accent-text)] hover:bg-[var(--lu-surface)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lu-accent-text)]"
        >
            {refined ? (
                <>
                    <span aria-hidden="true">←</span>
                    Volver a la lista inicial
                </>
            ) : (
                "Ver la lista con tus respuestas"
            )}
        </button>
    );
}
