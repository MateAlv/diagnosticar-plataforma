/**
 * The referral every result should end with: the genes on screen are a
 * geneticist's material, whatever other specialties the list points to.
 */
export function ConsultaGenetica({ className = "" }: { className?: string }) {
    return (
        <aside
            aria-labelledby="consulta-genetica-titulo"
            className={`rounded-2xl border-2 border-[var(--lu-accent)] bg-[var(--lu-accent-light)]/60 px-4 py-4 sm:px-5 ${className}`}
        >
            <p id="consulta-genetica-titulo" className="flex items-start gap-2 text-base font-bold leading-snug text-[var(--lu-text)]">
                <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                    className="mt-0.5 shrink-0 text-[var(--lu-accent-text)]"
                >
                    <path d="M4 3c4 3 12 3 16 0M4 21c4-3 12-3 16 0M4 3c0 6 16 12 16 18M20 3c0 6-16 12-16 18" />
                </svg>
                Si pensás que puede tratarse de una enfermedad genética
            </p>
            <p className="mt-1.5 text-sm leading-relaxed text-[var(--lu-text)]">
                Lo indicado es una consulta con un o una especialista en <strong>genética médica</strong>.
                Podés pedirle la derivación a tu médico o médica de cabecera, o al pediatra, y llevar esta
                lista de genes a la consulta.
            </p>
        </aside>
    );
}
