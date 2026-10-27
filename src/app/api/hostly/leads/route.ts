import { adminClient, errorResponse, HttpError, requireTeamUser } from "@/lib/server/auth";
import { processBatch } from "@/lib/hostly/engine";
import { serverExecutors } from "@/lib/hostly/executors";
import { hostlyStore } from "@/lib/hostly/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const TYPES = ["host", "owner", "realtor", "investor", "property_manager", "other"];

// Adds a lead and hands it to the Outreach agent (score + first email draft for approval).
// The same email or listing link is never added twice.
export async function POST(req: Request) {
  try {
    const user = await requireTeamUser(req);
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const t = (k: string, max = 300) => (typeof b[k] === "string" ? (b[k] as string).trim().slice(0, max) : "") || null;
    const lead = {
      market: t("market", 10) || "US-FL", name: t("name"), company: t("company"), email: t("email")?.toLowerCase() || null, phone: t("phone", 40),
      lead_type: TYPES.includes(String(b.lead_type)) ? String(b.lead_type) : "host", listing_url: t("listing_url", 1000), city: t("city"),
      source: t("source", 60) || "manual", owner_email: user.email,
    };
    if (!lead.email && !lead.phone && !lead.listing_url) throw new HttpError(400, "Give at least an email, phone or listing link");
    if (lead.listing_url && !/^https:\/\//.test(lead.listing_url)) throw new HttpError(400, "Listing link must start with https://");
    const db = adminClient();
    const { data, error } = await db.from("hostly_leads").insert(lead).select("id").single();
    if (error) throw new HttpError(error.code === "23505" ? 409 : 400, error.code === "23505" ? "This email or listing is already a lead" : error.message);
    const store = hostlyStore();
    await store.insertEvent({ source: "hostly", external_id: `lead:${data.id}`, type: "lead.created", payload: { lead_id: data.id } });
    const report = await processBatch(store, { limit: 5, executors: serverExecutors() });
    return Response.json({ id: data.id, report });
  } catch (e) {
    return errorResponse(e);
  }
}
