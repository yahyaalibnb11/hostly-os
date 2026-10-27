import { adminClient, errorResponse, HttpError, requireTeamUser } from "@/lib/server/auth";
import { calendarUrlOk } from "@/lib/hostly/ical";
import { requireAdmin } from "@/lib/hostly/server";

export const dynamic = "force-dynamic";

const COLS = "id, code, name, market, city, address, status, bedrooms, capacity, currency, base_price, min_price, max_price, max_discount_pct, auto_change_limit_pct, listing_ids, calendar_urls, calendar_synced_at, calendar_error, guest_info";
const CHANNELS = ["airbnb", "vrbo", "booking"];
const STATUSES = ["onboarding", "live", "paused", "offboarded"];

// Listings: everyone on the team can see them; only an owner or admin adds or changes them.
export async function GET(req: Request) {
  try {
    await requireTeamUser(req);
    const { data, error } = await adminClient().from("hostly_properties").select(COLS).order("name");
    if (error) throw new HttpError(500, error.message);
    return Response.json({ properties: data }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}

const slug = (name: string) => name.toUpperCase().replace(/[^A-Z0-9 ]/g, "").split(/\s+/).filter(Boolean).slice(0, 3).map(w => w.slice(0, 4)).join("-") || "HOME";

export async function POST(req: Request) {
  try {
    await requireAdmin(req);
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const db = adminClient();
    const str = (k: string, max = 200) => (typeof b[k] === "string" ? (b[k] as string).trim().slice(0, max) : "");
    const money = (k: string) => {
      if (b[k] === "" || b[k] == null) return null;
      const n = Number(b[k]);
      if (!Number.isFinite(n) || n < 0 || n > 1_000_000) throw new HttpError(400, `${k.replace(/_/g, " ")} must be a number`);
      return Math.round(n * 100) / 100;
    };
    const whole = (k: string) => {
      const n = money(k);
      if (n != null && (!Number.isInteger(n) || n > 100)) throw new HttpError(400, `${k} must be a whole number`);
      return n;
    };
    const name = str("name");
    if (!name) throw new HttpError(400, "Give the listing a name");
    const marketCode = str("market", 10) || "US-FL";
    const { data: market } = await db.from("hostly_markets").select("code, currency, timezone").eq("code", marketCode).maybeSingle();
    if (!market) throw new HttpError(400, "Unknown area");

    const calendar_urls: Record<string, string> = {};
    const urls = (b.calendar_urls ?? {}) as Record<string, unknown>;
    for (const ch of CHANNELS) {
      const u = typeof urls[ch] === "string" ? (urls[ch] as string).trim() : "";
      if (!u) continue;
      if (!calendarUrlOk(u)) throw new HttpError(400, `The ${ch} calendar link must be the https .ics export link from ${ch}`);
      calendar_urls[ch] = u;
    }
    const listingUrl = str("listing_url", 1000);
    if (listingUrl && !/^https:\/\//.test(listingUrl)) throw new HttpError(400, "Listing link must start with https://");

    const row = {
      name, market: market.code, currency: market.currency, timezone: market.timezone,
      city: str("city") || null, address: str("address", 300) || null,
      status: STATUSES.includes(str("status")) ? str("status") : "onboarding",
      bedrooms: whole("bedrooms"), capacity: whole("capacity"),
      base_price: money("base_price"), min_price: money("min_price"), max_price: money("max_price"),
      max_discount_pct: money("max_discount_pct") ?? 15, auto_change_limit_pct: money("auto_change_limit_pct") ?? 10,
      listing_ids: listingUrl ? { listing_url: listingUrl } : {}, calendar_urls,
      guest_info: str("guest_info", 4000) || null,
    };
    if (row.min_price != null && row.max_price != null && row.min_price > row.max_price) throw new HttpError(400, "Lowest price can't be above highest price");
    if (row.max_discount_pct > 90 || row.auto_change_limit_pct > 50) throw new HttpError(400, "Discount must be 90% or less and daily change 50% or less");

    const id = str("id", 40);
    if (id) {
      const { data, error } = await db.from("hostly_properties").update(row).eq("id", id).select(COLS).single();
      if (error) throw new HttpError(400, error.message);
      return Response.json({ property: data });
    }
    let code = slug(name);
    for (let i = 2; i < 50; i++) {
      const { data: taken } = await db.from("hostly_properties").select("id").eq("code", code).maybeSingle();
      if (!taken) break;
      code = `${slug(name)}-${i}`;
    }
    const { data, error } = await db.from("hostly_properties").insert({ ...row, code }).select(COLS).single();
    if (error) throw new HttpError(400, error.message);
    return Response.json({ property: data });
  } catch (e) {
    return errorResponse(e);
  }
}
