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
      if (!me.is_admin) throw new HttpError(403, "Only Yahya can add members");
      const name = b.add_name.trim().slice(0, 40);
      if (!name) throw new HttpError(400, "Enter a name");
      if (!pinOk(b.pin)) throw new HttpError(400, "The PIN must be 6 digits");
      const { error } = await db.from("scout_members").insert({ name, pin_hash: hashPin(b.pin) });
      if (error) throw new HttpError(400, error.code === "23505" ? "That name is already taken" : error.message);
      return Response.json({ ok: true });
    }
    const target = b.member_id || me.id;
    if (target !== me.id && !me.is_admin) throw new HttpError(403, "You can only change your own PIN");
    const patch: Record<string, unknown> = {};
    if (b.pin !== undefined) {
      if (!pinOk(b.pin)) throw new HttpError(400, "The PIN must be 6 digits");
      patch.pin_hash = hashPin(b.pin); patch.failed_attempts = 0; patch.locked_until = null;
    }
    if (b.daily_goal !== undefined) {
      if (!me.is_admin) throw new HttpError(403, "Only Yahya can set targets");
      const g = Number(b.daily_goal);
      if (!Number.isInteger(g) || g < 1 || g > 200) throw new HttpError(400, "Target must be between 1 and 200");
      patch.daily_goal = g;
    }
    if (!Object.keys(patch).length) throw new HttpError(400, "Nothing to change");
    const { error } = await db.from("scout_members").update(patch).eq("id", target);
    if (error) throw new HttpError(400, error.message);
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
