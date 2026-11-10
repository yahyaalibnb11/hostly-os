/* eslint-disable @typescript-eslint/no-explicit-any */
import Anthropic from "@anthropic-ai/sdk";
import { errorResponse, HttpError } from "@/lib/server/auth";
import { aiReady } from "@/lib/server/env";
import { scanListingImages } from "@/lib/scan/listing";
import { requireScout } from "@/lib/scout/server";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

// Screenshots in, listing fields out. The student checks everything before saving.
export async function POST(req: Request) {
  try {
    await requireScout(req);
    if (!aiReady()) throw new HttpError(503, "AI isn't connected yet. Add ANTHROPIC_API_KEY in Vercel.");
    const b = (await req.json().catch(() => ({}))) as { images?: { type?: string; data?: string }[] };
    return Response.json({ result: await scanListingImages(b.images ?? []) });
  } catch (e) {
    if (e instanceof Anthropic.APIError) {
      console.error("scan: AI error", e.status, e.message);
      const why = e.status === 400 ? `: ${String((e as any).error?.error?.message ?? e.message).slice(0, 140)}` : "";
      return Response.json({ error: e.status === 401 ? "The Anthropic API key is wrong" : `Couldn't reach the AI (${e.status ?? "network"})${why}` }, { status: 502 });
    }
    return errorResponse(e);
  }
}
