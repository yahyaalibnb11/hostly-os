import type { SupabaseClient } from "@supabase/supabase-js";
import { PG_EXCLUSION_VIOLATION, type HostlyStore, type Property, type Reservation } from "./store";

// HostlyStore on the Supabase tables from supabase/migrations/0001_hostly_core.sql. Server only:
// it uses the service-role client, so callers must check the user's role first.

const PROPERTY_COLS = "id, code, name, market, timezone, currency, status, base_price, min_price, max_price, max_discount_pct, auto_change_limit_pct";

function must<T>(r: { data: T; error: { message: string; code?: string } | null }, what: string): T {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data;
}
function mustOne<T>(r: { data: T; error: { message: string } | null }, what: string): NonNullable<T> {
  const d = must(r, what);
  if (d == null) throw new Error(`${what}: no row returned`);
  return d;
}
const toProperty = (p: Record<string, unknown>): Property => ({
  ...(p as unknown as Property),
  base_price: p.base_price == null ? null : Number(p.base_price),
  min_price: p.min_price == null ? null : Number(p.min_price),
  max_price: p.max_price == null ? null : Number(p.max_price),
  max_discount_pct: Number(p.max_discount_pct),
  auto_change_limit_pct: Number(p.auto_change_limit_pct),
});

export function supabaseStore(db: SupabaseClient): HostlyStore {
  return {
    async insertEvent(e) {
      const r = await db.from("hostly_events").upsert(e, { onConflict: "source,external_id", ignoreDuplicates: true }).select("id");
      const rows = must(r, "save event") ?? [];
      if (rows.length) return { id: rows[0].id, duplicate: false };
      const old = must(await db.from("hostly_events").select("id").eq("source", e.source).eq("external_id", e.external_id).maybeSingle(), "find event");
      return { id: old?.id ?? null, duplicate: true };
    },
    async claimEvents(limit) {
      return must(await db.rpc("hostly_claim_events", { p_limit: limit }), "claim events") ?? [];
    },
    async finishEvent(id, error, dead = false) {
      return must(await db.rpc("hostly_finish_event", { p_id: id, p_error: error, p_dead: dead }), "finish event");
    },

    async propertyByCode(code) {
      const p = must(await db.from("hostly_properties").select(PROPERTY_COLS).eq("code", code).maybeSingle(), "property");
      return p ? toProperty(p) : null;
    },
    async liveProperties() {
      return (must(await db.from("hostly_properties").select(PROPERTY_COLS).eq("status", "live"), "properties") ?? []).map(toProperty);
    },
    async upsertReservation(r: Reservation) {
      const old = must(await db.from("hostly_reservations").select("id, status, source_updated_at").eq("channel", r.channel).eq("external_ref", r.external_ref).maybeSingle(), "reservation");
      if (old?.source_updated_at && r.source_updated_at && Date.parse(old.source_updated_at) > Date.parse(r.source_updated_at)) {
        return { id: old.id, outcome: "stale", previousStatus: old.status };
      }
      const res = await db.from("hostly_reservations").upsert(r, { onConflict: "channel,external_ref" }).select("id").single();
      if (res.error?.code === PG_EXCLUSION_VIOLATION) return { id: old?.id ?? "", outcome: "conflict" };
      const row = mustOne(res, "save reservation");
      return { id: row.id, outcome: old ? "updated" : "inserted", previousStatus: old?.status };
    },
    async bookedNights(propertyId, from, to) {
      const rows = must(await db.from("hostly_reservations").select("check_in, check_out, gross_amount")
        .eq("property_id", propertyId).eq("status", "confirmed").lt("check_in", to).gt("check_out", from), "stays") ?? [];
      let booked = 0, revenue = 0;
      for (const r of rows) {
        const total = (Date.parse(r.check_out) - Date.parse(r.check_in)) / 86400000;
        const inside = (Math.min(Date.parse(r.check_out), Date.parse(to)) - Math.max(Date.parse(r.check_in), Date.parse(from))) / 86400000;
        booked += inside;
        revenue += total > 0 ? (Number(r.gross_amount || 0) * inside) / total : 0;
      }
      return { booked, revenue: Math.round(revenue * 100) / 100 };
    },
    async upsertTask(t) {
      const ins = await db.from("hostly_tasks").upsert(t, { onConflict: "dedupe_key", ignoreDuplicates: true }).select("id");
      const rows = must(ins, "save task") ?? [];
      if (rows.length) return { id: rows[0].id, created: true };
      const old = mustOne(await db.from("hostly_tasks").select("id").eq("dedupe_key", t.dedupe_key).single(), "find task");
      return { id: old.id, created: false };
    },
    async cancelTasksForReservation(reservationId, reason) {
      const rows = must(await db.from("hostly_tasks").update({ status: "cancelled", details: { cancelled_reason: reason } })
        .eq("reservation_id", reservationId).in("status", ["open", "in_progress"]).select("id"), "cancel tasks") ?? [];
      return rows.length;
    },
    async lead(id) {
      return must(await db.from("hostly_leads").select("id, market, name, company, email, phone, lead_type, listing_url, city, source, stage, facts").eq("id", id).maybeSingle(), "lead");
    },
    async updateLead(id, patch) {
      must(await db.from("hostly_leads").update(patch).eq("id", id), "update lead");
    },
    async isSuppressed(email, phone) {
      for (const [col, v] of [["email", email?.toLowerCase()], ["phone", phone]] as const) {
        if (!v) continue;
        const rows = must(await db.from("hostly_suppressions").select("id").eq(col, v).limit(1), "suppressions") ?? [];
        if (rows.length) return true;
      }
      return false;
    },
    async insertMessage(m) {
      return mustOne(await db.from("hostly_messages").insert(m).select("id").single(), "save message").id;
    },
    async updateMessage(id, patch) {
      must(await db.from("hostly_messages").update(patch).eq("id", id), "update message");
    },
    async createIncident(i) {
      return mustOne(await db.from("hostly_incidents").insert(i).select("id").single(), "open incident").id;
    },
    async insertPricingRec(r) {
      return mustOne(await db.from("hostly_pricing_recs").insert(r).select("id").single(), "save pricing").id;
    },
    async reservationByRef(channel, externalRef) {
      return must(await db.from("hostly_reservations").select("id, property_id").eq("channel", channel).eq("external_ref", externalRef).maybeSingle(), "reservation");
    },

    async recordRun(r) {
      return mustOne(await db.from("hostly_automation_runs").insert(r).select("id").single(), "log run").id;
    },
    async createApproval(a) {
      return mustOne(await db.from("hostly_approvals").insert(a).select("id").single(), "queue approval").id;
    },
    async finishApproval(id, status, decidedBy, result) {
      const patch = status === "pending" ? { result } : { status, decided_by: decidedBy, decided_at: new Date().toISOString(), result };
      must(await db.from("hostly_approvals").update(patch).eq("id", id), "update approval");
    },
    async autonomy(agent, action) {
      const row = must(await db.from("hostly_autonomy").select("level").eq("agent", agent).eq("action", action).maybeSingle(), "autonomy");
      return row ? Number(row.level) : null;
    },

    async snapshot() {
      const today = new Date().toISOString().slice(0, 10);
      const monthStart = today.slice(0, 8) + "01";
      const [kpis, approvals, incidents, dead, tasks, leads] = await Promise.all([
        db.rpc("hostly_kpis", { p_from: monthStart, p_to: today }),
        db.from("hostly_approvals").select("title, tier, requested_at").eq("status", "pending").order("requested_at").limit(20),
        db.from("hostly_incidents").select("severity, category, summary, respond_by").neq("status", "resolved").limit(20),
        db.from("hostly_events").select("type, last_error").eq("status", "dead").limit(10),
        db.from("hostly_tasks").select("kind, title, due_at").in("status", ["open", "in_progress"]).lt("due_at", new Date(Date.now() + 86400000).toISOString()).limit(30),
        db.from("hostly_leads").select("stage").gte("created_at", monthStart),
      ]);
      const leadStages: Record<string, number> = {};
      for (const l of leads.data ?? []) leadStages[l.stage] = (leadStages[l.stage] ?? 0) + 1;
      return {
        date: today, month_to_date_kpis: kpis.data ?? [], pending_approvals: approvals.data ?? [], open_incidents: incidents.data ?? [],
        dead_letter_events: dead.data ?? [], tasks_due_24h: tasks.data ?? [], leads_this_month_by_stage: leadStages,
      };
    },
  };
}
