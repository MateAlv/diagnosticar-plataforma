"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useMemo, useState } from "react";
import { fetchChildren, genesLabel, typesLabel, type HpoTerm, type HpoTermChildren } from "@/lib/hpo-terms";
import { onsetClass, type SymptomOnset } from "@/lib/onset";
import { OnsetSelector } from "./onset-selector";

/**
 * Browse from a general symptom down to a more specific one.
 *
 * Choosing a term anywhere in the tree replaces the symptom and closes the
 * dialog; going deeper is a separate, smaller button, so the main action on a
 * row is always "this one". Only forms that reach some gene are listed, the
 * most common first, each with a bar for how much of its parent's search it
 * keeps: shorter narrows more. Nothing here is required — "Dejarlo como está"
 * leaves the symptom as it was.
 *
 * Every symptom that opens it can also say when it began. A symptom that
 * cannot be refined (offered only because its onset is informative) gets that
 * question alone; on one that can, it sits above the list, folded until used.
 */

export type RefineTarget = { code: string; description: string; refinable: boolean };

type Props = {
    target: RefineTarget | null;
    onClose: () => void;
    onChoose: (term: HpoTerm) => void;
    onset: SymptomOnset | null;
    onOnsetChange: (onset: SymptomOnset | null) => void;
    /** `YYYY-MM-DD`; bounds the onset when known. */
    birthDate?: string | null;
};

const FILTER_FROM = 8;

export function RefineTermDialog({ target, onClose, onChoose, onset, onOnsetChange, birthDate }: Props) {
    const [levels, setLevels] = useState<HpoTermChildren[]>([]);
    const [loading, setLoading] = useState(false);
    const [failed, setFailed] = useState(false);
    const [filter, setFilter] = useState("");

    const open = target !== null;

    const load = async (id: string, replace: boolean) => {
        setLoading(true);
        setFailed(false);
        setFilter("");
        const level = await fetchChildren(id);
        setLoading(false);
        if (!level) {
            setFailed(true);
            return;
        }
        setLevels((prev) => (replace ? [level] : [...prev, level]));
    };

    useEffect(() => {
        if (target) {
            setLevels([]);
            setFailed(false);
            setLoading(false);
            if (target.refinable) void load(target.code, true);
        }
        // Reloads only when a different symptom is opened.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [target?.code]);

    const current = levels[levels.length - 1];
    const root = levels[0]?.termino;

    const shown = useMemo(() => {
        if (!current) return [];
        const needle = filter.trim().toLocaleLowerCase("es");
        return needle
            ? current.hijos.filter((h) => h.nombre.toLocaleLowerCase("es").includes(needle))
            : current.hijos;
    }, [current, filter]);

    const choose = (term: HpoTerm) => {
        onChoose(term);
        onClose();
    };

    const rootName = target?.description ?? root?.nombre ?? "";
    const refinable = target?.refinable ?? false;
    const onsetLabel = onsetClass(onset?.hpo_id)?.label;
    const [onsetOpen, setOnsetOpen] = useState(true);
    useEffect(() => {
        setOnsetOpen(!refinable || onset !== null);
        // Decided when a symptom opens; changing the value in it does not refold.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [target?.code]);

    return (
        <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
            <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm motion-safe:animate-[modal-fade_.2s_ease]" />
                <Dialog.Content
                    data-testid="refine-term-dialog"
                    className="fixed inset-0 z-50 flex flex-col bg-white shadow-2xl motion-safe:animate-[modal-fade_.2s_ease] sm:inset-auto sm:left-1/2 sm:top-1/2 sm:max-h-[85vh] sm:w-[min(640px,calc(100vw-48px))] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-3xl"
                >
                    <div className="flex items-start gap-3 border-b border-[var(--lu-border)] px-5 pb-4 pt-5 sm:px-7">
                        <div className="min-w-0 flex-1">
                            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--lu-accent-text)]">
                                Precisar un síntoma
                            </p>
                            <Dialog.Title className="mt-1 text-xl font-bold leading-snug text-[var(--lu-text)] sm:text-2xl">
                                {refinable ? <>¿Qué tipo de «{rootName}»?</> : <>¿Cuándo empezó «{rootName}»?</>}
                            </Dialog.Title>
                            <Dialog.Description className="mt-2 text-sm leading-relaxed text-[var(--lu-subtle)]">
                                {!refinable ? (
                                    <>Si lo sabés, contanos a qué edad empezó este síntoma. Es opcional.</>
                                ) : root ? (
                                    <>
                                        «{rootName}» es un término amplio
                                        {root.debajo ? <>: abarca {typesLabel(root.debajo)}</> : null}. Si sabés de
                                        qué tipo es, elegilo: cuanto más específico, mejor se ordenan los genes. Si
                                        tenés dudas, dejalo como está.
                                    </>
                                ) : (
                                    <>Cuanto más específico sea el síntoma, mejor se ordenan los genes.</>
                                )}
                            </Dialog.Description>
                        </div>
                        <Dialog.Close
                            className="-mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-lg text-[var(--lu-subtle)] hover:bg-[var(--lu-surface)] hover:text-[var(--lu-text)]"
                            aria-label="Cerrar"
                        >
                            ✕
                        </Dialog.Close>
                    </div>

                    {levels.length > 1 && (
                        <nav aria-label="Dónde estás" className="border-b border-[var(--lu-border)] px-5 py-2.5 sm:px-7">
                            <ol className="flex flex-wrap items-center gap-1 text-sm">
                                {levels.map((level, index) => {
                                    const last = index === levels.length - 1;
                                    return (
                                        <li key={level.termino.hpo_id} className="flex items-center gap-1">
                                            {index > 0 && <span className="text-[var(--lu-border-strong)]" aria-hidden>›</span>}
                                            {last ? (
                                                <span className="px-1.5 py-1 font-semibold text-[var(--lu-text)]" aria-current="location">
                                                    {level.termino.nombre}
                                                </span>
                                            ) : (
                                                <button
                                                    type="button"
                                                    onClick={() => setLevels((prev) => prev.slice(0, index + 1))}
                                                    className="rounded-lg px-1.5 py-1 font-medium text-[var(--lu-accent-text)] underline-offset-2 hover:bg-[var(--lu-accent-light)] hover:underline"
                                                >
                                                    {level.termino.nombre}
                                                </button>
                                            )}
                                        </li>
                                    );
                                })}
                            </ol>
                        </nav>
                    )}

                    <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-7">
                        {target && (
                            <section className="mb-4 rounded-2xl border border-[var(--lu-border)] bg-[var(--lu-surface)]/60 p-4">
                                {refinable ? (
                                    <details open={onsetOpen} onToggle={(event) => setOnsetOpen(event.currentTarget.open)}>
                                        <summary className="min-h-[44px] cursor-pointer list-none text-sm font-semibold text-[var(--lu-text)] marker:hidden">
                                            ¿A qué edad empezó este síntoma?{" "}
                                            <span className="font-normal text-[var(--lu-subtle)]">
                                                (opcional){onsetLabel ? ` · ${onsetLabel}` : ""}
                                            </span>
                                        </summary>
                                        <div className="pt-2">
                                            <OnsetSelector
                                                value={onset}
                                                onChange={onOnsetChange}
                                                birthDate={birthDate}
                                                symptomName={target.description}
                                            />
                                        </div>
                                    </details>
                                ) : (
                                    <OnsetSelector
                                        value={onset}
                                        onChange={onOnsetChange}
                                        birthDate={birthDate}
                                        symptomName={target.description}
                                    />
                                )}
                            </section>
                        )}

                        {current && current.hijos.length >= FILTER_FROM && (
                            <label className="mb-3 block">
                                <span className="sr-only">Buscar entre los tipos</span>
                                <input
                                    type="search"
                                    value={filter}
                                    onChange={(event) => setFilter(event.target.value)}
                                    placeholder={`Buscar entre ${current.hijos.length} tipos`}
                                    className="w-full rounded-xl border border-[var(--lu-border-strong)] bg-white px-4 py-2.5 text-base text-[var(--lu-text)] placeholder:text-[var(--lu-subtle)] focus:border-[var(--lu-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--lu-accent-light)]"
                                />
                            </label>
                        )}

                        {loading && (
                            <ul className="space-y-2" aria-busy="true" aria-label="Cargando tipos">
                                {[0, 1, 2, 3].map((i) => (
                                    <li key={i} className="h-[68px] animate-pulse rounded-2xl bg-[var(--lu-surface)]" />
                                ))}
                            </ul>
                        )}

                        {!loading && failed && (
                            <div className="rounded-2xl border border-[var(--lu-border)] bg-[var(--lu-surface)] p-5 text-center">
                                <p className="font-semibold text-[var(--lu-text)]">No pudimos cargar los tipos.</p>
                                <p className="mt-1 text-sm text-[var(--lu-subtle)]">
                                    El síntoma sigue cargado como estaba; podés reintentar o cerrar.
                                </p>
                                <button
                                    type="button"
                                    onClick={() => void load(current?.termino.hpo_id ?? target?.code ?? "", levels.length === 0)}
                                    className="mt-3 min-h-[44px] rounded-xl border border-[var(--lu-border-strong)] bg-white px-4 text-sm font-semibold text-[var(--lu-text)] hover:bg-[var(--lu-surface)]"
                                >
                                    Reintentar
                                </button>
                            </div>
                        )}

                        {!loading && !failed && current && (
                            <>
                                <p className="text-sm font-semibold text-[var(--lu-text)]">
                                    {levels.length === 1 ? "Elegí el que mejor lo describa" : `Tipos de «${current.termino.nombre}»`}
                                </p>
                                <p className="mb-3 mt-0.5 text-xs leading-relaxed text-[var(--lu-subtle)]">
                                    Tocá un tipo para elegirlo. Si tiene variantes más específicas, el botón{" "}
                                    <span className="whitespace-nowrap">«Ver tipos»</span> las muestra. Primero
                                    los que abarcan más genes.
                                </p>
                                {shown.length === 0 ? (
                                    <p className="rounded-2xl border border-dashed border-[var(--lu-border)] px-4 py-6 text-center text-sm text-[var(--lu-subtle)]">
                                        {filter ? "Ningún tipo coincide con la búsqueda." : "No hay tipos más específicos con datos."}
                                    </p>
                                ) : (
                                    <ul className="space-y-2">
                                        {shown.map((child) => {
                                            return (
                                                <li
                                                    key={child.hpo_id}
                                                    className="flex items-stretch overflow-hidden rounded-2xl border border-[var(--lu-border)] bg-white transition-colors hover:border-[var(--lu-accent)]"
                                                >
                                                    <button
                                                        type="button"
                                                        onClick={() => choose(child)}
                                                        className="group flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left hover:bg-[var(--lu-accent-light)]/40 focus-visible:bg-[var(--lu-accent-light)]/40 focus-visible:outline-none"
                                                        aria-label={`Elegir ${child.nombre}, aparece en ${genesLabel(child.genes)}`}
                                                    >
                                                        <span className="min-w-0 flex-1">
                                                            <span className="block font-semibold leading-snug text-[var(--lu-text)]">
                                                                {child.nombre}
                                                            </span>
                                                            <span className="mt-1 block text-xs text-[var(--lu-subtle)]">
                                                                aparece en {genesLabel(child.genes)}
                                                            </span>
                                                        </span>
                                                        <span className="shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold text-[var(--lu-accent-text)] opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                                                            Elegir
                                                        </span>
                                                    </button>
                                                    {child.tiene_hijos && (
                                                        <button
                                                            type="button"
                                                            onClick={() => void load(child.hpo_id, false)}
                                                            className="flex shrink-0 items-center gap-1 border-l border-[var(--lu-border)] px-3 text-sm font-medium text-[var(--lu-accent-text)] hover:bg-[var(--lu-surface)]"
                                                            aria-label={`Ver tipos de ${child.nombre}`}
                                                        >
                                                            <span>Ver tipos</span>
                                                            <span aria-hidden className="text-lg leading-none">›</span>
                                                        </button>
                                                    )}
                                                </li>
                                            );
                                        })}
                                    </ul>
                                )}
                            </>
                        )}
                    </div>

                    <div className="flex flex-col-reverse gap-2 border-t border-[var(--lu-border)] px-5 py-4 sm:flex-row sm:items-center sm:justify-end sm:px-7">
                        <Dialog.Close className="min-h-[44px] rounded-xl border border-[var(--lu-border-strong)] bg-white px-4 text-sm font-semibold text-[var(--lu-text)] hover:bg-[var(--lu-surface)]">
                            {refinable && onset === null ? "Dejarlo como está" : "Listo"}
                        </Dialog.Close>
                        {levels.length > 1 && current && (
                            <button
                                type="button"
                                onClick={() => choose(current.termino)}
                                className="min-h-[44px] rounded-xl bg-[var(--lu-accent-text)] px-4 text-sm font-semibold text-white hover:bg-[#134e4a]"
                            >
                                Usar «{current.termino.nombre}»
                            </button>
                        )}
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
