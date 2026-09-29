import { ReactNode } from "react";

// Clipped rather than hidden, for the same reason as the page's <main>: a
// hidden overflow makes a scroll container, which scrollIntoView can move and
// which keeps anything sticky inside it from sticking to the screen.
export default function NuevoLayout({ children }: { children: ReactNode }) {
    return (
        <div className="theme-medphenai min-h-screen bg-[var(--lu-bg)] text-[var(--lu-text)] overflow-x-clip">
            {children}
        </div>
    );
}
