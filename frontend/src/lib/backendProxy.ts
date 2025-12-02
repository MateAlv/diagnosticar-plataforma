const backendBase =
  process.env.BACKEND_API_URL ??
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  "http://localhost:8080/api";

function buildBackendUrl(path: string): string {
  if (!path.startsWith("/")) {
    return `${backendBase.replace(/\/$/, "")}/${path}`;
  }
  return `${backendBase.replace(/\/$/, "")}${path}`;
}

function copySetCookie(from: Headers, to: Headers) {
  const getSetCookie = (from as unknown as { getSetCookie?: () => string[] }).getSetCookie?.();
  if (Array.isArray(getSetCookie) && getSetCookie.length > 0) {
    for (const value of getSetCookie) {
      to.append("set-cookie", value);
    }
    return;
  }
  const raw = (from as unknown as { raw?: () => Record<string, string[]> }).raw?.();
  const rawCookies = raw?.["set-cookie"];
  if (Array.isArray(rawCookies) && rawCookies.length > 0) {
    for (const value of rawCookies) {
      to.append("set-cookie", value);
    }
    return;
  }
  const cookie = from.get("set-cookie");
  if (cookie) {
    to.append("set-cookie", cookie);
  }
}

export async function proxyFetch(
  req: Request,
  path: string,
  init: RequestInit = {}
): Promise<Response> {
  const target = buildBackendUrl(path);
  const headers = new Headers(init.headers ?? {});
  const incomingCookie = req.headers.get("cookie");
  if (incomingCookie && !headers.has("cookie")) {
    headers.set("cookie", incomingCookie);
  }
  const response = await fetch(target, {
    ...init,
    headers,
    redirect: "manual",
  });
  return response;
}

export async function forwardResponse(source: globalThis.Response): Promise<Response> {
  const body = await source.text();
  const headers = new Headers();
  const contentType = source.headers.get("content-type");
  if (contentType) {
    headers.set("content-type", contentType);
  }
  copySetCookie(source.headers, headers);
  return new Response(body, {
    status: source.status,
    headers,
  });
}

export function backendUrl(path: string): string {
  return buildBackendUrl(path);
}
