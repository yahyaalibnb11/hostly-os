/* eslint-disable @typescript-eslint/no-explicit-any */
import Anthropic from "@anthropic-ai/sdk";
import { adminClient, errorResponse, HttpError } from "@/lib/server/auth";
import { aiReady } from "@/lib/server/env";
import { MAX_IMAGES, scanListingImages } from "@/lib/scan/listing";
import { requireScout } from "@/lib/scout/server";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

const SCAN_BUCKET = "scout-scans";

// Screenshots in, listing fields out. The student checks everything before saving.
// Normally the phone first uploads each screenshot to storage (see ./upload) and sends only the file paths;
// the AI reads them through short-lived signed links, and the files are deleted afterwards.
export async function POST(req: Request) {
  let paths: string[] = [];
  try {
    const me = await requireScout(req);
    if (!aiReady()) throw new HttpError(503, "AI isn't connected yet. Add ANTHROPIC_API_KEY in Vercel.");
    const b = (await req.json().catch(() => ({}))) as { images?: { type?: string; data?: string }[]; paths?: unknown };
    if (Array.isArray(b.paths) && b.paths.length) {
      paths = b.paths.filter((p): p is string => typeof p === "string" && p.startsWith(`${me.id}/`) && !p.includes("..")).slice(0, MAX_IMAGES);
      if (!paths.length) throw new HttpError(400, "Add at least one screenshot");
      const { data, error } = await adminClient().storage.from(SCAN_BUCKET).createSignedUrls(paths, 600);
      if (error || !data) throw new HttpError(500, "Couldn't open the uploaded screenshots. Try again.");
      const urls = data.map(d => d.signedUrl).filter((u): u is string => Boolean(u));
      if (urls.length !== paths.length) throw new HttpError(400, "Some screenshots didn't upload. Try again.");
      return Response.json({ result: await scanListingImages(urls.map(url => ({ url }))) });
    }
    return Response.json({ result: await scanListingImages(b.images ?? []) });
  } catch (e) {
    if (e instanceof Anthropic.APIError) {
      console.error("scan: AI error", e.status, e.message);
      const why = e.status === 400 ? `: ${String((e as any).error?.error?.message ?? e.message).slice(0, 140)}` : "";
      return Response.json({ error: e.status === 401 ? "The Anthropic API key is wrong" : `Couldn't reach the AI (${e.status ?? "network"})${why}` }, { status: 502 });
    }
    return errorResponse(e);
  } finally {
    if (paths.length) await adminClient().storage.from(SCAN_BUCKET).remove(paths).catch(() => {});
  }
}
