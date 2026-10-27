import { adminClient, errorResponse, HttpError } from "@/lib/server/auth";
import { requireAdmin } from "@/lib/hostly/server";

export const dynamic = "force-dynamic";

// Raise or lower an agent action's autonomy level (blueprint 2.0, 14.5). Owners/admins only; the
// database refuses anything above the action's ceiling, and every change lands in the audit log.
export async function POST(req: Request) {
  try {
    const user = await requireAdmin(req);
    const b = (await req.json().catch(() => ({}))) as { agent?: string; action?: string; level?: number };
    const level = Number(b.level);
    if (!b.agent || !b.action || !Number.isInteger(level) || level < 0 || level > 4) throw new HttpError(400, "Send agent, action and level 0-4");
    const db = adminClient();
    const { data: row } = await db.from("hostly_autonomy").select("max_level").eq("agent", b.agent).eq("action", b.action).maybeSingle();
    if (!row) throw new HttpError(404, "Unknown agent action");
    if (level > row.max_level) throw new HttpError(400, `This action can't go above L${row.max_level}`);
    const { error } = await db.from("hostly_autonomy").update({ level, updated_by: user.email }).eq("agent", b.agent).eq("action", b.action);
    if (error) throw error;
    return Response.json({ ok: true, level });
  } catch (e) {
    return errorResponse(e);
  }
}
