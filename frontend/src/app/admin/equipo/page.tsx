"use client";

import { useCallback, useEffect, useState } from "react";
import { adminApi, adminErrorMessage, StaffMember } from "../admin-api";
import { Banner, Button, Card, CardHeader, Eyebrow, Field, Skeleton } from "../ui";

type Invitation = { email: string; password: string };

function formatDate(iso: string | null): string {
    if (!iso) return "—";
    const d = new Date(iso);
    return Number.isFinite(d.getTime())
        ? d.toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" })
        : "—";
}

export default function AdminTeamPage() {
    const [staff, setStaff] = useState<StaffMember[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [formError, setFormError] = useState<string | null>(null);
    const [invitation, setInvitation] = useState<Invitation | null>(null);
    const [copied, setCopied] = useState(false);
    const [busy, setBusy] = useState(false);
    const [email, setEmail] = useState("");
    const [fullName, setFullName] = useState("");

    const load = useCallback(async () => {
        try {
            const { staff: list } = await adminApi.staff();
            setStaff(list);
        } catch (e) {
            setError(adminErrorMessage(e));
        }
    }, []);

    useEffect(() => {
        load();
    }, [load]);

    async function invite(event: React.FormEvent) {
        event.preventDefault();
        setFormError(null);
        setInvitation(null);
        setCopied(false);
        setBusy(true);
        try {
            const result = await adminApi.invite({
                email: email.trim(),
                fullName: fullName.trim() || undefined,
            });
            setInvitation({ email: result.user.email, password: result.temporaryPassword });
            setEmail("");
            setFullName("");
            await load();
        } catch (e) {
            setFormError(adminErrorMessage(e, "admin_invite"));
        } finally {
            setBusy(false);
        }
    }

    async function revoke(member: StaffMember) {
        if (!window.confirm(`¿Quitar el acceso de administración a ${member.email}?\n\nLa cuenta se conserva; sólo pierde el rol.`)) {
            return;
        }
        try {
            await adminApi.revoke(member.id);
            await load();
        } catch (e) {
            setError(adminErrorMessage(e, "admin_revoke"));
        }
    }

    return (
        <div className="space-y-6">
            <div>
                <Eyebrow>Equipo</Eyebrow>
                <h1 className="mt-1.5 font-[family-name:var(--font-sora)] text-2xl font-semibold tracking-tight">
                    Administradores
                </h1>
                <p className="mt-1 max-w-3xl text-sm leading-relaxed text-[var(--lu-subtle)]">
                    Quien tenga este rol puede ver todas las métricas de la plataforma y gestionar al resto del
                    equipo.
                </p>
            </div>

            {error && (
                <Banner tone="error" title="No se pudo completar">
                    {error}
                </Banner>
            )}

            <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
                {/*
                  min-w-0 is load-bearing: the table inside sets a 560px minimum,
                  and without this a grid item sizes to its content instead of
                  its column, so the whole page scrolls sideways on a phone
                  rather than the table scrolling inside its own card.
                */}
                <Card padded={false} className="min-w-0 overflow-hidden">
                    <div className="px-6 pt-6">
                        <CardHeader title="Equipo actual" hint={staff ? `${staff.length} con acceso.` : undefined} />
                    </div>

                    {!staff ? (
                        <div className="space-y-3 px-6 pb-6">
                            {Array.from({ length: 3 }).map((_, i) => (
                                <Skeleton key={i} className="h-14 w-full" />
                            ))}
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full min-w-[560px] border-collapse text-sm">
                                <thead>
                                    <tr className="border-y border-[var(--lu-border)] bg-[var(--lu-surface)] text-left">
                                        <th className="px-6 py-2.5 font-medium text-[var(--lu-subtle)]">Persona</th>
                                        <th className="px-4 py-2.5 font-medium text-[var(--lu-subtle)]">Alta</th>
                                        <th className="px-4 py-2.5 font-medium text-[var(--lu-subtle)]">Último acceso</th>
                                        <th className="px-6 py-2.5" />
                                    </tr>
                                </thead>
                                <tbody>
                                    {staff.map((member) => (
                                        <tr
                                            key={member.id}
                                            className="border-b border-[var(--lu-border)] last:border-0 hover:bg-[var(--lu-surface)]"
                                        >
                                            <td className="px-6 py-3.5">
                                                <div className="flex items-center gap-3">
                                                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[color-mix(in_oklab,var(--lu-accent)_14%,white)] text-xs font-semibold uppercase text-[var(--lu-accent)]">
                                                        {(member.fullName || member.email).slice(0, 2)}
                                                    </span>
                                                    <div className="min-w-0">
                                                        {member.fullName && (
                                                            <p className="truncate font-medium text-[var(--lu-text)]">
                                                                {member.fullName}
                                                            </p>
                                                        )}
                                                        <p className="truncate text-[var(--lu-subtle)]">{member.email}</p>
                                                        {member.mustChangePassword && (
                                                            <span className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                                                                <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                                                                Falta cambiar la contraseña
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-4 py-3.5 text-[var(--lu-subtle)]">{formatDate(member.createdAt)}</td>
                                            <td className="px-4 py-3.5 text-[var(--lu-subtle)]">{formatDate(member.lastLoginAt)}</td>
                                            <td className="px-6 py-3.5 text-right">
                                                <button
                                                    type="button"
                                                    onClick={() => revoke(member)}
                                                    className="rounded-lg px-2.5 py-1 text-xs font-medium text-[var(--lu-subtle)] transition hover:bg-rose-50 hover:text-rose-600"
                                                >
                                                    Quitar acceso
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </Card>

                <div className="space-y-4">
                    <Card>
                        <CardHeader
                            title="Invitar a alguien"
                            hint="Se crea la cuenta con una contraseña temporal que deberá cambiar al ingresar."
                        />
                        <form onSubmit={invite} className="space-y-4">
                            <Field
                                label="Email"
                                type="email"
                                required
                                value={email}
                                placeholder="persona@institucion.ar"
                                onChange={(e) => setEmail(e.target.value)}
                            />
                            <Field
                                label="Nombre (opcional)"
                                value={fullName}
                                placeholder="Nombre y apellido"
                                onChange={(e) => setFullName(e.target.value)}
                            />
                            {formError && <Banner tone="error">{formError}</Banner>}
                            <Button type="submit" disabled={busy || !email.trim()} className="w-full">
                                {busy ? "Creando…" : "Crear acceso"}
                            </Button>
                        </form>
                    </Card>

                    {invitation && (
                        <Card className="border-[var(--lu-accent)]/40 bg-[color-mix(in_oklab,var(--lu-accent)_5%,white)]">
                            <CardHeader
                                title="Contraseña temporal"
                                hint="Se muestra una sola vez. Compartila por un canal seguro."
                            />
                            <p className="text-sm text-[var(--lu-subtle)]">Para {invitation.email}</p>
                            <div className="mt-3 flex items-center gap-2">
                                <code className="min-w-0 flex-1 truncate rounded-lg border border-[var(--lu-border)] bg-white px-3 py-2.5 font-mono text-sm text-[var(--lu-text)]">
                                    {invitation.password}
                                </code>
                                <Button
                                    variant="ghost"
                                    onClick={() => {
                                        navigator.clipboard?.writeText(invitation.password).then(
                                            () => {
                                                setCopied(true);
                                                setTimeout(() => setCopied(false), 2000);
                                            },
                                            () => setCopied(false),
                                        );
                                    }}
                                >
                                    {copied ? "Copiado" : "Copiar"}
                                </Button>
                            </div>
                            <p className="mt-3 text-xs leading-relaxed text-[var(--lu-subtle)]">
                                No queda almacenada en ningún lado. Si se pierde, habrá que quitar el acceso y volver a
                                crearlo.
                            </p>
                        </Card>
                    )}
                </div>
            </div>
        </div>
    );
}
