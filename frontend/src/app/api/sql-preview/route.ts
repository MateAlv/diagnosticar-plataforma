import { forwardResponse, proxyFetch } from "../../../lib/backendProxy";

export async function POST(req: Request) {
  let sql: string | undefined;
  try {
    const payload = await req.json();
    sql = payload?.sql;
  } catch {
    sql = (await req.text())?.trim();
  }

  if (!sql) {
    return Response.json({ detail: "sql-required" }, { status: 400 });
  }

  try {
    const backendResponse = await proxyFetch(req, "/chat/sql-preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sql }),
    });
    return forwardResponse(backendResponse);
  } catch (error) {
    console.error("[frontend/api/sql-preview] backend error", error);
    return Response.json({ detail: "backend-unreachable" }, { status: 502 });
  }
}
