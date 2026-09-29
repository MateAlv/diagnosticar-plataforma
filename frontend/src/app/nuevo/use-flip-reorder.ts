"use client";

import { useLayoutEffect, useRef, type RefObject } from "react";
import { prefersReducedMotion } from "./panel-styles";

/** Long enough to follow a card to its new place, short enough not to wait on. */
const DURATION_MS = 250;

/**
 * Slides the grid's cards from their old places to their new ones when the
 * order changes, so a reorder can be followed rather than just happening.
 * Nothing moves for anyone who asked for less motion.
 *
 * Only a reorder the reader asked for slides: `armed` is set by whatever
 * switches the list and spent by the next reorder. A round landing on the
 * view with the answers reorders it too, and that one just happens, so a
 * change the reader did not ask for does not draw the eye to itself.
 *
 * Every item carries `data-flip-key`. Places are measured after each render
 * relative to the list, which is `position: relative`, so scrolling between
 * renders does not skew them.
 */
export function useFlipReorder(listRef: RefObject<HTMLElement | null>, order: string, armed: RefObject<boolean>) {
    const places = useRef(new Map<string, { x: number; y: number }>());
    const lastOrder = useRef(order);

    useLayoutEffect(() => {
        const list = listRef.current;
        if (!list) {
            places.current = new Map();
            lastOrder.current = order;
            return;
        }
        const items = Array.from(list.querySelectorAll<HTMLElement>("[data-flip-key]"));
        const next = new Map(items.map((item) => [item.dataset.flipKey ?? "", { x: item.offsetLeft, y: item.offsetTop }]));
        const before = places.current;
        const reordered = lastOrder.current !== order;
        places.current = next;
        lastOrder.current = order;
        if (!reordered) return;
        const asked = armed.current;
        armed.current = false;
        if (!asked || before.size === 0 || prefersReducedMotion()) return;

        for (const item of items) {
            const was = before.get(item.dataset.flipKey ?? "");
            const now = next.get(item.dataset.flipKey ?? "");
            if (!was || !now) continue;
            const dx = was.x - now.x;
            const dy = was.y - now.y;
            if (dx === 0 && dy === 0) continue;
            item.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "translate(0, 0)" }], {
                duration: DURATION_MS,
                easing: "cubic-bezier(0.2, 0, 0, 1)",
            });
        }
    });
}
