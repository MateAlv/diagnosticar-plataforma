import { forwardResponse, proxyFetch } from "../../../../lib/backendProxy";

export async function POST(req: Request) {
  try {
    const backendResponse = await proxyFetch(req, "/auth/logout", {
      method: "POST",
    });
    return forwardResponse(backendResponse);
  } catch (error) {
    console.error("[frontend/api/auth/logout] backend error", error);
    return Response.json({ error: "backend-unreachable" }, { status: 502 });
  }
}
