"use client";

import {
    Area,
    AreaChart,
    Bar,
    BarChart,
    Cell,
    Pie,
    PieChart,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from "recharts";
import { Bucket, TimePoint } from "./admin-api";
import { EmptyState } from "./ui";

/**
 * Chart primitives for the backoffice.
 *
 * One palette, one tooltip, one axis treatment across every chart, so a
 * dashboard of six of them reads as a single system rather than six libraries.
 * Colours are drawn from the site's own tokens; the categorical ramp is ordered
 * so adjacent bars stay distinguishable in greyscale as well as in colour.
 */

const ACCENT = "#0d9488";
const CATEGORICAL = ["#0d9488", "#0ea5e9", "#6366f1", "#f59e0b", "#10b981", "#8b5cf6", "#ec4899", "#14b8a6"];

const AXIS = {
    stroke: "#cbd5e1",
    tick: { fill: "#64748b", fontSize: 12 },
    tickLine: false,
    axisLine: false,
} as const;

function TooltipBox({
    active,
    payload,
    label,
    suffix,
}: {
    active?: boolean;
    payload?: Array<{ value?: number | string; name?: string }>;
    label?: string | number;
    suffix?: string;
}) {
    if (!active || !payload?.length) return null;
    const value = payload[0]?.value;
    return (
        <div className="rounded-lg border border-[var(--lu-border)] bg-white px-3 py-2 shadow-lg">
            <p className="text-xs font-medium text-[var(--lu-subtle)]">{label}</p>
            <p className="mt-0.5 text-sm font-semibold tabular-nums text-[var(--lu-text)]">
                {value}
                {suffix ? ` ${suffix}` : ""}
            </p>
        </div>
    );
}

/** Dates arrive as YYYY-MM-DD; show them short and locale-appropriate. */
function shortDate(day: string): string {
    const [y, m, d] = day.split("-").map(Number);
    if (!y || !m || !d) return day;
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("es-AR", {
        day: "numeric",
        month: "short",
        timeZone: "UTC",
    });
}

export function TimeSeries({
    data,
    label,
    color = ACCENT,
}: {
    data: TimePoint[];
    label: string;
    color?: string;
}) {
    if (!data.length) return <EmptyState message="Todavía no hay datos para este período." />;

    const total = data.reduce((sum, p) => sum + p.count, 0);
    if (total === 0) {
        return <EmptyState message="Sin actividad registrada en este período." />;
    }

    const rows = data.map((p) => ({ ...p, short: shortDate(p.day) }));
    const gradientId = `grad-${label.replace(/\W/g, "")}`;

    return (
        <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={rows} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                <defs>
                    <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={color} stopOpacity={0.28} />
                        <stop offset="100%" stopColor={color} stopOpacity={0.02} />
                    </linearGradient>
                </defs>
                {/*
                  `preserveStartEnd` plus a minimum gap lets Recharts drop as many
                  ticks as the actual width requires. A fixed interval computed
                  from the row count looks right on a desktop and collapses into
                  an unreadable smear on a phone, because it cannot know how wide
                  the chart ended up.
                */}
                <XAxis dataKey="short" interval="preserveStartEnd" minTickGap={28} {...AXIS} />
                <YAxis allowDecimals={false} width={44} {...AXIS} />
                <Tooltip
                    content={<TooltipBox suffix={label} />}
                    cursor={{ stroke: color, strokeOpacity: 0.25, strokeWidth: 1 }}
                />
                <Area
                    type="monotone"
                    dataKey="count"
                    stroke={color}
                    strokeWidth={2}
                    fill={`url(#${gradientId})`}
                    dot={false}
                    activeDot={{ r: 4, strokeWidth: 2, stroke: "#fff" }}
                />
            </AreaChart>
        </ResponsiveContainer>
    );
}

export function RankedBars({
    data,
    suffix = "",
    color = ACCENT,
}: {
    data: Bucket[];
    suffix?: string;
    color?: string;
}) {
    if (!data.length) {
        return (
            <EmptyState message="Sin datos suficientes. Los grupos con menos de 5 registros se omiten para proteger la privacidad." />
        );
    }

    // Horizontal bars: these labels are long (specialty and HPO names), and
    // rotating them vertically makes a chart nobody can read at a glance.
    const height = Math.max(200, data.length * 34 + 16);

    return (
        <ResponsiveContainer width="100%" height={height}>
            <BarChart data={data} layout="vertical" margin={{ top: 0, right: 16, left: 0, bottom: 0 }}>
                <XAxis type="number" allowDecimals={false} {...AXIS} />
                {/*
                  A fixed label column eats 40% of a phone screen and leaves the
                  bars as stubs. Recharts sizes the axis to its content when
                  width is "auto", so the labels stay readable and the bars keep
                  whatever room is left.
                */}
                <YAxis
                    type="category"
                    dataKey="label"
                    width="auto"
                    {...AXIS}
                    tick={{ fill: "#475569", fontSize: 12 }}
                />
                <Tooltip content={<TooltipBox suffix={suffix} />} cursor={{ fill: "rgba(13,148,136,0.06)" }} />
                <Bar dataKey="count" fill={color} radius={[0, 6, 6, 0]} maxBarSize={18} />
            </BarChart>
        </ResponsiveContainer>
    );
}

export function Histogram({ data }: { data: Bucket[] }) {
    const total = data.reduce((sum, b) => sum + b.count, 0);
    if (!total) return <EmptyState message="Todavía no hay valores de confianza registrados." />;

    return (
        <ResponsiveContainer width="100%" height={240}>
            <BarChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                {/* Ten range labels do not fit on a phone; let Recharts thin them. */}
                <XAxis
                    dataKey="label"
                    interval="preserveStartEnd"
                    minTickGap={16}
                    {...AXIS}
                    tick={{ fill: "#64748b", fontSize: 11 }}
                />
                <YAxis allowDecimals={false} width={44} {...AXIS} />
                <Tooltip content={<TooltipBox suffix="casos" />} cursor={{ fill: "rgba(13,148,136,0.06)" }} />
                <Bar dataKey="count" radius={[6, 6, 0, 0]} maxBarSize={44}>
                    {data.map((_, i) => (
                        // Darker towards high confidence, so the shape of the
                        // distribution is legible without reading the axis.
                        <Cell key={i} fill={`color-mix(in oklab, ${ACCENT} ${35 + i * 7}%, white)`} />
                    ))}
                </Bar>
            </BarChart>
        </ResponsiveContainer>
    );
}

export function Donut({ data }: { data: Bucket[] }) {
    const total = data.reduce((sum, b) => sum + b.count, 0);
    if (!total) return <EmptyState message="Sin datos." />;

    return (
        <div className="flex flex-col items-center gap-4 sm:flex-row sm:gap-6">
            <div className="h-[168px] w-[168px] shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                        <Pie
                            data={data}
                            dataKey="count"
                            nameKey="label"
                            innerRadius={52}
                            outerRadius={80}
                            paddingAngle={2}
                            stroke="none"
                        >
                            {data.map((_, i) => (
                                <Cell key={i} fill={CATEGORICAL[i % CATEGORICAL.length]} />
                            ))}
                        </Pie>
                        <Tooltip content={<TooltipBox suffix="cuentas" />} />
                    </PieChart>
                </ResponsiveContainer>
            </div>
            <ul className="w-full space-y-2">
                {data.map((b, i) => (
                    <li key={b.label} className="flex items-center gap-3 text-sm">
                        <span
                            className="h-2.5 w-2.5 shrink-0 rounded-full"
                            style={{ background: CATEGORICAL[i % CATEGORICAL.length] }}
                        />
                        <span className="min-w-0 flex-1 truncate capitalize text-[var(--lu-text)]">{b.label}</span>
                        <span className="tabular-nums font-medium text-[var(--lu-text)]">{b.count}</span>
                        <span className="w-12 text-right tabular-nums text-[var(--lu-subtle)]">
                            {Math.round((b.count / total) * 100)}%
                        </span>
                    </li>
                ))}
            </ul>
        </div>
    );
}
