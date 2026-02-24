"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function DemoPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/nuevo?demo=1");
  }, [router]);

  return (
    <main className="page-root relative min-h-screen flex items-center justify-center bg-[var(--lu-bg)]">
      <div className="text-sm text-[var(--lu-subtle)]">Cargando modo demostración…</div>
    </main>
  );
}
