import { forwardResponse, proxyFetch } from "../../../../lib/backendProxy";

export async function POST(req: Request) {
  try {
    const body = await req.text();
    const backendResponse = await proxyFetch(req, "/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    return forwardResponse(backendResponse);
  } catch (error) {
    console.error("[frontend/api/auth/register] backend error", error);
    return Response.json({ error: "backend-unreachable" }, { status: 502 });
  }
}
