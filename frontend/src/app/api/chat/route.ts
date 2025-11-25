import { forwardResponse, proxyFetch } from "../../../lib/backendProxy";

export async function POST(req: Request) {
  let question: string | undefined;
  try {
    const payload = await req.json();
    question = payload?.question;
  } catch {
    // fallback to raw text
    question = (await req.text())?.trim();
  }

  if (!question) {
    return Response.json({ error: "question-required" }, { status: 400 });
  }

  try {
    const backendResponse = await proxyFetch(req, "/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question }),
    });
    return forwardResponse(backendResponse);
  } catch (error) {
    console.error("[frontend/api/chat] backend error", error);
    return Response.json({ error: "backend-unreachable" }, { status: 502 });
  }
}
