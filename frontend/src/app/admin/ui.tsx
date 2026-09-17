"use client";

import { ReactNode } from "react";

/**
 * Shared surfaces for the backoffice.
 *
 * Everything here draws from the same --lu-* tokens the public site uses, so
 * the panel reads as part of Diagnostic.ar rather than a bolted-on dashboard.
 */

export function Card({
    children,
    className = "",
    padded = true,
}: {
    children: ReactNode;
    className?: string;
    padded?: boolean;
}) {
    return (
        <section
            className={`rounded-2xl border border-[var(--lu-border)] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-12px_rgba(15,23,42,0.12)] ${padded ? "p-6" : ""
                } ${className}`}
        >
            {children}
        </section>
    );
}

export function CardHeader({
    title,
    hint,
    action,
}: {
    title: string;
    hint?: string;
    action?: ReactNode;
}) {
    return (
        <header className="mb-5 flex items-start justify-between gap-4">
            <div className="min-w-0">
                <h2 className="font-[family-name:var(--font-sora)] text-base font-semibold tracking-tight text-[var(--lu-text)]">
                    {title}
                </h2>
                {hint && <p className="mt-1 text-sm leading-relaxed text-[var(--lu-subtle)]">{hint}</p>}
            </div>
            {action && <div className="shrink-0">{action}</div>}
        </header>
    );
}

export function Eyebrow({ children }: { children: ReactNode }) {
    return (
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--lu-subtle)]">
            {children}
        </p>
    );
}

/** Compact number formatting: 12.4k rather than 12403 in a tile. */
export function formatCount(n: number): string {
    if (n < 1000) return String(n);
    if (n < 1_000_000) {
        const k = n / 1000;
        return `${k >= 10 ? Math.round(k) : k.toFixed(1).replace(/\.0$/, "")}k`;
    }
    return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

export function StatTile({
    label,
    value,
    caption,
    tone = "default",
}: {
    label: string;
    value: number | string;
    caption?: string;
    tone?: "default" | "accent";
}) {
    return (
        <Card className="relative overflow-hidden">
            {tone === "accent" && (
                <span
                    aria-hidden
                    className="pointer-events-none absolute inset-x-0 top-0 h-[3px] bg-[linear-gradient(90deg,var(--lu-accent),var(--lu-green))]"
                />
            )}
            <Eyebrow>{label}</Eyebrow>
            <p className="mt-3 font-[family-name:var(--font-sora)] text-[2rem] font-semibold leading-none tracking-tight text-[var(--lu-text)] tabular-nums">
                {typeof value === "number" ? formatCount(value) : value}
            </p>
            {caption && <p className="mt-2 text-sm text-[var(--lu-subtle)]">{caption}</p>}
        </Card>
    );
}

export function EmptyState({ message }: { message: string }) {
    return (
        <div className="flex h-full min-h-[200px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--lu-border)] px-6 py-10 text-center">
            <p className="text-sm text-[var(--lu-subtle)]">{message}</p>
        </div>
    );
}

export function Skeleton({ className = "" }: { className?: string }) {
    return <div className={`animate-pulse rounded-lg bg-slate-100 ${className}`} />;
}

export function Button({
    children,
    onClick,
    type = "button",
    variant = "primary",
    disabled,
    className = "",
}: {
    children: ReactNode;
    onClick?: () => void;
    type?: "button" | "submit";
    variant?: "primary" | "ghost" | "danger";
    disabled?: boolean;
    className?: string;
}) {
    const base =
        "inline-flex h-10 items-center justify-center gap-2 rounded-full px-5 text-sm font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--lu-accent)]";
    const variants = {
        // A disabled primary button reads as its own state — flat slate rather
        // than a faded accent, which otherwise looks like a rendering glitch.
        primary:
            "bg-[var(--lu-accent)] text-white shadow-sm hover:brightness-110 active:brightness-95 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none disabled:hover:brightness-100",
        ghost:
            "border border-[var(--lu-border)] bg-white text-[var(--lu-text)] hover:border-[var(--lu-accent)] hover:text-[var(--lu-accent)] disabled:cursor-not-allowed disabled:opacity-50",
        danger:
            "border border-rose-200 bg-white text-rose-600 hover:border-rose-400 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50",
    } as const;

    return (
        <button
            type={type}
            onClick={onClick}
            disabled={disabled}
            className={`${base} ${variants[variant]} ${className}`}
        >
            {children}
        </button>
    );
}

export function Field({
    label,
    ...props
}: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
    return (
        <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-[var(--lu-text)]">{label}</span>
            <input
                {...props}
                className="h-11 w-full rounded-xl border border-[var(--lu-border)] bg-white px-4 text-sm text-[var(--lu-text)] outline-none transition placeholder:text-slate-400 focus:border-[var(--lu-accent)] focus:ring-2 focus:ring-[color-mix(in_oklab,var(--lu-accent)_25%,transparent)]"
            />
        </label>
    );
}

export function Banner({
    tone,
    title,
    children,
}: {
    tone: "info" | "warn" | "error" | "success";
    title?: string;
    children: ReactNode;
}) {
    const tones = {
        info: "border-[var(--lu-border)] bg-[var(--lu-surface)] text-[var(--lu-text)]",
        warn: "border-amber-200 bg-amber-50 text-amber-900",
        error: "border-rose-200 bg-rose-50 text-rose-800",
        success: "border-emerald-200 bg-emerald-50 text-emerald-900",
    } as const;

    return (
        <div className={`rounded-xl border px-4 py-3 text-sm ${tones[tone]}`} role={tone === "error" ? "alert" : undefined}>
            {title && <p className="font-semibold">{title}</p>}
            <div className={title ? "mt-0.5" : ""}>{children}</div>
        </div>
    );
}
