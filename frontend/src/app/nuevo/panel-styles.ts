/**
 * The results screen's control styles, shared by the question panel's parts.
 * Every one uses --lu-accent-text for small text and solid fills, never the
 * accent itself, which fails contrast at these sizes.
 */

const FOCUS =
    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lu-accent-text)]";

export const PRIMARY = `inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-[var(--lu-accent-text)] px-5 text-sm font-semibold text-white shadow-sm motion-safe:transition-colors hover:bg-[color-mix(in_oklab,var(--lu-accent-text)_88%,#000)] disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`;

export const SECONDARY = `inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-[var(--lu-border-strong)] bg-white px-5 text-sm font-medium text-[var(--lu-text)] motion-safe:transition-colors hover:bg-[var(--lu-surface)] disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`;

export const GHOST = `inline-flex min-h-[44px] items-center gap-1.5 rounded-xl px-3 text-sm font-semibold text-[var(--lu-accent-text)] motion-safe:transition-colors hover:bg-[var(--lu-surface)] ${FOCUS}`;

/** Put the label and its arrow in one span: as separate flex items each gets its own underline. */
export const TEXT_LINK = `inline-flex min-h-[44px] items-center rounded-md text-sm font-semibold text-[var(--lu-accent-text)] underline decoration-[var(--lu-accent-light)] decoration-2 underline-offset-4 motion-safe:transition-colors hover:decoration-[var(--lu-accent-text)] ${FOCUS}`;

/**
 * A button inside a sentence, styled as its link: it wraps with the words
 * around it, and an invisible ::after reaches a 44px target without making
 * the line any taller.
 */
export const INLINE_ACTION = `relative inline rounded-md text-left font-semibold text-[var(--lu-accent-text)] underline decoration-[var(--lu-accent-light)] decoration-2 underline-offset-4 after:absolute after:inset-x-0 after:-inset-y-[14px] after:content-[''] motion-safe:transition-colors hover:decoration-[var(--lu-accent-text)] ${FOCUS}`;

/** The bar at the panel's foot that holds a state's main action, pinned while the body scrolls under it. */
export const ACTION_BAR =
    "sticky bottom-0 z-10 mt-auto border-t border-[var(--lu-border)] bg-white/95 px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-sm print:hidden";

export const EYEBROW = "font-mono text-[10.5px] uppercase tracking-[0.14em] text-[var(--lu-subtle)]";

export function prefersReducedMotion(): boolean {
    return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function scrollBehavior(): ScrollBehavior {
    return prefersReducedMotion() ? "auto" : "smooth";
}

/** The question panel's own scrolling body, which holds `element`, if it is in one. */
export function panelScroller(element: Element): HTMLElement | null {
    return element.closest<HTMLElement>("[data-panel-scroll]");
}

/**
 * Scrolls the panel's body, and only it, to bring `element` into view.
 * scrollIntoView would move every scrolling ancestor too, the page included,
 * which jolts the list beside a docked panel and cannot move behind a dialog.
 */
export function scrollInPanel(element: HTMLElement, block: "start" | "center") {
    const scroller = panelScroller(element);
    if (!scroller) {
        element.scrollIntoView({ block, behavior: scrollBehavior() });
        return;
    }
    const view = scroller.getBoundingClientRect();
    const rect = element.getBoundingClientRect();
    const offset = block === "start" ? rect.top - view.top - 16 : rect.top - view.top - (view.height - rect.height) / 2;
    scroller.scrollBy({ top: offset, behavior: scrollBehavior() });
}
