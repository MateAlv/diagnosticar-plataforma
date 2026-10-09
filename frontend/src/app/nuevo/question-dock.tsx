"use client";

import * as Dialog from "@radix-ui/react-dialog";
import {
    useCallback,
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
    useSyncExternalStore,
    type KeyboardEvent,
    type ReactElement,
    type ReactNode,
    type RefObject,
} from "react";
import { launcherState } from "@/lib/question-launcher";
import { MAX_ROUNDS } from "@/lib/questions-api";
import type { QuestionPhase } from "@/lib/question-session";
import { QuestionIcon, RefreshIcon, SummaryIcon } from "./icons";
import { INLINE_ACTION, TEXT_LINK, scrollBehavior } from "./panel-styles";
import { QuestionPanelBody, QuestionPanelHeader, type QuestionPanelBodyProps } from "./question-panel";
import type { QuestionSessionState } from "./use-question-session";

/**
 * Where the question panel lives: beside the genes rather than between them
 * and the specialities, brought into view and put away at will, with the
 * session going on either way (docs/QUESTION_PANEL_DESIGN.md, section 5).
 *
 *   ≥ 1280 px    docked: a sticky column beside the grid, which reflows to
 *                two columns, so answers and the reordering list are seen
 *                together. Complementary, not modal.
 *   768–1279 px  a drawer from the right, modal, over a dimmed page.
 *   < 768 px     a sheet from the bottom, modal, most of the screen.
 *
 * While hidden, a launcher pinned to the corner says where the session
 * stands. Nothing here opens the panel on its own: a round that lands while
 * it is hidden is announced by the launcher, never pushed on screen.
 */

export const PANEL_ID = "panel-preguntas";

/** The docked panel's top: the page header (97 px, pinned from tablets up) and a 16 px gap. */
const DOCK_TOP = 113;
const DOCK_GAP = 16;

export type PanelVariant = "docked" | "drawer" | "sheet";
export type PanelOpener = "launcher" | "teaser" | "header";

function subscribe(query: string) {
    return (onChange: () => void) => {
        const list = window.matchMedia(query);
        list.addEventListener("change", onChange);
        return () => list.removeEventListener("change", onChange);
    };
}

const WIDE = "(min-width: 1280px)";
const MEDIUM = "(min-width: 768px)";
const subscribeWide = subscribe(WIDE);
const subscribeMedium = subscribe(MEDIUM);

export function usePanelVariant(): PanelVariant {
    const wide = useSyncExternalStore(subscribeWide, () => window.matchMedia(WIDE).matches, () => false);
    const medium = useSyncExternalStore(subscribeMedium, () => window.matchMedia(MEDIUM).matches, () => false);
    return wide ? "docked" : medium ? "drawer" : "sheet";
}

export type QuestionPanelControl = ReturnType<typeof useQuestionPanel>;

/**
 * Whether the panel is out, and what the launcher needs to know while it is
 * not. Kept by the page, above the panel, since the panel unmounts when
 * hidden and none of this may go with it.
 *
 * `resetKey` is the diagnosis: a new search starts with the panel put away.
 */
export function useQuestionPanel(state: QuestionSessionState, resetKey: string | null) {
    const variant = usePanelVariant();
    const [open, setOpen] = useState(false);
    // A round that landed while the panel was hidden, not looked at yet.
    const [unseen, setUnseen] = useState(false);
    // A round that reordered the list while a drawer or sheet covered it.
    const [listFresh, setListFresh] = useState(false);
    const openRef = useRef(open);
    const opener = useRef<PanelOpener>("launcher");
    const afterHide = useRef<(() => void) | null>(null);

    useEffect(() => {
        openRef.current = open;
    }, [open]);

    useEffect(() => {
        setOpen(false);
        setUnseen(false);
        setListFresh(false);
    }, [resetKey]);

    const token = state.focusToken;
    const lastToken = useRef(token);
    useEffect(() => {
        if (token === lastToken.current) return;
        lastToken.current = token;
        if (!openRef.current) setUnseen(true);
    }, [token]);

    const change = state.lastChange;
    useEffect(() => {
        if (change && openRef.current) setListFresh(true);
    }, [change]);

    const show = useCallback((from: PanelOpener) => {
        opener.current = from;
        afterHide.current = null;
        setUnseen(false);
        setOpen(true);
    }, []);

    /** Puts the panel away; `then` runs once it is gone, in place of returning focus to what opened it. */
    const hide = useCallback((then?: () => void) => {
        afterHide.current = then ?? null;
        setListFresh(false);
        setOpen(false);
    }, []);

    /** Called once the panel has left the screen. */
    const settleHidden = useCallback(() => {
        if (openRef.current) return;
        const then = afterHide.current;
        afterHide.current = null;
        if (then) {
            then();
            return;
        }
        const from =
            document.querySelector<HTMLElement>(`[data-panel-opener="${opener.current}"]`) ??
            document.querySelector<HTMLElement>('[data-panel-opener="launcher"]');
        from?.focus();
    }, []);

    // A dialog says when it is gone (its close autofocus); the docked panel
    // simply unmounts, so its leaving is caught here, after the render that
    // put the launcher back.
    const wasOpen = useRef(open);
    useEffect(() => {
        if (wasOpen.current && !open && variant === "docked") requestAnimationFrame(settleHidden);
        wasOpen.current = open;
    }, [open, variant, settleHidden]);

    return {
        variant,
        open,
        listFresh,
        launcher: launcherState(state, unseen),
        show,
        hide,
        settleHidden,
    };
}

type FrameProps = {
    control: QuestionPanelControl;
    state: QuestionSessionState;
    disclaimer: string;
    body: Omit<QuestionPanelBodyProps, "listCue" | "onShowList" | "state" | "disclaimer">;
    /** Puts the list with the answers in the grid, takes the reader there and focuses its title. */
    onSeeList: () => void;
};

/** The panel, in the frame the screen width calls for. Renders nothing while it is hidden. */
export function QuestionSidePanel(props: FrameProps) {
    const { control } = props;
    if (control.variant === "docked") return control.open ? <DockedFrame {...props} /> : null;
    return <DialogFrame {...props} />;
}

/**
 * How tall the docked panel is: from where it sits to the foot of the screen,
 * and never past the end of the results beside it. Sticky alone would let
 * the end of the results push the panel up at the bottom of the page, taking
 * its header and the disclaimer with it; sized this way it is never pushed.
 * Below the floor it gives in and scrolls away with the page, as a last resort
 * on a screen too short for it.
 */
function dockHeight(aside: HTMLElement): number {
    const column = aside.previousElementSibling?.getBoundingClientRect();
    const row = aside.parentElement?.getBoundingClientRect();
    const top = Math.max(row?.top ?? DOCK_TOP, DOCK_TOP);
    const bottom = Math.min(window.innerHeight - DOCK_GAP, column?.bottom ?? Infinity);
    return Math.round(Math.max(DOCK_FLOOR, Math.min(bottom - top, dockFull())));
}

const DOCK_FLOOR = 360;
const dockFull = () => window.innerHeight - DOCK_TOP - DOCK_GAP;

function DockedFrame({ control, state, disclaimer, body, onSeeList }: FrameProps) {
    const asideRef = useRef<HTMLElement | null>(null);
    const titleRef = useRef<HTMLHeadingElement | null>(null);

    // Fitted before the first paint, then on every scroll, resize and change
    // in the results' height, one frame at a time.
    useLayoutEffect(() => {
        const aside = asideRef.current;
        if (!aside) return;
        let frame = 0;
        const fit = () => {
            frame = 0;
            aside.style.height = `${dockHeight(aside)}px`;
        };
        const schedule = () => {
            if (!frame) frame = requestAnimationFrame(fit);
        };
        fit();
        window.addEventListener("scroll", schedule, { passive: true });
        window.addEventListener("resize", schedule);
        const observer = new ResizeObserver(schedule);
        if (aside.previousElementSibling) observer.observe(aside.previousElementSibling);
        return () => {
            cancelAnimationFrame(frame);
            window.removeEventListener("scroll", schedule);
            window.removeEventListener("resize", schedule);
            observer.disconnect();
        };
    }, []);

    // Opening moves focus in, as the reader asked for the panel. When little
    // of it would fit where the page stands (the results start low on the
    // screen, or end high on it), the page moves just enough for the panel
    // to have its full height.
    useEffect(() => {
        titleRef.current?.focus({ preventScroll: true });
        const aside = asideRef.current;
        const row = aside?.parentElement?.getBoundingClientRect();
        const column = aside?.previousElementSibling?.getBoundingClientRect();
        if (!aside || !row || !column || dockHeight(aside) >= dockFull() * 0.7) return;
        const shortBy = window.innerHeight - DOCK_GAP - column.bottom;
        const offset = row.top > DOCK_TOP ? row.top - DOCK_TOP : shortBy > 0 ? -shortBy : 0;
        if (offset !== 0) window.scrollBy({ top: offset, behavior: scrollBehavior() });
    }, []);

    // Esc puts the panel away only from inside it: the docked panel does not
    // hold focus, and a key pressed elsewhere on the page is not meant for it.
    const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
        if (event.key !== "Escape" || event.defaultPrevented) return;
        event.preventDefault();
        control.hide();
    };

    return (
        <aside
            ref={asideRef}
            id={PANEL_ID}
            role="complementary"
            aria-labelledby="preguntas-titulo"
            aria-busy={state.pending !== null}
            data-question-panel
            data-variant="docked"
            data-phase={state.phase}
            onKeyDown={onKeyDown}
            style={{ top: DOCK_TOP }}
            className="sticky z-10 flex w-[420px] shrink-0 flex-col overflow-hidden rounded-3xl border border-[var(--lu-border)] bg-white shadow-sm motion-safe:animate-[dock-in_220ms_cubic-bezier(0.2,0,0,1)] print:static print:h-auto! print:w-auto print:overflow-visible print:rounded-none print:border-0 print:shadow-none"
        >
            <PanelSurface
                variant="docked"
                state={state}
                disclaimer={disclaimer}
                body={body}
                titleId="preguntas-titulo"
                titleRef={titleRef}
                onHide={() => control.hide()}
                onShowList={onSeeList}
                listFresh={false}
                onSeeList={onSeeList}
            />
        </aside>
    );
}

const DRAWER =
    "fixed bottom-2 right-2 top-2 z-50 flex w-[min(440px,92vw)] flex-col overflow-hidden rounded-3xl bg-white shadow-[0_24px_64px_-12px_rgba(15,23,42,0.35)] focus:outline-none motion-safe:data-[state=open]:animate-[drawer-in_220ms_cubic-bezier(0.2,0,0,1)] motion-safe:data-[state=closed]:animate-[drawer-out_180ms_ease-in]";

const SHEET =
    "fixed inset-x-0 bottom-0 z-50 flex h-[92dvh] flex-col overflow-hidden rounded-t-3xl bg-white shadow-[0_-24px_60px_-20px_rgba(15,23,42,0.4)] focus:outline-none motion-safe:data-[state=open]:animate-[sheet-in_220ms_cubic-bezier(0.2,0,0,1)] motion-safe:data-[state=closed]:animate-[sheet-out_180ms_ease-in]";

const PRINT_FLAT =
    "print:static print:inset-auto print:h-auto print:w-auto print:overflow-visible print:rounded-none print:shadow-none print:animate-none!";

function DialogFrame({ control, state, disclaimer, body, onSeeList }: FrameProps) {
    const titleRef = useRef<HTMLHeadingElement | null>(null);
    const variant = control.variant;
    return (
        <Dialog.Root open={control.open} onOpenChange={(next) => !next && control.hide()}>
            <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-[2px] motion-safe:data-[state=open]:animate-[panel-fade-in_220ms_ease-out] motion-safe:data-[state=closed]:animate-[panel-fade-out_180ms_ease-in] print:hidden" />
                <Dialog.Content
                    id={PANEL_ID}
                    aria-describedby={undefined}
                    aria-busy={state.pending !== null}
                    data-question-panel
                    data-variant={variant}
                    data-phase={state.phase}
                    onOpenAutoFocus={(event) => {
                        event.preventDefault();
                        titleRef.current?.focus();
                    }}
                    // Back to what opened it, or to the list for "Ver la
                    // lista"; the launcher it opened from was re-rendered
                    // while the panel was out, so Radix cannot find it.
                    onCloseAutoFocus={(event) => {
                        event.preventDefault();
                        control.settleHidden();
                    }}
                    className={`${variant === "drawer" ? DRAWER : SHEET} ${PRINT_FLAT}`}
                >
                    <PanelSurface
                        variant={variant}
                        state={state}
                        disclaimer={disclaimer}
                        body={body}
                        titleRef={titleRef}
                        wrapTitle={(title) => <Dialog.Title asChild>{title}</Dialog.Title>}
                        onHide={() => control.hide()}
                        onShowList={() => control.hide(onSeeList)}
                        listFresh={control.listFresh}
                        onSeeList={() => control.hide(onSeeList)}
                    />
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}

/**
 * The header and the scrolling body, the same in every frame. When a round
 * the reader asked for lands, the body goes back to its top and focus moves
 * to the round's heading, or to the title once the questions are over.
 */
function PanelSurface({
    variant,
    state,
    disclaimer,
    body,
    titleId,
    titleRef,
    wrapTitle,
    onHide,
    onShowList,
    listFresh,
    onSeeList,
}: {
    variant: PanelVariant;
    state: QuestionSessionState;
    disclaimer: string;
    body: FrameProps["body"];
    titleId?: string;
    titleRef: RefObject<HTMLHeadingElement | null>;
    wrapTitle?: (title: ReactElement) => ReactNode;
    onHide: () => void;
    onShowList: () => void;
    listFresh: boolean;
    onSeeList: () => void;
}) {
    const roundHeadingRef = useRef<HTMLHeadingElement | null>(null);
    const scrollRef = useRef<HTMLDivElement | null>(null);
    const seenToken = useRef(state.focusToken);
    const { focusToken, phase } = state;

    useEffect(() => {
        if (focusToken === seenToken.current) return;
        seenToken.current = focusToken;
        scrollRef.current?.scrollTo({ top: 0 });
        const target = phase === "questions" ? roundHeadingRef.current : titleRef.current;
        target?.focus({ preventScroll: true });
    }, [focusToken, phase, titleRef]);

    return (
        <>
            <QuestionPanelHeader
                state={state}
                disclaimer={disclaimer}
                titleId={titleId}
                titleRef={titleRef}
                roundHeadingRef={roundHeadingRef}
                wrapTitle={wrapTitle}
                onHide={onHide}
                hideToward={variant === "sheet" ? "down" : "right"}
                handle={variant === "sheet"}
            />
            <div
                ref={scrollRef}
                data-panel-scroll
                className="@container flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain print:overflow-visible"
            >
                {listFresh && <ListUpdated applied={state.phase === "finished"} onSeeList={onSeeList} />}
                <QuestionPanelBody
                    {...body}
                    state={state}
                    disclaimer={disclaimer}
                    onShowList={listFresh ? null : onShowList}
                    listCue={variant === "docked" ? "←" : null}
                />
            </div>
        </>
    );
}

/**
 * Over a drawer or a sheet the list is out of sight, so a round that
 * produced an order with the answers says so first thing, with the way to
 * see it. While the questions go on the grid keeps the model's own order, so
 * it says there is one; once they end the grid has taken it on by itself.
 */
function ListUpdated({ applied, onSeeList }: { applied: boolean; onSeeList: () => void }) {
    return (
        <div
            data-list-updated
            className="flex items-center gap-3 border-b border-[var(--lu-accent-light)] bg-[color-mix(in_oklab,var(--lu-accent-light)_40%,white)] px-5 py-1 print:hidden"
        >
            <RefreshIcon className="h-4 w-4 shrink-0 text-[var(--lu-accent-text)]" />
            <p className="min-w-0 flex-1 text-sm font-semibold text-[var(--lu-accent-text)]">
                {applied ? "La lista ya está ordenada con tus respuestas" : "Hay una lista con tus respuestas"}
            </p>
            <button type="button" onClick={onSeeList} className={TEXT_LINK}>
                Verla
            </button>
        </div>
    );
}

/**
 * The way back to the panel while it is hidden, pinned bottom right (bottom
 * centre on a phone), saying where the session stands: not started,
 * questions waiting, a round being prepared or ready, or finished.
 */
export function QuestionLauncher({ control }: { control: QuestionPanelControl }) {
    const { kind, label, detail, round } = control.launcher;
    const dialog = control.variant !== "docked";
    const icon =
        kind === "preparing" ? (
            <span className="h-4 w-4 rounded-full border-2 border-white/35 border-t-white motion-safe:animate-spin" />
        ) : kind === "finished" ? (
            <SummaryIcon className="h-[18px] w-[18px]" />
        ) : (
            <QuestionIcon className="h-[18px] w-[18px]" />
        );

    return (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))] md:justify-end md:px-6 md:pb-6 print:hidden">
            <button
                type="button"
                data-question-launcher={kind}
                data-panel-opener="launcher"
                aria-expanded={false}
                aria-controls={PANEL_ID}
                aria-haspopup={dialog ? "dialog" : undefined}
                onClick={() => control.show("launcher")}
                className="pointer-events-auto relative inline-flex h-[52px] max-w-full items-center gap-3 rounded-full bg-[var(--lu-accent-text)] pl-2 pr-5 text-left text-white shadow-[0_14px_32px_-10px_rgba(17,94,89,0.65),0_2px_6px_rgba(15,23,42,0.12)] ring-1 ring-white/10 hover:bg-[color-mix(in_oklab,var(--lu-accent-text)_88%,#000)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-[var(--lu-accent-text)] motion-safe:animate-[launcher-in_220ms_cubic-bezier(0.2,0,0,1)] motion-safe:transition-colors"
            >
                <span aria-hidden="true" className="relative grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/15">
                    {icon}
                    {kind === "ready" && (
                        <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full bg-[var(--lu-accent-light)] ring-2 ring-[var(--lu-accent-text)]">
                            <span className="absolute inset-0 rounded-full bg-[var(--lu-accent-light)] motion-safe:animate-ping" />
                        </span>
                    )}
                </span>
                <span className="flex min-w-0 flex-col leading-tight">
                    <span className="truncate text-[15px] font-semibold">{label}</span>
                    {detail && (
                        <span className="mt-0.5 flex items-center gap-1.5 text-xs text-white/85">
                            {round !== null && (
                                <span aria-hidden="true" className="flex gap-[3px]">
                                    {Array.from({ length: MAX_ROUNDS }, (_, index) => (
                                        <span
                                            key={index}
                                            className={`h-[5px] w-3.5 rounded-full ${index < round ? "bg-white" : "bg-white/30"}`}
                                        />
                                    ))}
                                </span>
                            )}
                            <span className="truncate">{detail}</span>
                        </span>
                    )}
                </span>
            </button>
        </div>
    );
}

/**
 * A second way in, above the grid, in words: with twenty genes a phone has
 * six screens of cards, and the launcher alone is easy to take for a chat.
 */
export function RefineTeaser({ phase, control }: { phase: QuestionPhase; control: QuestionPanelControl }) {
    const [lead, action] =
        phase === "idle"
            ? ["¿Querés afinar esta lista?", "Respondé unas preguntas"]
            : phase === "questions"
              ? ["Las preguntas siguen abiertas.", "Volver a las preguntas"]
              : ["Terminaste las preguntas.", "Ver el resumen para la consulta"];
    return (
        <p data-refine-teaser className="text-xs leading-relaxed text-[var(--lu-text)]">
            {lead}{" "}
            <button
                type="button"
                data-panel-opener="teaser"
                aria-expanded={false}
                aria-controls={PANEL_ID}
                aria-haspopup={control.variant !== "docked" ? "dialog" : undefined}
                onClick={() => control.show("teaser")}
                className={INLINE_ACTION}
            >
                {action}
            </button>
        </p>
    );
}

/**
 * The way in from the grid's own header, beside the view and list controls.
 * Not on a phone, where the launcher already sits at the bottom of the screen
 * and the header's controls would stack three deep.
 */
export function RefineButton({ control }: { control: QuestionPanelControl }) {
    return (
        <button
            type="button"
            data-panel-opener="header"
            aria-expanded={false}
            aria-controls={PANEL_ID}
            aria-haspopup={control.variant !== "docked" ? "dialog" : undefined}
            onClick={() => control.show("header")}
            className="hidden min-h-[44px] shrink-0 items-center gap-2 rounded-xl border border-[color-mix(in_oklab,var(--lu-accent)_45%,white)] md:flex bg-[color-mix(in_oklab,var(--lu-accent-light)_45%,white)] px-3.5 text-sm font-semibold text-[var(--lu-accent-text)] hover:bg-[var(--lu-accent-light)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lu-accent-text)] motion-safe:transition-colors"
        >
            <QuestionIcon className="h-4 w-4" />
            Afinar con preguntas
        </button>
    );
}
