"use client";

import { useEffect, useState } from "react";

/** Tailwind's `lg`, where the results screen switches to master-detail. */
const WIDE = "(min-width: 1024px)";

/**
 * Whether the viewport is wide enough for the master-detail layout.
 *
 * The two layouts render the *same* gene content, so hiding one with CSS is
 * not enough: both would sit in the DOM, and a screen reader, a find-in-page
 * or a test would meet every summary twice. Only one may be mounted.
 *
 * Starts false so the server and the first client render agree — a hydration
 * mismatch here would swap the whole panel — and corrects after mount.
 */
export function useWideScreen(): boolean {
    const [wide, setWide] = useState(false);

    useEffect(() => {
        const query = window.matchMedia(WIDE);
        setWide(query.matches);
        const onChange = (event: MediaQueryListEvent) => setWide(event.matches);
        query.addEventListener("change", onChange);
        return () => query.removeEventListener("change", onChange);
    }, []);

    return wide;
}
