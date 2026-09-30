"use client";

/**
 * The last resort, when the root layout itself fails: it replaces the whole
 * document, so it carries its own <html> and no styles from the app.
 */
export default function GlobalError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
    return (
        <html lang="es">
            <body style={{ fontFamily: "system-ui, sans-serif", display: "flex", minHeight: "100vh", alignItems: "center", justifyContent: "center", margin: 0, background: "#f8fafc", color: "#334155" }}>
                <div role="alert" style={{ maxWidth: 420, padding: 32, textAlign: "center" }}>
                    <h1 style={{ fontSize: 24, margin: 0 }}>Algo falló de nuestro lado</h1>
                    <p style={{ lineHeight: 1.6, color: "#64748b" }}>
                        Tus datos guardados no se perdieron. Probá de nuevo en unos minutos.
                    </p>
                    <button type="button" onClick={() => retry()} style={{ marginTop: 16, padding: "12px 20px", borderRadius: 12, border: 0, background: "#115e59", color: "#fff", fontWeight: 600, cursor: "pointer" }}>
                        Probar de nuevo
                    </button>
                </div>
            </body>
        </html>
    );
}
