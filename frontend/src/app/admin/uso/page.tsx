"use client";

import { useEffect, useState } from "react";
import { adminApi, adminErrorMessage, Insights } from "../admin-api";
import { Histogram, RankedBars } from "../charts";
import { Banner, Card, CardHeader, Eyebrow, Skeleton } from "../ui";

export default function AdminUsagePage() {
    const [data, setData] = useState<Insights | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        adminApi
            .insights()
            .then((d) => !cancelled && setData(d))
            .catch((e) => !cancelled && setError(adminErrorMessage(e)));
        return () => {
            cancelled = true;
        };
    }, []);

    return (
        <div className="space-y-6">
            <div>
                <Eyebrow>Uso clínico</Eyebrow>
                <h1 className="mt-1.5 font-[family-name:var(--font-sora)] text-2xl font-semibold tracking-tight">
                    Qué está consultando la plataforma
                </h1>
                <p className="mt-1 max-w-3xl text-sm leading-relaxed text-[var(--lu-subtle)]">
                    Agregados sobre las salidas del modelo. La geografía se informa sólo a nivel país: en
                    enfermedades poco frecuentes, una localidad con un único caso puede identificar a una familia.
                </p>
            </div>

            {error && (
                <Banner tone="error" title="No se pudieron cargar los datos">
                    {error}
                </Banner>
            )}

            <div className="grid gap-6 lg:grid-cols-2">
                <Card>
                    <CardHeader
                        title="Especialidades sugeridas"
                        hint="Las que el modelo recomienda con más frecuencia."
                    />
                    {data ? <RankedBars data={data.specialties} suffix="consultas" /> : <Skeleton className="h-[280px]" />}
                </Card>

                <Card>
                    <CardHeader title="Fenotipos más frecuentes" hint="Términos HPO extraídos de las historias." />
                    {data ? (
                        <RankedBars data={data.phenotypes} suffix="apariciones" color="#6366f1" />
                    ) : (
                        <Skeleton className="h-[280px]" />
                    )}
                </Card>
            </div>

            <div className="grid gap-6 lg:grid-cols-3">
                <Card className="lg:col-span-2">
                    <CardHeader
                        title="Distribución de confianza"
                        hint="Cómo se reparte la confianza del modelo. Un promedio no distingue un modelo uniformemente inseguro de uno bimodal."
                    />
                    {data ? <Histogram data={data.confidence} /> : <Skeleton className="h-[240px]" />}
                </Card>

                <Card>
                    <CardHeader title="Países" hint="Distribución geográfica, sólo a nivel país." />
                    {data ? <RankedBars data={data.countries} suffix="pacientes" color="#0ea5e9" /> : <Skeleton className="h-[240px]" />}
                </Card>
            </div>
        </div>
    );
}
