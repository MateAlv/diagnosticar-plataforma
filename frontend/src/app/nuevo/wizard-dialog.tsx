"use client";

import * as Dialog from "@radix-ui/react-dialog";
import type { ReactNode, RefObject } from "react";

/**
 * A short confirmation over the wizard. Radix holds focus inside, closes on
 * Escape and gives focus back to what opened it. The body scrolls and the
 * actions stay at the foot, so with the text enlarged on a phone the buttons
 * are still reachable.
 */
export function WizardDialog({
    open,
    onOpenChange,
    title,
    description,
    children,
    actions,
    returnFocusTo,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    title: string;
    description: ReactNode;
    children?: ReactNode;
    actions: ReactNode;
    /** What opened it. Without a Radix trigger, focus is not sent back on its own. */
    returnFocusTo?: RefObject<HTMLElement | null>;
}) {
    return (
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
            <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm motion-safe:animate-[modal-fade_.2s_ease]" />
                <Dialog.Content
                    onCloseAutoFocus={(event) => {
                        const origen = returnFocusTo?.current;
                        if (!origen) return;
                        event.preventDefault();
                        origen.focus();
                    }}
                    className="fixed left-1/2 top-1/2 z-40 flex max-h-[calc(100dvh-2rem)] w-[min(32rem,calc(100vw-2.5rem))] -translate-x-1/2 -translate-y-1/2 flex-col rounded-[28px] border border-[var(--lu-border)] bg-white shadow-2xl motion-safe:animate-[modal-fade_.2s_ease]">
                    <div className="min-h-0 overflow-y-auto px-6 pt-6 sm:px-8 sm:pt-8">
                        <Dialog.Title className="text-xl font-bold text-[var(--lu-text)]">{title}</Dialog.Title>
                        <Dialog.Description className="mt-2 text-sm leading-relaxed text-[var(--lu-subtle)]">
                            {description}
                        </Dialog.Description>
                        {children}
                    </div>
                    <div className="flex flex-wrap justify-end gap-3 px-6 pb-6 pt-6 sm:px-8 sm:pb-8">{actions}</div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
