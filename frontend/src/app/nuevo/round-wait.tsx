"use client";

import { useEffect, useState } from "react";
import type { QuestionPending } from "@/lib/question-session";

/**
 * The wait for a round, which takes 15 to 60 seconds: what is happening, for
 * how long, and one reassurance at a time.
 *
 * The status region is mounted before it has anything to say, so a screen
 * reader announces the wait when it starts rather than missing it. The
 * seconds are hidden from it: announced every second, they would drown the
 * message.
 */

const REASSURANCE = [
    "Tu lista original sigue guardada.",
    "Puede tardar hasta un minuto y medio.",
    "Mientras tanto podés ocultar este panel y mirar la lista.",
];

/** How long each reassurance stays before the next. */
const ROTATE_SECONDS = 8;

function message(pending: QuestionPending): string {
    return pending === "finish"
        ? "Armando el resumen para la consulta"
        : "Eligiendo las preguntas que más ayudan a ordenar la lista";
}

/**
 * Whole seconds since `since`, the moment the request went out; zero while
 * nothing is. Counted from that moment rather than from mounting, so a wait
 * the reader hid and came back to shows how long it has really been.
 */
function useElapsed(since: number | null): number {
    const [elapsed, setElapsed] = useState(0);
    useEffect(() => {
        if (since === null) {
            setElapsed(0);
            return;
        }
        const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - since) / 1000)));
        tick();
        const timer = setInterval(tick, 1000);
        return () => clearInterval(timer);
    }, [since]);
    return elapsed;
}

export function WaitStatus({ pending, since }: { pending: QuestionPending; since: number | null }) {
    const busy = pending !== null;
    const elapsed = useElapsed(busy ? since : null);
    const line = REASSURANCE[Math.floor(elapsed / ROTATE_SECONDS) % REASSURANCE.length];

    return (
        <div role="status" aria-live="polite" className={busy ? "px-5 pt-5" : "sr-only"}>
            {busy && (
                <div className="flex items-start gap-3">
                    <span
                        aria-hidden="true"
                        className="mt-1 h-4 w-4 shrink-0 rounded-full border-2 border-[var(--lu-border)] border-t-[var(--lu-accent-text)] motion-safe:animate-spin motion-reduce:hidden"
                    />
                    <div className="min-w-0">
                        <p className="text-[15px] font-semibold leading-snug text-[var(--lu-text)]">
                            {message(pending)}
                            {elapsed >= 1 && (
                                <span aria-hidden="true" className="font-normal tabular-nums text-[var(--lu-subtle)]">
                                    {" "}
                                    · {elapsed} s
                                </span>
                            )}
                        </p>
                        <p className="mt-1 text-sm leading-relaxed text-[var(--lu-subtle)]">{line}</p>
                    </div>
                </div>
            )}
        </div>
    );
}

/** Three rows in the shape of the questions to come, breathing while they are chosen. */
export function WaitSkeleton() {
    return (
        <ol aria-hidden="true" className="mt-2 divide-y divide-[var(--lu-border)]">
            {[0.92, 0.7, 0.82].map((width, index) => (
                <li key={index} className="flex gap-3 px-5 py-6">
                    <span className="h-7 w-7 shrink-0 rounded-full bg-[var(--lu-border)] motion-safe:animate-pulse" />
                    <span className="flex min-w-0 flex-1 flex-col gap-2.5 pt-1">
                        <span
                            className="h-4 max-w-[560px] rounded-full bg-[var(--lu-border)] motion-safe:animate-pulse"
                            style={{ width: `${width * 100}%` }}
                        />
                        <span className="h-4 w-2/5 max-w-[300px] rounded-full bg-[var(--lu-border)] motion-safe:animate-pulse" />
                        <span className="mt-2 h-[58px] w-full rounded-xl bg-white ring-1 ring-inset ring-[var(--lu-border-strong)] motion-safe:animate-pulse" />
                    </span>
                </li>
            ))}
        </ol>
    );
}
