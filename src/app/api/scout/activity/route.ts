import { adminClient, errorResponse, HttpError } from "@/lib/server/auth";
import { logActivity, requireScout } from "@/lib/scout/server";

export const dynamic = "force-dynamic";

const ACTIONS = ["open", "download"];

// The app reports when someone opens a listing or downloads the sheet.
export async function POST(req: Request) {
  try {
    const me = await requireScout(req);
    const b = (await req.json().catch(() => ({}))) as { action?: string; listing_id?: string; detail?: string };
    if (!ACTIONS.includes(String(b.action))) throw new HttpError(400, "Unknown action");
    await logActivity(me.id, String(b.action), typeof b.listing_id === "string" && /^[0-9a-f-]{36}$/.test(b.listing_id) ? b.listing_id : null, String(b.detail ?? ""));
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}

// Yahya only: the latest 300 things people did.
export async function GET(req: Request) {
  try {
    const me = await requireScout(req);
    if (!me.is_admin) throw new HttpError(403, "Only Yahya can see the activity log");
    const { data, error } = await adminClient().from("scout_activity").select("id, member_id, action, listing_id, detail, at, scout_listings(title, link)").order("at", { ascending: false }).limit(300);
    if (error) throw new HttpError(500, error.message);
    return Response.json({ activity: data ?? [] }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}
