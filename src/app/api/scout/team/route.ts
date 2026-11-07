import { adminClient, errorResponse, HttpError } from "@/lib/server/auth";
import { hashPin, pinOk, requireScout } from "@/lib/scout/server";

export const dynamic = "force-dynamic";

// Change a PIN or a daily goal. Everyone can change their own PIN; Yahya (admin) can change anyone's,
// set goals, and add a new team member.
export async function POST(req: Request) {
  try {
    const me = await requireScout(req);
    const b = (await req.json().catch(() => ({}))) as { member_id?: string; pin?: unknown; daily_goal?: unknown; add_name?: unknown };
    const db = adminClient();
    if (typeof b.add_name === "string") {
      if (!me.is_admin) throw new HttpError(403, "Sirf Yahya naya member add kar sakta hai");
      const name = b.add_name.trim().slice(0, 40);
      if (!name) throw new HttpError(400, "Naam likho");
      if (!pinOk(b.pin)) throw new HttpError(400, "PIN 6 digits ka rakho");
      const { error } = await db.from("scout_members").insert({ name, pin_hash: hashPin(b.pin) });
      if (error) throw new HttpError(400, error.code === "23505" ? "Ye naam pehle se hai" : error.message);
      return Response.json({ ok: true });
    }
    const target = b.member_id || me.id;
    if (target !== me.id && !me.is_admin) throw new HttpError(403, "Sirf apna PIN badal sakte ho");
    const patch: Record<string, unknown> = {};
    if (b.pin !== undefined) {
      if (!pinOk(b.pin)) throw new HttpError(400, "PIN 6 digits ka rakho");
      patch.pin_hash = hashPin(b.pin); patch.failed_attempts = 0; patch.locked_until = null;
    }
    if (b.daily_goal !== undefined) {
      if (!me.is_admin) throw new HttpError(403, "Sirf Yahya target set kar sakta hai");
      const g = Number(b.daily_goal);
      if (!Number.isInteger(g) || g < 1 || g > 200) throw new HttpError(400, "Target 1 se 200 ke beech");
      patch.daily_goal = g;
    }
    if (!Object.keys(patch).length) throw new HttpError(400, "Kuch badla nahi");
    const { error } = await db.from("scout_members").update(patch).eq("id", target);
    if (error) throw new HttpError(400, error.message);
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
