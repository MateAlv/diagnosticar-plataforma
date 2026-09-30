import Link from "next/link";
import { isSessionError } from "@/lib/api-errors";

/**
 * How every failure is shown: the message from errorMessage(), and the one
 * thing the reader can do about it. A closed session always offers the way
 * back in, whatever else the caller passed.
 */
export function ErrorNotice({
    message,
    error,
    onRetry,
    retryLabel = "Probar de nuevo",
    className = "",
}: {
    message: string | null | undefined;
    /** The failure itself, to tell a closed session from the rest. */
    error?: unknown;
    onRetry?: () => void;
    retryLabel?: string;
    className?: string;
}) {
    if (!message) return null;
    const session = error !== undefined && isSessionError(error);
    const next = typeof window !== "undefined" ? window.location.pathname + window.location.search : "/";
    return (
        <div
            role="alert"
            className={`flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-relaxed text-red-800 ${className}`}
        >
            <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                className="mt-0.5 shrink-0"
            >
                <circle cx="12" cy="12" r="10" />
                <path d="M12 8v4M12 16h.01" />
            </svg>
            <div className="min-w-0 flex-1">
                <p>{message}</p>
                {(session || onRetry) && (
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                        {session ? (
                            <Link
                                href={`/login?motivo=sesion&next=${encodeURIComponent(next)}`}
                                className="font-semibold underline underline-offset-2"
                            >
                                Iniciar sesión
                            </Link>
                        ) : (
                            onRetry && (
                                <button type="button" onClick={onRetry} className="font-semibold underline underline-offset-2">
                                    {retryLabel}
                                </button>
                            )
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
