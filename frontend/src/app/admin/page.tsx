"use client";

import { useCallback, useEffect, useState } from "react";
import { adminApi, Overview, Release } from "./admin-api";
import { Donut, TimeSeries } from "./charts";
import { Banner, Card, CardHeader, Eyebrow, Skeleton, StatTile } from "./ui";

const RANGES = [
    { days: 7, label: "7 días" },
    { days: 30, label: "30 días" },
    { days: 90, label: "90 días" },
];

function formatUptime(seconds: number): string {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (d > 0) return `${d} d ${h} h`;
    if (h > 0) return `${h} h ${m} min`;
    return `${m} min`;
}

export default function AdminOverviewPage() {
    const [days, setDays] = useState(30);
    const [data, setData] = useState<Overview | null>(null);
    const [release, setRelease] = useState<Release | null>(null);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async (window: number) => {
        setError(null);
        try {
            const [overview, rel] = await Promise.all([adminApi.overview(window), adminApi.release()]);
            setData(overview);
            setRelease(rel);
        } catch (e) {
            setError((e as Error).message);
        }
    }, []);

    useEffect(() => {
        load(days);
    }, [days, load]);

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                    <Eyebrow>Panel de administración</Eyebrow>
                    <h1 className="mt-1.5 font-[family-name:var(--font-sora)] text-2xl font-semibold tracking-tight">
                        Resumen de la plataforma
                    </h1>
                    <p className="mt-1 text-sm text-[var(--lu-subtle)]">
                        Métricas agregadas y anónimas. Ninguna consulta accede a historias clínicas ni a datos
                        personales.
                    </p>
                </div>

                <div
                    className="inline-flex rounded-full border border-[var(--lu-border)] bg-white p-1"
                    role="group"
                    aria-label="Período"
                >
                    {RANGES.map((r) => (
                        <button
                            key={r.days}
                            type="button"
                            onClick={() => setDays(r.days)}
                            aria-pressed={days === r.days}
                            className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition ${days === r.days
                                    ? "bg-[var(--lu-accent)] text-white shadow-sm"
                                    : "text-[var(--lu-subtle)] hover:text-[var(--lu-text)]"
                                }`}
                        >
                            {r.label}
                        </button>
                    ))}
                </div>
            </div>

            {error && (
                <Banner tone="error" title="No se pudieron cargar las métricas">
                    {error}
                </Banner>
            )}

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {data ? (
                    <>
                        <StatTile
                            label="Consultas totales"
                            value={data.totals.diagnoses}
                            caption={`${data.totals.diagnosesLast24h} en las últimas 24 h`}
                            tone="accent"
                        />
                        <StatTile
                            label="Consultas (30 d)"
                            value={data.totals.diagnosesLast30d}
                            caption="Registros creados el último mes"
                        />
                        <StatTile
                            label="Cuentas registradas"
                            value={data.totals.users}
                            caption={`${data.totals.usersLast30d} nuevas este mes`}
                        />
                        <StatTile
                            label="Activas (30 d)"
                            value={data.totals.activeLast30d}
                            caption="Con sesión iniciada el último mes"
                        />
                    </>
                ) : (
                    Array.from({ length: 4 }).map((_, i) => (
                        <Card key={i}>
                            <Skeleton className="h-3 w-24" />
                            <Skeleton className="mt-4 h-8 w-20" />
                            <Skeleton className="mt-3 h-3 w-32" />
                        </Card>
                    ))
                )}
            </div>

            <div className="grid gap-6 lg:grid-cols-3">
                <Card className="lg:col-span-2">
                    <CardHeader
                        title="Consultas por día"
                        hint={`Registros creados en los últimos ${days} días.`}
                    />
                    {data ? (
                        <TimeSeries data={data.diagnosesPerDay} label="consultas" />
                    ) : (
                        <Skeleton className="h-[260px] w-full" />
                    )}
                </Card>

                <Card>
                    <CardHeader title="Método de acceso" hint="Cómo se registran las cuentas." />
                    {data ? <Donut data={data.authProviders} /> : <Skeleton className="h-[200px] w-full" />}
                </Card>
            </div>

            <div className="grid gap-6 lg:grid-cols-3">
                <Card className="lg:col-span-2">
                    <CardHeader title="Altas de cuentas" hint={`Nuevos registros en los últimos ${days} días.`} />
                    {data ? (
                        <TimeSeries data={data.signupsPerDay} label="cuentas" color="#6366f1" />
                    ) : (
                        <Skeleton className="h-[260px] w-full" />
                    )}
                </Card>

                <Card>
                    <CardHeader title="Versión desplegada" hint="Lo que está corriendo ahora mismo." />
                    {release ? (
                        <dl className="space-y-3.5 text-sm">
                            <div className="flex items-baseline justify-between gap-4">
                                <dt className="text-[var(--lu-subtle)]">Versión</dt>
                                <dd className="font-[family-name:var(--font-sora)] text-lg font-semibold">
                                    {release.version}
                                </dd>
                            </div>
                            <div className="flex items-baseline justify-between gap-4">
                                <dt className="text-[var(--lu-subtle)]">Entorno</dt>
                                <dd>
                                    <span
                                        className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${release.environment === "production"
                                                ? "bg-emerald-50 text-emerald-700"
                                                : "bg-amber-50 text-amber-700"
                                            }`}
                                    >
                                        {release.environment}
                                    </span>
                                </dd>
                            </div>
                            <div className="flex items-baseline justify-between gap-4">
                                <dt className="shrink-0 text-[var(--lu-subtle)]">Commit</dt>
                                <dd className="truncate font-mono text-xs text-[var(--lu-text)]" title={release.commit}>
                                    {release.commit.slice(0, 12)}
                                </dd>
                            </div>
                            <div className="flex items-baseline justify-between gap-4">
                                <dt className="text-[var(--lu-subtle)]">En línea</dt>
                                {/* Derived from uptime alone. Showing "desplegado
                                    hace X" alongside it invites the two to
                                    disagree over clock skew, and they answer the
                                    same question. */}
                                <dd className="tabular-nums">{formatUptime(release.uptimeSeconds)}</dd>
                            </div>
                            <div className="flex items-baseline justify-between gap-4">
                                <dt className="text-[var(--lu-subtle)]">Desde</dt>
                                <dd className="text-right text-[var(--lu-subtle)]">
                                    {new Date(Date.now() - release.uptimeSeconds * 1000).toLocaleString("es-AR", {
                                        day: "2-digit",
                                        month: "short",
                                        hour: "2-digit",
                                        minute: "2-digit",
                                    })}
                                </dd>
                            </div>
                        </dl>
                    ) : (
                        <div className="space-y-3">
                            {Array.from({ length: 5 }).map((_, i) => (
                                <Skeleton key={i} className="h-5 w-full" />
                            ))}
                        </div>
                    )}
                </Card>
            </div>
        </div>
    );
}
