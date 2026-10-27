import { randomUUID } from "crypto";
import type { Approval, HostlyEvent, HostlyStore, Lead, Property, Reservation, Run, Task } from "@/lib/hostly/store";

// In-memory HostlyStore that mimics the database rules the agents rely on: one event per
// (source, external_id), one task per dedupe_key, no overlapping confirmed stays, stale updates ignored.
export class MemoryStore implements HostlyStore {
  events: (HostlyEvent & { status: string; error: string | null })[] = [];
  properties: Property[] = [];
  reservations: (Reservation & { id: string })[] = [];
  tasks: (Task & { id: string; status: string })[] = [];
  leads: (Lead & Record<string, unknown>)[] = [];
  suppressed: string[] = [];
  messages: Record<string, unknown>[] = [];
  incidents: Record<string, unknown>[] = [];
  pricing: Record<string, unknown>[] = [];
  runs: (Run & { id: string })[] = [];
  approvals: (Approval & { id: string; run_id: string | null })[] = [];
  levels: Record<string, number> = {};

  async insertEvent(e: { source: string; external_id: string; type: string; payload: Record<string, unknown> }) {
    const old = this.events.find(x => x.source === e.source && x.external_id === e.external_id);
    if (old) return { id: old.id, duplicate: true };
    const id = randomUUID();
    this.events.push({ ...e, id, attempts: 0, status: "pending", error: null });
    return { id, duplicate: false };
  }
  async claimEvents(limit: number) {
    const due = this.events.filter(e => e.status === "pending" || e.status === "failed").slice(0, limit);
    for (const e of due) { e.status = "processing"; e.attempts++; }
    return due.map(e => ({ ...e }));
  }
  async finishEvent(id: string, error: string | null, dead = false) {
    const e = this.events.find(x => x.id === id)!;
    e.error = error;
    e.status = !error ? "done" : dead || e.attempts >= 6 ? "dead" : "failed";
    return e.status;
  }
  async propertyByCode(code: string) { return this.properties.find(p => p.code === code) ?? null; }
  async liveProperties() { return this.properties.filter(p => p.status === "live"); }
  async upsertReservation(r: Reservation) {
    const old = this.reservations.find(x => x.channel === r.channel && x.external_ref === r.external_ref);
    if (old?.source_updated_at && r.source_updated_at && old.source_updated_at > r.source_updated_at) return { id: old.id, outcome: "stale" as const };
    const clash = r.status === "confirmed" && this.reservations.some(x => x !== old && x.property_id === r.property_id && x.status === "confirmed" && x.check_in < r.check_out && x.check_out > r.check_in);
    if (clash) return { id: old?.id ?? "", outcome: "conflict" as const };
    if (old) { Object.assign(old, r); return { id: old.id, outcome: "updated" as const }; }
    const id = randomUUID();
    this.reservations.push({ ...r, id });
    return { id, outcome: "inserted" as const };
  }
  async bookedNights(propertyId: string, from: string, to: string) {
    let booked = 0, revenue = 0;
    for (const r of this.reservations.filter(x => x.property_id === propertyId && x.status === "confirmed" && x.check_in < to && x.check_out > from)) {
      const d = (a: string) => Date.parse(a) / 86400000;
      const inside = Math.min(d(r.check_out), d(to)) - Math.max(d(r.check_in), d(from));
      booked += inside;
      revenue += ((r.gross_amount ?? 0) * inside) / (d(r.check_out) - d(r.check_in));
    }
    return { booked, revenue };
  }
  async upsertTask(t: Task) {
    const old = this.tasks.find(x => x.dedupe_key === t.dedupe_key);
    if (old) return { id: old.id, created: false };
    const id = randomUUID();
    this.tasks.push({ ...t, id, status: "open" });
    return { id, created: true };
  }
  async cancelTasksForReservation(reservationId: string) {
    const open = this.tasks.filter(t => t.reservation_id === reservationId && t.status === "open");
    open.forEach(t => (t.status = "cancelled"));
    return open.length;
  }
  async lead(id: string) { return this.leads.find(l => l.id === id) ?? null; }
  async updateLead(id: string, patch: Record<string, unknown>) { Object.assign(this.leads.find(l => l.id === id)!, patch); }
  async isSuppressed(email: string | null, phone: string | null) { return [email, phone].some(v => v && this.suppressed.includes(v)); }
  async insertMessage(m: Record<string, unknown>) { const id = randomUUID(); this.messages.push({ ...m, id }); return id; }
  async updateMessage(id: string, patch: Record<string, unknown>) { Object.assign(this.messages.find(m => m.id === id)!, patch); }
  async createIncident(i: Record<string, unknown>) { const id = randomUUID(); this.incidents.push({ ...i, id }); return id; }
  async insertPricingRec(r: Record<string, unknown>) { const id = randomUUID(); this.pricing.push({ ...r, id }); return id; }
  async reservationByRef(channel: string, ref: string) { const r = this.reservations.find(x => x.channel === channel && x.external_ref === ref); return r ? { id: r.id, property_id: r.property_id } : null; }
  async recordRun(r: Run) { const id = randomUUID(); this.runs.push({ ...r, id }); return id; }
  async createApproval(a: Approval & { run_id: string | null }) { const id = randomUUID(); this.approvals.push({ status: "pending", ...a, id }); return id; }
  async finishApproval(id: string, status: "pending" | "executed" | "failed", decidedBy: string | null, result: Record<string, unknown>) {
    Object.assign(this.approvals.find(a => a.id === id)!, { status, decided_by: decidedBy, result });
  }
  async autonomy(agent: string, action: string) { return this.levels[`${agent}.${action}`] ?? null; }
  async snapshot() { return { approvals: this.approvals.length, incidents: this.incidents.length }; }
}

export const villa = (over: Partial<Property> = {}): Property => ({
  id: randomUUID(), code: "KIS-01", name: "Kissimmee Villa", market: "US-FL", timezone: "America/New_York", currency: "USD", status: "live",
  base_price: 200, min_price: 140, max_price: 400, max_discount_pct: 20, auto_change_limit_pct: 10, ...over,
});
