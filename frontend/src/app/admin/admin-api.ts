"use client";

/**
 * Typed client for /api/admin.
 *
 * Every call goes through the same credentialed fetch the rest of the app uses,
 * and treats 404 as "not an admin" rather than "missing page": the backend
 * deliberately answers 404 instead of 403 so the backoffice is invisible to
 * accounts without the role.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api";

export class AdminAccessError extends Error {
    constructor() {
        super("No tenés acceso al panel de administración.");
        this.name = "AdminAccessError";
    }
}

export class PasswordChangeRequiredError extends Error {
    constructor() {
        super("Tenés que cambiar tu contraseña antes de continuar.");
        this.name = "PasswordChangeRequiredError";
    }
}

function getCookie(name: string): string | null {
    if (typeof document === "undefined") return null;
    const escaped = name.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
    const match = document.cookie.match(new RegExp(`(?:^|; )${escaped}=([^;]*)`));
    return match ? decodeURIComponent(match[1]) : null;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers ?? {});
    headers.set("Content-Type", "application/json");
    const method = (init.method ?? "GET").toUpperCase();
    if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
        const csrf = getCookie("csrf_token");
        if (csrf) headers.set("X-CSRF-Token", csrf);
    }

    const res = await fetch(`${API_URL}${path}`, {
        ...init,
        headers,
        credentials: "include",
    });

    if (res.status === 404) throw new AdminAccessError();
    if (res.status === 401) throw new AdminAccessError();
    if (res.status === 403) {
        const body = await res.json().catch(() => ({}));
        if (body?.code === "PASSWORD_CHANGE_REQUIRED") throw new PasswordChangeRequiredError();
        throw new AdminAccessError();
    }
    if (res.status === 429) {
        throw new Error("Demasiadas solicitudes. Esperá un momento y volvé a intentar.");
    }
    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? "Algo salió mal.");
    }

    return (await res.json()) as T;
}

export type TimePoint = { day: string; count: number };
export type Bucket = { label: string; count: number };

export type Overview = {
    totals: {
        users: number;
        usersLast30d: number;
        activeLast30d: number;
        patients: number;
        diagnoses: number;
        diagnosesLast30d: number;
        diagnosesLast24h: number;
    };
    diagnosesPerDay: TimePoint[];
    signupsPerDay: TimePoint[];
    authProviders: Bucket[];
    days: number;
};

export type Insights = {
    specialties: Bucket[];
    phenotypes: Bucket[];
    confidence: Bucket[];
    countries: Bucket[];
};

export type Release = {
    version: string;
    commit: string;
    builtAt: string;
    environment: string;
    startedAt: string;
    uptimeSeconds: number;
    node: string;
};

export type StaffMember = {
    id: string;
    email: string;
    fullName: string | null;
    organization: string | null;
    status: string;
    mustChangePassword: boolean;
    createdAt: string | null;
    lastLoginAt: string | null;
};

export const adminApi = {
    overview: (days: number) => request<Overview>(`/admin/overview?days=${days}`),
    insights: () => request<Insights>("/admin/insights"),
    release: () => request<Release>("/admin/release"),
    staff: () => request<{ staff: StaffMember[] }>("/admin/staff"),
    invite: (body: { email: string; fullName?: string; organization?: string }) =>
        request<{
            user: { id: string; email: string; fullName: string | null };
            temporaryPassword: string;
            notice: string;
        }>("/admin/staff", { method: "POST", body: JSON.stringify(body) }),
    revoke: (id: string) => request<{ ok: true }>(`/admin/staff/${id}/revoke`, { method: "POST", body: "{}" }),
    changePassword: (body: { currentPassword: string; newPassword: string }) =>
        request<{ ok: true; reauthenticate: boolean }>("/auth/change-password", {
            method: "POST",
            body: JSON.stringify(body),
        }),
};
