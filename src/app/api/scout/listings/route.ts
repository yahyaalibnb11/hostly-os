import { adminClient, errorResponse, HttpError } from "@/lib/server/auth";
import { linkKey, marketById, MANAGED_BY, PROPERTY_TYPES, scoreListing, STATUSES } from "@/lib/scout/catalog";
import { LISTING_COLS, requireScout } from "@/lib/scout/server";

export const dynamic = "force-dynamic";

// Save a new listing or update one. The server recomputes the score and blocks duplicate links.
export async function POST(req: Request) {
  try {
    const me = await requireScout(req);
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const db = adminClient();
    const str = (k: string, max = 300) => (typeof b[k] === "string" ? (b[k] as string).trim().slice(0, max) : "");
    const n = (k: string, min: number, max: number, label: string, int = true) => {
      if (b[k] === "" || b[k] == null) return null;
      const v = Number(b[k]);
      if (!Number.isFinite(v) || v < min || v > max || (int && !Number.isInteger(v))) throw new HttpError(400, `${label} must be a number from ${min} to ${max}`);
      return int ? v : Math.round(v * 100) / 100;
    };

    const id = str("id", 40);
    let existing: { id: string; added_by: string } | null = null;
    if (id) {
      const { data } = await db.from("scout_listings").select("id, added_by").eq("id", id).is("deleted_at", null).maybeSingle();
      if (!data) throw new HttpError(404, "Listing not found");
      existing = data;
    }

    // Only the person who added a listing, or Yahya, can see or change it.
    if (existing && existing.added_by !== me.id && !me.is_admin) throw new HttpError(403, "Only the person who added this listing (or Yahya) can change it");

    // A status-only update (from the pipeline buttons).
    if (existing && Object.keys(b).every(k => ["id", "status", "pitch", "pitch_subject", "contact", "notes"].includes(k))) {
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if ("status" in b) { if (!STATUSES.some(s => s.id === b.status)) throw new HttpError(400, "Unknown status"); patch.status = b.status; }
      if ("pitch" in b) patch.pitch = str("pitch", 6000);
      if ("pitch_subject" in b) patch.pitch_subject = str("pitch_subject", 200);
      if ("contact" in b) patch.contact = str("contact", 300) || null;
      if ("notes" in b) patch.notes = str("notes", 3000);
      const { data, error } = await db.from("scout_listings").update(patch).eq("id", existing.id).select(LISTING_COLS).single();
      if (error) throw new HttpError(400, error.message);
      return Response.json({ listing: data });
    }
    const link = str("link", 1000);
    const key = linkKey(link);
    if (!key) throw new HttpError(400, "That link doesn't look right. Paste the full Airbnb / Vrbo / Booking link.");
    const market = marketById(str("market", 40));
    if (!market) throw new HttpError(400, "Pick a market");

    const row = {
      link, link_key: key, market: market.id,
      host_name: str("host_name", 120) || null,
      host_listings: n("host_listings", 0, 100000, "Number of properties"),
      property_type: PROPERTY_TYPES.includes(str("property_type")) ? str("property_type") : null,
      title: str("title", 300) || null,
      rating: n("rating", 0, 5, "Rating", false),
      reviews: n("reviews", 0, 1000000, "Reviews"),
      currency: /^[A-Z]{3}$/.test(str("currency", 3)) ? str("currency", 3) : market.currency,
      weekday_price: n("weekday_price", 0, 100000, "Weekday price", false),
      weekend_price: n("weekend_price", 0, 100000, "Weekend price", false),
      min_nights: n("min_nights", 0, 365, "Minimum nights"),
      photos: n("photos", 0, 1000, "Photos"),
      response_rate: n("response_rate", 0, 100, "Response rate"),
      managed_by: MANAGED_BY.some(m => m.id === b.managed_by) ? (b.managed_by as string) : "unknown",
      licence_number: str("licence_number", 80) || null,
      custom_problems: str("custom_problems", 3000),
      solutions: str("solutions", 6000),
      pitch_subject: str("pitch_subject", 200),
      pitch: str("pitch", 6000),
      contact: str("contact", 300) || null,
      notes: str("notes", 3000),
      status: STATUSES.some(s => s.id === b.status) ? (b.status as string) : "new",
    };
    const picked = Array.isArray(b.problems) ? (b.problems as unknown[]).filter((x): x is string => typeof x === "string").slice(0, 50) : [];
    const custom = row.custom_problems.split("\n").filter(s => s.trim()).length;
    const s = scoreListing(row, picked, custom);
    const full = { ...row, problems: s.ids, problem_count: s.count, score: s.score, grade: s.grade, updated_at: new Date().toISOString() };

    const q = existing
      ? db.from("scout_listings").update(full).eq("id", existing.id)
      : db.from("scout_listings").insert({ ...full, added_by: me.id });
    const { data, error } = await q.select(LISTING_COLS).single();
    if (error) {
      if (error.code === "23505") {
        const { data: dup } = await db.from("scout_listings").select("scout_members(name)").eq("link_key", key).is("deleted_at", null).maybeSingle();
        const by = (dup?.scout_members as unknown as { name?: string } | null)?.name;
        throw new HttpError(409, `This listing was already added${by ? ` by ${by}` : ""}`);
      }
      throw new HttpError(400, error.message);
    }
    return Response.json({ listing: data });
  } catch (e) {
    return errorResponse(e);
  }
}

// "Delete" only hides the listing (deleted_at). The row stays in the database, so nothing is lost.
export async function DELETE(req: Request) {
  try {
    const me = await requireScout(req);
    const id = new URL(req.url).searchParams.get("id") || "";
    const db = adminClient();
    const { data } = await db.from("scout_listings").select("id, added_by").eq("id", id).is("deleted_at", null).maybeSingle();
    if (!data) throw new HttpError(404, "Listing not found");
    if (data.added_by !== me.id && !me.is_admin) throw new HttpError(403, "Only the person who added this listing (or Yahya) can remove it");
    const { error } = await db.from("scout_listings").update({ deleted_at: new Date().toISOString() }).eq("id", id);
    if (error) throw new HttpError(400, error.message);
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
