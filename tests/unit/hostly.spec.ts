import { expect, test } from "@playwright/test";
import type { Ask } from "@/lib/hostly/agents";
import { ingest, processBatch, type Executors } from "@/lib/hostly/engine";
import { decidePrice, gate, keywordRisk, zonedTimeToUtc } from "@/lib/hostly/policy";
import { MemoryStore, villa } from "./memory-store";

/* eslint-disable @typescript-eslint/no-explicit-any */
// A stand-in for Claude: returns the canned answer for each agent, and records what was asked.
function fakeAi(answers: Record<string, unknown>) {
  const calls: string[] = [];
  const ask = (async (o: { copilot: string }) => {
    calls.push(o.copilot);
    const data = answers[o.copilot];
    return data ? { data, model: "test-model", inputTokens: 10, outputTokens: 10 } : null;
  }) as unknown as Ask;
  return { ask, calls };
}
const noAi = fakeAi({}).ask;
const stay = (over: Record<string, unknown> = {}) => ({ property_code: "KIS-01", channel: "airbnb", external_ref: "HM1", status: "confirmed", check_in: "2026-11-01", check_out: "2026-11-05", currency: "USD", gross_amount: 800, ...over });

test.describe("policy", () => {
  test("prices are clamped to the owner's guardrails and big moves are flagged", () => {
    const g = { basePrice: 200, minPrice: 150, maxPrice: 300, maxDiscountPct: 20, autoChangeLimitPct: 10 };
    expect(decidePrice(200, 210, g)).toMatchObject({ allowed: 210, clampedBy: null, withinGuardrails: true });
    expect(decidePrice(200, 100, g)).toMatchObject({ allowed: 160, clampedBy: "max_discount", withinGuardrails: false });
    expect(decidePrice(200, 500, g)).toMatchObject({ allowed: 300, clampedBy: "max_price", withinGuardrails: false });
    expect(decidePrice(200, 240, g)).toMatchObject({ allowed: 240, changePct: 20, withinGuardrails: false });
  });

  test("the autonomy gate: draft by default, human-only stays human, L3 needs guardrails and a connection", () => {
    const base = { action: "send_guest_reply", minAutoLevel: 2 as const, withinGuardrails: true, executorReady: true };
    expect(gate({ ...base, configured: null }).mode).toBe("approval");
    expect(gate({ ...base, configured: 2 }).mode).toBe("auto");
    expect(gate({ ...base, configured: 2, executorReady: false }).mode).toBe("approval");
    expect(gate({ ...base, action: "sensitive_reply", configured: 4 })).toMatchObject({ mode: "approval", level: 4 });
    expect(gate({ ...base, action: "apply_price", minAutoLevel: 3, configured: 3, withinGuardrails: false }).mode).toBe("approval");
    expect(gate({ ...base, action: "apply_price", minAutoLevel: 3, configured: 3 }).mode).toBe("auto");
  });

  test("safety keywords catch emergencies without any AI", () => {
    expect(keywordRisk("There is smoke coming from the kitchen!")).toBe("emergency");
    expect(keywordRisk("The door code doesn't work, we're locked out")).toBe("urgent");
    expect(keywordRisk("The place was dirty, I want a refund")).toBe("sensitive");
    expect(keywordRisk("What's the wifi password?")).toBe("routine");
    expect(keywordRisk("We'll leave you a great review")).toBe("routine");
  });

  test("checkout 11:00 in Orlando is 15:00/16:00 UTC depending on daylight saving", () => {
    expect(zonedTimeToUtc("2026-07-10", 11, 0, "America/New_York")).toBe("2026-07-10T15:00:00.000Z");
    expect(zonedTimeToUtc("2026-12-10", 11, 0, "America/New_York")).toBe("2026-12-10T16:00:00.000Z");
    expect(zonedTimeToUtc("2026-12-10", 11, 0, "Asia/Karachi")).toBe("2026-12-10T06:00:00.000Z");
  });
});

test.describe("orchestrator and agents", () => {
  test("a reservation webhook delivered twice makes one stay and one turnover clean", async () => {
    const store = new MemoryStore();
    store.properties.push(villa());
    const e = { source: "hostaway", external_id: "evt-1", type: "reservation.upsert", payload: stay() };
    expect((await ingest(store, e)).duplicate).toBe(false);
    expect((await ingest(store, e)).duplicate).toBe(true);
    const r = await processBatch(store, { ask: noAi });
    expect(r).toMatchObject({ claimed: 1, done: 1 });
    expect(store.reservations).toHaveLength(1);
    expect(store.tasks.map(t => t.kind).sort()).toEqual(["cleaning", "inspection"]);
    expect(store.tasks.find(t => t.kind === "cleaning")!.due_at).toBe("2026-11-05T20:00:00.000Z"); // 15:00 EST

    // A later modification of the same stay updates it without a second clean.
    await ingest(store, { ...e, external_id: "evt-2", payload: stay({ guest_count: 4 }) });
    await processBatch(store, { ask: noAi });
    expect(store.tasks.filter(t => t.kind === "cleaning")).toHaveLength(1);

    // Cancelling cancels the open tasks.
    await ingest(store, { ...e, external_id: "evt-3", payload: stay({ status: "cancelled" }) });
    await processBatch(store, { ask: noAi });
    expect(store.tasks.every(t => t.status === "cancelled")).toBe(true);
  });

  test("an older update arriving late is ignored", async () => {
    const store = new MemoryStore();
    store.properties.push(villa());
    await ingest(store, { source: "pms", external_id: "a", type: "reservation.upsert", payload: stay({ guest_count: 5, source_updated_at: "2026-10-02T00:00:00Z" }) });
    await ingest(store, { source: "pms", external_id: "b", type: "reservation.upsert", payload: stay({ guest_count: 2, source_updated_at: "2026-10-01T00:00:00Z" }) });
    await processBatch(store, { ask: noAi });
    expect(store.reservations[0].guest_count).toBe(5);
    expect(store.runs.map(r => r.status)).toEqual(["success", "skipped"]);
  });

  test("a double booking opens an incident and an urgent task", async () => {
    const store = new MemoryStore();
    store.properties.push(villa());
    await ingest(store, { source: "pms", external_id: "a", type: "reservation.upsert", payload: stay() });
    await ingest(store, { source: "pms", external_id: "b", type: "reservation.upsert", payload: stay({ channel: "booking", external_ref: "B7", check_in: "2026-11-04", check_out: "2026-11-06" }) });
    await processBatch(store, { ask: noAi });
    expect(store.reservations).toHaveLength(1);
    expect(store.incidents[0]).toMatchObject({ severity: "high", category: "calendar_conflict" });
    expect(store.tasks.some(t => t.priority === "urgent")).toBe(true);
  });

  test("a malformed event goes straight to dead letters; an unknown type is refused at the door", async () => {
    const store = new MemoryStore();
    await ingest(store, { source: "pms", external_id: "x", type: "reservation.upsert", payload: stay({ property_code: "NOPE" }) });
    expect(await processBatch(store, { ask: noAi })).toMatchObject({ dead: 1 });
    await expect(ingest(store, { source: "pms", external_id: "y", type: "invoice.paid", payload: {} })).rejects.toThrow(/No agent/);
  });

  test("a transient failure is retried", async () => {
    const store = new MemoryStore();
    store.properties.push(villa());
    const realUpsert = store.upsertReservation.bind(store);
    let fail = true;
    store.upsertReservation = async r => { if (fail) { fail = false; throw new Error("db timeout"); } return realUpsert(r); };
    await ingest(store, { source: "pms", external_id: "a", type: "reservation.upsert", payload: stay() });
    expect(await processBatch(store, { ask: noAi })).toMatchObject({ failed: 1 });
    expect(await processBatch(store, { ask: noAi })).toMatchObject({ done: 1 });
    expect(store.reservations).toHaveLength(1);
  });

  test("an emergency message escalates at once, without waiting for the AI", async () => {
    const store = new MemoryStore();
    store.properties.push(villa());
    const ai = fakeAi({ "Concierge agent": { intent: "other", risk: "routine", summary: "x", reply: "Sure!", needs_facts: [] } });
    await ingest(store, { source: "whatsapp", external_id: "m1", type: "guest.message", payload: { property_code: "KIS-01", channel: "whatsapp", from: "15551234567", body: "I smell gas in the kitchen" } });
    await processBatch(store, { ask: ai.ask });
    expect(ai.calls).toEqual([]);
    expect(store.incidents[0]).toMatchObject({ severity: "emergency" });
    expect(store.tasks[0]).toMatchObject({ priority: "urgent" });
    expect(store.approvals).toHaveLength(0);
  });

  test("the AI can't talk a refund request down to routine: it becomes a human-only draft", async () => {
    const store = new MemoryStore();
    store.levels["concierge.send_guest_reply"] = 3;
    const ai = fakeAi({ "Concierge agent": { intent: "refund", risk: "routine", summary: "Wants money back", reply: "I'll check with the team.", needs_facts: [] } });
    await ingest(store, { source: "whatsapp", external_id: "m2", type: "guest.message", payload: { channel: "whatsapp", from: "1555", body: "It was dirty, I want a refund" } });
    const sent: unknown[] = [];
    const executors: Executors = { send_guest_reply: { ready: () => true, run: async p => (sent.push(p), {}) }, sensitive_reply: { ready: () => true, run: async p => (sent.push(p), {}) } };
    await processBatch(store, { ask: ai.ask, executors });
    expect(sent).toEqual([]);
    expect(store.approvals[0]).toMatchObject({ action: "sensitive_reply", level: "L4", status: "pending" });
    expect(store.incidents[0]).toMatchObject({ severity: "medium" });
  });

  test("routine replies are drafted at L1 and sent automatically once the action earns L2", async () => {
    const store = new MemoryStore();
    const ai = fakeAi({ "Concierge agent": { intent: "wifi", risk: "routine", summary: "Wifi password", reply: "It's on the fridge card.", needs_facts: [] } });
    const sent: any[] = [];
    const executors: Executors = { send_guest_reply: { ready: () => true, run: async p => (sent.push(p), { sent: true }) } };
    await ingest(store, { source: "whatsapp", external_id: "m3", type: "guest.message", payload: { channel: "whatsapp", from: "1555", body: "wifi password?" } });
    await processBatch(store, { ask: ai.ask, executors });
    expect(sent).toHaveLength(0);
    expect(store.approvals[0]).toMatchObject({ level: "L1", status: "pending" });

    store.levels["concierge.send_guest_reply"] = 2;
    await ingest(store, { source: "whatsapp", external_id: "m4", type: "guest.message", payload: { channel: "whatsapp", from: "1555", body: "wifi password again?" } });
    await processBatch(store, { ask: ai.ask, executors });
    expect(sent).toHaveLength(1);
    expect(store.approvals[1]).toMatchObject({ level: "L2", status: "executed" });
  });

  test("opted-out leads are never contacted; good leads get a draft with an opt-out line", async () => {
    const store = new MemoryStore();
    store.leads.push({ id: "L1", market: "US-FL", name: "Dana", company: null, email: "dana@x.com", phone: null, lead_type: "host", listing_url: "https://airbnb.com/rooms/1", city: "Kissimmee", source: "manual", stage: "new", facts: [] });
    store.leads.push({ id: "L2", market: "US-FL", name: "Sam", company: null, email: "sam@x.com", phone: null, lead_type: "host", listing_url: null, city: null, source: "manual", stage: "new", facts: [] });
    store.suppressed.push("sam@x.com");
    const ai = fakeAi({ "Outreach agent": { score: 82, reason: "Active host", facts: ["4-bed listing in Kissimmee"], hypotheses: ["May self-manage"], missing: [], next_action: "Send audit offer", email_subject: "Quick idea for your Kissimmee listing", email_body: "Hi Dana, ..." } });
    await ingest(store, { source: "hostly", external_id: "lead:L1", type: "lead.created", payload: { lead_id: "L1" } });
    await ingest(store, { source: "hostly", external_id: "lead:L2", type: "lead.created", payload: { lead_id: "L2" } });
    await processBatch(store, { ask: ai.ask });
    expect(store.leads[1].stage).toBe("suppressed");
    expect(store.leads[0]).toMatchObject({ score: 82, stage: "qualified" });
    expect(store.approvals).toHaveLength(1);
    expect(String(store.approvals[0].payload.body)).toMatch(/reply "stop"/);
  });

  test("the revenue agent stays inside guardrails and never auto-applies a clamped price", async () => {
    const store = new MemoryStore();
    store.properties.push(villa());
    store.levels["revenue.apply_price"] = 3;
    const applied: unknown[] = [];
    const executors: Executors = { apply_price: { ready: () => true, run: async p => (applied.push(p), {}) } };
    const ai = fakeAi({ "Revenue agent": { suggested_price: 90, confidence: "high", rationale: "Weak pace", risks: [] } });
    await ingest(store, { source: "scheduler", external_id: "pricing:KIS-01:2026-10-27", type: "pricing.review", payload: { property_code: "KIS-01" } });
    await processBatch(store, { ask: ai.ask, executors, now: new Date("2026-10-27T06:00:00Z") });
    expect(applied).toEqual([]);
    expect(store.approvals[0].payload).toMatchObject({ from: 200, to: 160 });

    const small = fakeAi({ "Revenue agent": { suggested_price: 190, confidence: "medium", rationale: "Slightly soft", risks: [] } });
    await ingest(store, { source: "scheduler", external_id: "pricing:KIS-01:2026-10-28", type: "pricing.review", payload: { property_code: "KIS-01" } });
    await processBatch(store, { ask: small.ask, executors, now: new Date("2026-10-28T06:00:00Z") });
    expect(applied).toHaveLength(1);
  });
});
