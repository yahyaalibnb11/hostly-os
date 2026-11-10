import { adminClient, errorResponse, HttpError } from "@/lib/server/auth";
import { aiReady } from "@/lib/server/env";
import { LISTING_COLS, requireScout, visibleTo } from "@/lib/scout/server";

export const dynamic = "force-dynamic";

// Everything the Scout screen needs: who I am, the team with upload counts, and every saved listing.
export async function GET(req: Request) {
  try {
    const me = await requireScout(req);
    const db = adminClient();
    const [members, listings] = await Promise.all([
      db.from("scout_members").select("id, name, is_admin, daily_goal, pin_hash").order("created_at"),
      db.from("scout_listings").select(LISTING_COLS).is("deleted_at", null).order("created_at", { ascending: false }).limit(5000),
    ]);
    if (members.error) throw new HttpError(500, members.error.message);
    if (listings.error) throw new HttpError(500, listings.error.message);
    return Response.json({
      me, ai: aiReady(),
      members: (members.data ?? []).map(({ pin_hash, ...m }) => ({ ...m, has_pin: Boolean(pin_hash) })),
      listings: (listings.data ?? []).map(l => visibleTo(me, l)),
    }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}
