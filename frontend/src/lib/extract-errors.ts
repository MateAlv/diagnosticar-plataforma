// What to tell a person when free-text analysis is refused. The gateway says
// which limit it was in `detail.error`, and how long until it lifts in
// `detail.retry_after` (seconds); see docs/EXTRACTION_LIMITS.md in
// diagnostic.ar-api.

const BUSCADOR = "Mientras tanto, podés cargar los síntomas con el buscador.";

export function esperaLegible(segundos: number): string {
  if (!Number.isFinite(segundos) || segundos <= 90) return "un minuto";
  const minutos = Math.ceil(segundos / 60);
  if (minutos < 60) return `${minutos} minutos`;
  const horas = Math.ceil(segundos / 3600);
  if (horas < 24) return horas === 1 ? "una hora" : `${horas} horas`;
  const dias = Math.ceil(segundos / 86400);
  return dias === 1 ? "un día" : `${dias} días`;
}

function detalle(payload: unknown): { error?: string; retry_after?: number } {
  if (!payload || typeof payload !== "object") return {};
  const detail = (payload as { detail?: unknown }).detail;
  if (!detail || typeof detail !== "object") return {};
  const { error, retry_after } = detail as { error?: unknown; retry_after?: unknown };
  return {
    error: typeof error === "string" ? error : undefined,
    retry_after: typeof retry_after === "number" ? retry_after : undefined,
  };
}

export function mensajeErrorExtraccion(status: number, payload: unknown): string {
  if (status === 401 || status === 403) {
    return "Tu sesión expiró. Volvé a iniciar sesión para analizar el texto.";
  }
  if (status === 429) {
    const { error, retry_after } = detalle(payload);
    if (error === "global-budget") {
      const cuando = retry_after ? ` Volvé a intentar en ${esperaLegible(retry_after)}.` : "";
      return `El análisis automático de texto alcanzó su límite de uso.${cuando} ${BUSCADOR}`;
    }
    if (error === "user-rate-limit") {
      const cuando = retry_after ? ` Podés volver a intentar en ${esperaLegible(retry_after)}.` : "";
      return `Llegaste al límite de análisis de texto por ahora.${cuando} ${BUSCADOR}`;
    }
    return "Hiciste muchas consultas seguidas. Esperá un momento y volvé a intentar.";
  }
  if (status === 503) {
    return "El servicio está ocupado en este momento. Probá de nuevo en unos segundos.";
  }
  return `No pudimos analizar el texto. Probá de nuevo en unos minutos. ${BUSCADOR}`;
}
