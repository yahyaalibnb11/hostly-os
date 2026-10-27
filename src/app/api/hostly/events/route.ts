import { errorResponse, HttpError, requireTeamUser } from "@/lib/server/auth";
import { BadEvent } from "@/lib/hostly/agents";
import { ingest, processBatch, type IngestInput } from "@/lib/hostly/engine";
import { serverExecutors } from "@/lib/hostly/executors";
import { hostlyStore, signatureOk } from "@/lib/hostly/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// The front door of the event bus. PMS/channel webhooks (signed with HOSTLY_WEBHOOK_SECRET) and signed-in
// teammates post events here: one event, or {"events": [...]} with up to 100.
// Each event is stored once per (source, external_id), then the agents run on it straight away;
// anything that fails is retried by the scheduler.
//   {"source": "hostaway", "external_id": "res-123-v4", "type": "reservation.upsert", "payload": {...}}
export async function POST(req: Request) {
  try {
    const raw = await req.text();
    if (raw.length > 1_000_000) throw new HttpError(413, "Too large");
    if (!signatureOk(raw, req.headers.get("x-hostly-signature"))) await requireTeamUser(req);
    let body: unknown;
    try { body = JSON.parse(raw); } catch { throw new HttpError(400, "Body must be JSON"); }
    const list = (body && typeof body === "object" && Array.isArray((body as { events?: unknown }).events) ? (body as { events: unknown[] }).events : [body]) as IngestInput[];
    if (!list.length || list.length > 100) throw new HttpError(400, "Send 1 to 100 events");

    const store = hostlyStore();
    const accepted: { external_id: string; id: string | null; duplicate: boolean }[] = [];
    const rejected: { index: number; error: string }[] = [];
    for (const [i, e] of list.entries()) {
      try {
        const r = await ingest(store, { source: String(e?.source ?? ""), external_id: String(e?.external_id ?? ""), type: String(e?.type ?? ""), payload: e?.payload as Record<string, unknown> });
        accepted.push({ external_id: String(e.external_id), ...r });
      } catch (err) {
        if (!(err instanceof BadEvent)) throw err;
        rejected.push({ index: i, error: err.message });
      }
    }
    const report = accepted.some(a => !a.duplicate) ? await processBatch(store, { limit: 10, executors: serverExecutors() }) : null;
    return Response.json({ accepted, rejected, report }, { status: rejected.length && !accepted.length ? 400 : 200 });
  } catch (e) {
    return errorResponse(e);
  }
}
