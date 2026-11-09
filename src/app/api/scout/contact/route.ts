import Anthropic from "@anthropic-ai/sdk";
import { errorResponse, HttpError } from "@/lib/server/auth";
import { aiReady } from "@/lib/server/env";
import { findHostContact, type ContactInput } from "@/lib/scan/contact";
import { requireScout } from "@/lib/scout/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Host name, city and title in; public website / social pages, approach points and next steps out.
export async function POST(req: Request) {
  try {
    await requireScout(req);
    if (!aiReady()) throw new HttpError(503, "AI isn't connected yet. Add ANTHROPIC_API_KEY in Vercel.");
    const b = (await req.json().catch(() => ({}))) as ContactInput;
    return Response.json({ result: await findHostContact(b) });
  } catch (e) {
    if (e instanceof Anthropic.APIError) return Response.json({ error: e.status === 401 ? "The Anthropic API key is wrong" : `Couldn't reach the AI (${e.status ?? "network"})` }, { status: 502 });
    return errorResponse(e);
  }
}
