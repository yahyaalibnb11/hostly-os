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
    if (!aiReady()) throw new HttpError(503, "AI abhi connect nahi. Vercel mein ANTHROPIC_API_KEY lagani hogi.");
    const b = (await req.json().catch(() => ({}))) as { images?: { type?: string; data?: string }[] };
    return Response.json({ result: await scanListingImages(b.images ?? []) });
  } catch (e) {
    if (e instanceof Anthropic.APIError) return Response.json({ error: e.status === 401 ? "Anthropic API key galat hai" : `AI se rabta nahi hua (${e.status ?? "network"})` }, { status: 502 });
    return errorResponse(e);
  }
}
