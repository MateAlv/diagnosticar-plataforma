// What a person reads when a request fails, for every call the app makes.
//
// The servers answer in several shapes and languages: Express sends
// `{error, code}` in English, the FastAPI services send `detail` as a string,
// an array or an object, and a proxy in between can answer with an HTML page.
// None of that text is ever shown. A failure is reduced to its kind, status
// and machine code, and the message is written here, in Spanish, with what to
// do next. The server's own text is kept on the error only for the console.

import { esperaLegible, mensajeErrorExtraccion } from "./extract-errors";

export type ErrorKind = "offline" | "network" | "timeout" | "aborted" | "http" | "bad_response" | "unknown";

export type ErrorContext =
  | "login"
  | "signup"
  | "verify"
  | "change_password"
  | "admin"
  | "admin_invite"
  | "admin_revoke"
  | "patients_list"
  | "save"
  | "rank_genes"
  | "extract"
  | "hpo_search"
  | "gene_profiles";

export class ApiError extends Error {
  readonly kind: ErrorKind;
  /** 0 when no response arrived. */
  readonly status: number;
  readonly code: string | null;
  readonly retryAfterSeconds: number | null;
  /** The parsed body, for callers that need a field other than the code. Never rendered. */
  readonly body: unknown;

  constructor(
    kind: ErrorKind,
    init: { status?: number; code?: string | null; retryAfterSeconds?: number | null; body?: unknown; serverText?: string } = {},
  ) {
    super(init.serverText || kind);
    this.name = "ApiError";
    this.kind = kind;
    this.status = init.status ?? 0;
    this.code = init.code ?? null;
    this.retryAfterSeconds = init.retryAfterSeconds ?? null;
    this.body = init.body ?? null;
  }
}

const CODE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

function codeFrom(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const { code, detail } = body as { code?: unknown; detail?: unknown };
  if (typeof code === "string" && CODE.test(code)) return code;
  if (detail && typeof detail === "object" && !Array.isArray(detail)) {
    const inner = (detail as { error?: unknown }).error;
    if (typeof inner === "string" && CODE.test(inner)) return inner;
  }
  return null;
}

function retryAfterFrom(res: Response, body: unknown): number | null {
  const header = Number(res.headers.get("Retry-After"));
  if (Number.isFinite(header) && header > 0) return Math.ceil(header);
  if (body && typeof body === "object") {
    const { retryAfter, detail } = body as { retryAfter?: unknown; detail?: unknown };
    if (typeof retryAfter === "number" && retryAfter > 0) return Math.ceil(retryAfter);
    const inner = detail && typeof detail === "object" ? (detail as { retry_after?: unknown }).retry_after : null;
    if (typeof inner === "number" && inner > 0) return Math.ceil(inner);
  }
  return null;
}

function serverTextFrom(body: unknown, raw: string): string {
  if (body && typeof body === "object") {
    const { error, detail } = body as { error?: unknown; detail?: unknown };
    if (typeof error === "string") return error;
    if (typeof detail === "string") return detail;
    if (detail !== undefined) return JSON.stringify(detail);
  }
  return raw.slice(0, 200);
}

/** Reads a failed response without throwing, whatever its body is. */
export async function readApiError(res: Response): Promise<ApiError> {
  const raw = await res.text().catch(() => "");
  let body: unknown = null;
  try {
    body = raw ? JSON.parse(raw) : null;
  } catch {
    body = null;
  }
  return new ApiError("http", {
    status: res.status,
    code: codeFrom(body),
    retryAfterSeconds: retryAfterFrom(res, body),
    body,
    serverText: `HTTP ${res.status}: ${serverTextFrom(body, raw)}`,
  });
}

/** Whatever was thrown, as an ApiError: fetch's TypeError, an abort, a bad JSON body. */
export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  const name = error instanceof Error ? error.name : "";
  const text = error instanceof Error ? error.message : String(error);
  if (name === "AbortError") return new ApiError("aborted", { serverText: text });
  if (name === "TimeoutError") return new ApiError("timeout", { serverText: text });
  if (name === "SyntaxError") return new ApiError("bad_response", { serverText: text });
  if (error instanceof TypeError) {
    const offline = typeof navigator !== "undefined" && navigator.onLine === false;
    return new ApiError(offline ? "offline" : "network", { serverText: text });
  }
  return new ApiError("unknown", { serverText: text });
}

/** Throws the response's ApiError when it is not ok; returns its JSON otherwise. */
export async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) throw await readApiError(res);
  try {
    return (await res.json()) as T;
  } catch (error) {
    throw new ApiError("bad_response", { status: res.status, serverText: String(error) });
  }
}

/**
 * "en 5 minutos", "en un minuto", "en unos segundos". The header is an upper
 * bound, and nobody has a use for "3540 segundos".
 */
export function waitText(seconds: number | null): string {
  if (!seconds || seconds <= 0) return "en unos minutos";
  if (seconds <= 20) return "en unos segundos";
  return `en ${esperaLegible(seconds)}`;
}

/** A 401 or 403 that means the session is gone, not a refusal of this one request. */
export function isSessionError(error: unknown): boolean {
  const e = toApiError(error);
  if (e.kind !== "http") return false;
  if (e.status === 401) return e.code !== "invalid_credentials" && e.code !== "invalid_current_password";
  return e.status === 403 && !NOT_SESSION_403.has(e.code ?? "");
}

const NOT_SESSION_403 = new Set(["csrf_mismatch", "invalid_origin", "PASSWORD_CHANGE_REQUIRED", "consent_required"]);

export const SESSION_MESSAGE = "Tu sesión se cerró. Iniciá sesión de nuevo para continuar.";
const BUSCADOR = "Mientras tanto, podés cargar los síntomas con el buscador.";

function byKind(e: ApiError): string | null {
  switch (e.kind) {
    case "aborted":
      return "";
    case "offline":
      return "Estás sin conexión a internet. Lo que cargaste sigue en esta pantalla; cuando vuelva la conexión, probá de nuevo.";
    case "network":
      return "No pudimos conectarnos con Diagnostic.ar. Revisá tu conexión y probá de nuevo en unos segundos.";
    case "timeout":
      return "El servidor tardó demasiado en responder. Probá de nuevo en unos segundos.";
    case "bad_response":
      return "Recibimos una respuesta inesperada. Recargá la página y probá de nuevo.";
    case "unknown":
      return "Algo salió mal. Probá de nuevo en unos segundos.";
    default:
      return null;
  }
}

function byContext(e: ApiError, context: ErrorContext | undefined): string | null {
  const { status, code } = e;
  const espera = waitText(e.retryAfterSeconds);
  switch (context) {
    case "login":
      if (code === "invalid_credentials" || status === 401) return "El email o la contraseña no son correctos.";
      if (status === 400) return "Revisá el email y la contraseña: la contraseña tiene al menos 8 caracteres.";
      if (status === 429) return `Hubo muchos intentos de inicio de sesión desde tu conexión. Probá de nuevo ${espera}.`;
      return null;
    case "signup":
      if (status === 400) {
        const field = (e.body as { field?: unknown } | null)?.field;
        if (field === "password") return "La contraseña tiene que tener entre 8 y 128 caracteres.";
        return "Revisá el email: parece que no es válido.";
      }
      if (status === 429) return `Se crearon varias cuentas desde esta conexión hace poco. Probá de nuevo ${espera}.`;
      return null;
    case "verify":
      if (status === 400) return "El enlace no es válido o ya venció. Pedí uno nuevo desde la pantalla de inicio de sesión.";
      if (status === 429) return `Hubo muchos intentos. Probá de nuevo ${espera}.`;
      return null;
    case "change_password":
      if (code === "weak_password") return "La contraseña nueva tiene que tener al menos 12 caracteres y ser distinta de la temporal.";
      if (code === "invalid_current_password" || code === "invalid_credentials")
        return "La contraseña temporal no es correcta. Revisala: distingue mayúsculas de minúsculas.";
      if (status === 429) return `Hubo muchos intentos. Probá de nuevo ${espera}.`;
      return null;
    case "admin_invite":
      if (code === "invalid_email" || status === 400) return "Ingresá un email válido.";
      if (code === "email_taken" || status === 409) return "Ya existe una cuenta con ese email.";
      if (status === 429) return `Llegaste al límite de invitaciones por ahora. Probá de nuevo ${espera}.`;
      return null;
    case "admin_revoke":
      if (code === "cannot_revoke_self") return "No podés quitarte a vos mismo el acceso de administración.";
      if (code === "last_admin") return "No se puede quitar al único administrador. Invitá a otra persona primero.";
      if (status === 404) return "Esa persona ya no es administradora. Recargá la página para ver la lista actual.";
      return null;
    case "save":
      if (status === 404) return "Esta persona ya no está en tu cuenta. Podés empezar una búsqueda nueva para guardarla.";
      if (status === 413) return "La historia clínica es demasiado larga para guardarla. Acortala y probá de nuevo.";
      if (status === 429) return `Guardaste muchas búsquedas en poco tiempo. Probá de nuevo ${espera}.`;
      if (status >= 500) return "No pudimos guardar el resultado en tu cuenta. Probá de nuevo en unos minutos.";
      return null;
    case "rank_genes":
      if (code === "no-known-hpo-ids")
        return "Ninguno de los síntomas cargados se puede usar todavía para buscar genes. Probá con otros síntomas, o con uno más general del buscador.";
      if (status === 422) return "Uno de los síntomas cargados tiene un código que no reconocemos. Quitalo y probá de nuevo.";
      if (status === 503) return "El modelo de Diagnostic.ar se está iniciando. Probá de nuevo en un minuto; los síntomas cargados siguen acá.";
      if (status >= 500) return "No pudimos buscar genes en este momento. Probá de nuevo en unos minutos; los síntomas cargados siguen acá.";
      return null;
    case "extract":
      if (status === 422)
        return `El texto está vacío o es demasiado largo para analizarlo (máximo 10.000 caracteres). ${BUSCADOR}`;
      if (status === 401 || status === 403 || status === 429 || status === 503)
        return mensajeErrorExtraccion(status, e.body);
      if (status >= 500) return `No pudimos analizar el texto. Probá de nuevo en unos minutos. ${BUSCADOR}`;
      return null;
    case "hpo_search":
      return "No pudimos buscar ahora. Probá de nuevo en unos segundos.";
    case "patients_list":
      return null;
    default:
      return null;
  }
}

function byStatus(e: ApiError): string {
  const espera = waitText(e.retryAfterSeconds);
  if (e.code === "PASSWORD_CHANGE_REQUIRED") return "Antes de seguir tenés que cambiar tu contraseña temporal.";
  if (e.code === "consent_required")
    return "Para guardar la búsqueda falta tu autorización para tratar datos de salud. Recargá la página para darla.";
  if (e.code === "consent_version_mismatch")
    return "Los términos cambiaron. Recargá la página, leelos y volvé a aceptar.";
  if (e.code === "csrf_mismatch" || e.code === "invalid_origin")
    return "Tu sesión necesita actualizarse. Recargá la página y probá de nuevo.";
  if (isSessionError(e)) return SESSION_MESSAGE;
  switch (e.status) {
    case 400:
      return "No pudimos procesar los datos enviados. Revisá lo que cargaste y probá de nuevo.";
    case 404:
      return "No encontramos lo que buscabas; puede que se haya borrado. Volvé a la lista y probá de nuevo.";
    case 409:
      return "Esto cambió en otra pestaña o ventana. Recargá la página para ver la versión actual.";
    case 413:
      return "Lo que enviaste es demasiado largo. Acortalo y probá de nuevo.";
    case 422:
      return "Algunos datos no son válidos. Revisalos y probá de nuevo.";
    case 429:
      return `Hay demasiados pedidos desde tu conexión. Probá de nuevo ${espera}.`;
    case 500:
      return "Algo falló de nuestro lado. Probá de nuevo en unos minutos.";
    case 502:
    case 503:
      return `El servicio no está disponible en este momento. Probá de nuevo ${e.retryAfterSeconds ? espera : "en unos minutos"}.`;
    case 504:
      return "El servicio tardó demasiado en responder. Probá de nuevo en unos minutos.";
    default:
      return "Algo salió mal. Probá de nuevo en unos segundos.";
  }
}

/**
 * The one place that turns a failure into text for the screen. Never returns
 * the server's wording or an exception message. An aborted request returns
 * "", which callers treat as nothing to show.
 */
export function errorMessage(error: unknown, context?: ErrorContext): string {
  const e = toApiError(error);
  if (e.kind === "network" && context === "extract")
    return `No pudimos conectarnos para analizar el texto. Revisá tu conexión. ${BUSCADOR}`;
  if (e.kind === "network" && context === "rank_genes")
    return "No pudimos conectarnos con el modelo de Diagnostic.ar. Revisá tu conexión; los síntomas cargados siguen acá.";
  return byKind(e) ?? byContext(e, context) ?? byStatus(e);
}
