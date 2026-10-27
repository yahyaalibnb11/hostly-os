import { randomUUID } from "node:crypto";
import { adminClient, errorResponse, HttpError, requireTeamUser } from "@/lib/server/auth";
import { ingest, processBatch } from "@/lib/hostly/engine";
import { serverExecutors } from "@/lib/hostly/executors";
import { hostlyStore } from "@/lib/hostly/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const OPEN = ["new", "drafted", "awaiting_approval", "escalated"];
const CHANNELS = ["airbnb", "vrbo", "booking", "whatsapp", "sms", "email", "other"];

// The guest inbox: the latest guest messages with the Guest helper's draft reply.
export async function GET(req: Request) {
  try {
    await requireTeamUser(req);
    const db = adminClient();
    const [msgs, props] = await Promise.all([
      db.from("hostly_messages").select("id, property_id, channel, direction, sender, body, intent, risk, draft_reply, status, created_at").order("created_at", { ascending: false }).limit(150),
      db.from("hostly_properties").select("id, code, name").neq("status", "offboarded").order("name"),
    ]);
    const err = [msgs, props].find(r => r.error)?.error;
    if (err) throw new HttpError(500, err.message);
    return Response.json({ messages: msgs.data, properties: props.data, open_statuses: OPEN }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}

// {action: "new", property_code, channel, from, body}: a guest message pasted from Airbnb/Vrbo (or typed
//   in), sent through the Guest helper so it gets a risk check and a draft reply.
// {action: "done", id, reply?}: the owner sent the reply themselves (or nothing was needed).
export async function POST(req: Request) {
  try {
    const user = await requireTeamUser(req);
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const str = (k: string, max: number) => (typeof b[k] === "string" ? (b[k] as string).trim().slice(0, max) : "");
    const db = adminClient();

    if (b.action === "new") {
      const body = str("body", 4000);
      if (!body) throw new HttpError(400, "Paste the guest's message");
      const channel = CHANNELS.includes(str("channel", 20)) ? str("channel", 20) : "other";
      const store = hostlyStore();
      const event = await ingest(store, {
        source: "inbox", external_id: randomUUID(), type: "guest.message",
        payload: { property_code: str("property_code", 40) || undefined, channel, from: str("from", 120) || "guest", body },
      });
      const report = await processBatch(store, { limit: 5, executors: serverExecutors() });
      return Response.json({ event, report });
    }

    if (b.action === "done") {
      const id = str("id", 40);
      if (!id) throw new HttpError(400, "Which message?");
      const { data: m, error } = await db.from("hostly_messages").select("id, property_id, reservation_id, channel, sender, status, draft_reply").eq("id", id).eq("direction", "in").maybeSingle();
      if (error) throw new HttpError(500, error.message);
      if (!m) throw new HttpError(404, "Message not found");
      const reply = str("reply", 8000);
      if (reply) {
        const { error: e2 } = await db.from("hostly_messages").insert({ property_id: m.property_id, reservation_id: m.reservation_id, channel: m.channel, direction: "out", sender: m.sender, body: reply, status: "sent" });
        if (e2) throw new HttpError(500, e2.message);
      }
      await db.from("hostly_messages").update({ status: reply ? "sent" : "closed" }).eq("id", id);
      // The reply went out by hand, so the helper's pending draft for this message is settled too.
      await db.from("hostly_approvals").update({ status: "approved", decided_by: user.email, decided_at: new Date().toISOString(), decision_note: "Sent by hand from the inbox", edited: !!reply && !!m.draft_reply && reply !== m.draft_reply.trim() })
        .eq("status", "pending").eq("payload->>message_id", id);
      await db.from("hostly_tasks").update({ status: "done" }).eq("dedupe_key", `reply:${id}`).in("status", ["open", "in_progress"]);
      return Response.json({ status: reply ? "sent" : "closed" });
    }
    throw new HttpError(400, "Unknown action");
  } catch (e) {
    return errorResponse(e);
  }
}
