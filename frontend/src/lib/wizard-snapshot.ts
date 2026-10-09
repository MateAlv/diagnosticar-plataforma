/**
 * Where /nuevo keeps the search in progress, so a reload or a browser
 * back/forward brings it back instead of an empty first step. It is
 * sessionStorage: it dies with the tab, the wizard drops it when the person
 * leaves for another page, and signing out clears it with the rest of the
 * clinical data kept on the device.
 */
export const WIZARD_SNAPSHOT_KEY = "diagnosticar:wizard";

const VERSION = 1;

/**
 * Whether this page came back rather than being opened: a reload or a
 * back/forward of the document at `pathname`. Opening /nuevo afresh, even in
 * the same tab, starts a new search.
 */
export function cameBackTo(pathname: string): boolean {
    try {
        const [entry] = performance.getEntriesByType("navigation") as PerformanceNavigationTiming[];
        if (!entry || (entry.type !== "reload" && entry.type !== "back_forward")) return false;
        return new URL(entry.name).pathname === pathname;
    } catch {
        return false;
    }
}

/** Whose search it is: the account's id, or "demo" for the trial without one. */
export function readWizardSnapshot<T>(owner: string): T | null {
    try {
        const raw = window.sessionStorage.getItem(WIZARD_SNAPSHOT_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as { v?: unknown; owner?: unknown; state?: T };
        if (parsed?.v !== VERSION || parsed.owner !== owner || !parsed.state) return null;
        return parsed.state;
    } catch {
        return null;
    }
}

export function writeWizardSnapshot<T>(owner: string, state: T): void {
    try {
        window.sessionStorage.setItem(WIZARD_SNAPSHOT_KEY, JSON.stringify({ v: VERSION, owner, state }));
    } catch {
        // Full or blocked storage: a reload starts over, as it always did.
    }
}

export function clearWizardSnapshot(): void {
    try {
        window.sessionStorage.removeItem(WIZARD_SNAPSHOT_KEY);
    } catch {
        // Nothing was kept.
    }
}
