/**
 * At most one holder per key, without waiting: a second caller is refused
 * rather than queued.
 *
 * In-process only, which is enough while the backend runs as a single
 * container; a second replica would need the lock in Postgres instead.
 */
export function createKeyedLock() {
    const held = new Set<string>();

    return {
        /** Returns a release function, or null when the key is already held. */
        tryAcquire(key: string): (() => void) | null {
            if (held.has(key)) return null;
            held.add(key);
            let released = false;
            return () => {
                if (released) return;
                released = true;
                held.delete(key);
            };
        },
    };
}
