import { randomUUID } from "crypto";
import { adminClient, errorResponse, HttpError } from "@/lib/server/auth";
import { MAX_IMAGES } from "@/lib/scan/listing";
import { requireScout } from "@/lib/scout/server";

export const dynamic = "force-dynamic";

// Hands the phone one signed upload link per screenshot, so each image goes straight to storage
// in its own small request instead of one big request through Vercel (which stops at 4.5 MB).
export async function POST(req: Request) {
  try {
    const me = await requireScout(req);
    const b = (await req.json().catch(() => ({}))) as { count?: unknown };
    const n = Number(b.count);
    if (!Number.isInteger(n) || n < 1 || n > MAX_IMAGES) throw new HttpError(400, `Send 1 to ${MAX_IMAGES} screenshots`);
    const batch = randomUUID();
    const store = adminClient().storage.from("scout-scans");
    const uploads = await Promise.all(Array.from({ length: n }, async (_, i) => {
      const path = `${me.id}/${batch}/${i}.jpg`;
      const { data, error } = await store.createSignedUploadUrl(path);
      if (error || !data) throw new HttpError(500, "Couldn't prepare the upload. Try again.");
      return { path, url: data.signedUrl };
    }));
    return Response.json({ uploads });
  } catch (e) {
    return errorResponse(e);
  }
}
