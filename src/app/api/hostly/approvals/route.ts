import { adminClient, errorResponse, HttpError, requireTeamUser } from "@/lib/server/auth";
import { serverExecutors } from "@/lib/hostly/executors";
import { HUMAN_ONLY } from "@/lib/hostly/policy";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Body = { id?: string; decision?: "approve" | "reject"; note?: string; payload?: Record<string, unknown> };

// A person decides on an agent's proposal. Approving runs it through the connected integration when there
// is one (Gmail, WhatsApp); otherwise it is marked approved for a person to carry out.
// L3/L4 and human-only actions need an owner or admin. Editing the draft before approving is allowed,
// and is recorded, since it counts against the agent's quality score.
export async function POST(req: Request) {
  try {
    const user = await requireTeamUser(req);
    const b = (await req.json().catch(() => ({}))) as Body;
    if (!b.id || (b.decision !== "approve" && b.decision !== "reject")) throw new HttpError(400, "Send id and decision (approve or reject)");
    const note = String(b.note || "").slice(0, 1000) || null;
    const db = adminClient();
    const { data: a, error } = await db.from("hostly_approvals").select("*").eq("id", b.id).maybeSingle();
    if (error) throw error;
    if (!a) throw new HttpError(404, "Not found");
    if (a.status !== "pending") throw new HttpError(409, `Already ${a.status}`);
    if (a.expires_at && Date.parse(a.expires_at) < Date.now() && b.decision === "approve") {
      await db.from("hostly_approvals").update({ status: "expired" }).eq("id", a.id);
      throw new HttpError(409, "This proposal expired; the agent will make a fresh one");
    }
    const senior = user.role === "owner" || user.role === "admin";
    if ((a.level === "L3" || a.level === "L4" || HUMAN_ONLY.has(a.action)) && !senior) throw new HttpError(403, "An owner or admin decides this one");

    // Claim the row so two people clicking at once can't both execute it.
    const decided = { decided_by: user.email, decided_at: new Date().toISOString(), decision_note: note };
    if (b.decision === "reject") {
      const { data } = await db.from("hostly_approvals").update({ status: "rejected", ...decided }).eq("id", a.id).eq("status", "pending").select("id");
      if (!data?.length) throw new HttpError(409, "Someone else decided this first");
      return Response.json({ status: "rejected" });
    }
    let payload = a.payload as Record<string, unknown>;
    let edited = false;
    if (b.payload && typeof b.payload === "object") {
      // Only the text fields of a draft can be edited; ids, recipients and amounts can't.
      for (const k of ["subject", "body"] as const) {
        if (typeof b.payload[k] === "string" && b.payload[k] !== payload[k]) { payload = { ...payload, [k]: String(b.payload[k]).slice(0, 20000) }; edited = true; }
      }
    }
    const { data: claimed } = await db.from("hostly_approvals").update({ status: "approved", payload, edited, ...decided }).eq("id", a.id).eq("status", "pending").select("id");
    if (!claimed?.length) throw new HttpError(409, "Someone else decided this first");

    const ex = serverExecutors()[a.action];
    if (!ex || !ex.ready()) {
      return Response.json({ status: "approved", manual: true, message: "Approved. No integration is connected for this action, so a teammate carries it out." });
    }
    try {
      const result = await ex.run(payload, { approvalId: a.id, actor: user.email });
      await db.from("hostly_approvals").update({ status: "executed", result }).eq("id", a.id);
      return Response.json({ status: "executed", result });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "failed";
      await db.from("hostly_approvals").update({ status: "failed", result: { error: msg } }).eq("id", a.id);
      throw new HttpError(502, `Approved, but sending failed: ${msg}`);
    }
  } catch (e) {
    return errorResponse(e);
  }
}
