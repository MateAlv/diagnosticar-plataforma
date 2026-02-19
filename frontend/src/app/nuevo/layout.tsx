import { ReactNode } from "react";

export default function NuevoLayout({ children }: { children: ReactNode }) {
    return (
        <div className="theme-medphenai min-h-screen bg-[var(--lu-bg)] text-[var(--lu-text)] overflow-x-hidden">
            {children}
        </div>
    );
}
