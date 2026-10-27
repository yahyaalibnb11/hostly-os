import { errorResponse, HttpError } from "@/lib/server/auth";
import { processBatch } from "@/lib/hostly/engine";
import { serverExecutors } from "@/lib/hostly/executors";
import { cronOk, hostlyStore } from "@/lib/hostly/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// The scheduler's entry point (Authorization: Bearer CRON_SECRET).
// Every run: retry due events. With ?daily=1 (once each morning): queue each live property's price review
// and the Exec Copilot's morning brief. The external ids carry the date, so a second daily call is harmless.
export async function GET(req: Request) {
  try {
    if (!cronOk(req)) throw new HttpError(401, "Bad or missing CRON_SECRET");
    const store = hostlyStore();
    const url = new URL(req.url);
    const queued: string[] = [];
    if (url.searchParams.get("daily") === "1") {
      const day = new Date().toISOString().slice(0, 10);
      for (const p of await store.liveProperties()) {
        const r = await store.insertEvent({ source: "scheduler", external_id: `pricing:${p.code}:${day}`, type: "pricing.review", payload: { property_code: p.code } });
        if (!r.duplicate) queued.push(`pricing.review ${p.code}`);
      }
      const b = await store.insertEvent({ source: "scheduler", external_id: `brief:${day}`, type: "brief.daily", payload: {} });
      if (!b.duplicate) queued.push("brief.daily");
    }
    const report = await processBatch(store, { limit: 50, executors: serverExecutors() });
    return Response.json({ queued, report });
  } catch (e) {
    return errorResponse(e);
  }
}
