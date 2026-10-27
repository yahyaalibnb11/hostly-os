import { askClaude, BRIEF_SCHEMA, GUEST_SCHEMA, LEAD_SCHEMA, PRICE_SCHEMA, type AiResult, type BriefAi, type GuestAi, type LeadAi, type PriceAi } from "./ai";
import { decidePrice, heuristicLeadScore, keywordRisk, maxRisk, RESPONSE_MINUTES, zonedTimeToUtc, type Level, type Risk } from "./policy";
import type { HostlyEvent, HostlyStore, Reservation } from "./store";

// The AI agent workforce (blueprint 2.0, section 14). Each agent listens to event types, gathers records,
// decides (rules + Claude), and returns what it did plus the outbound actions it proposes. It never sends
// anything itself: the orchestrator (engine.ts) checks each proposal against the autonomy ladder and
// guardrails, then either executes it or puts it in the approval queue.

export type Ask = typeof askClaude;
export type Ctx = { store: HostlyStore; ask: Ask; now: Date };

export type Proposal = {
  action: string;
  title: string;
  payload: Record<string, unknown>;
  evidence?: Record<string, unknown>;
  expires_at?: string | null;
  minAutoLevel: 2 | 3;
  withinGuardrails?: boolean;
};

export type AgentResult = {
  status: "success" | "skipped";
  level: Level;            // the highest level of what the agent did by itself
  summary: string;
  output?: Record<string, unknown>;
  proposals?: Proposal[];
  ai?: AiResult<unknown> | null;
};

export type Agent = {
  name: string;
  job: string;
  listens: string[];
  run: (e: HostlyEvent, ctx: Ctx) => Promise<AgentResult>;
};

export class BadEvent extends Error {}

const s = (v: unknown) => (v == null ? "" : String(v).trim());
const num = (v: unknown) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);
const addDays = (d: string, n: number) => new Date(Date.parse(d + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);

// Field Ops: reservations → turnover cleans and pre-arrival checks; double bookings → incident.
const fieldOps: Agent = {
  name: "field_ops",
  job: "Keeps every reservation in the ledger, schedules the turnover clean and pre-arrival check for each confirmed stay, cancels them when the stay is cancelled, and raises double bookings at once.",
  listens: ["reservation.upsert"],
  async run(e, { store }) {
    const p = e.payload;
    const property = await store.propertyByCode(s(p.property_code));
    if (!property) throw new BadEvent(`Unknown property code "${s(p.property_code)}"`);
    const r: Reservation = {
      property_id: property.id,
      channel: s(p.channel).toLowerCase() || "manual",
      external_ref: s(p.external_ref),
      status: (["inquiry", "confirmed", "cancelled", "blocked"].includes(s(p.status)) ? s(p.status) : "confirmed") as Reservation["status"],
      guest_name: s(p.guest_name) || null,
      guest_count: num(p.guest_count),
      check_in: s(p.check_in),
      check_out: s(p.check_out),
      currency: s(p.currency).toUpperCase() || property.currency,
      gross_amount: num(p.gross_amount),
      fees_amount: num(p.fees_amount),
      payout_amount: num(p.payout_amount),
      source_updated_at: s(p.source_updated_at) || null,
    };
    if (!r.external_ref) throw new BadEvent("Missing external_ref");
    if (!isDate(r.check_in) || !isDate(r.check_out) || r.check_out <= r.check_in) throw new BadEvent("Check-in/check-out dates are missing or out of order");

    const res = await store.upsertReservation(r);
    if (res.outcome === "stale") return { status: "skipped", level: 0, summary: `Older update for ${r.channel} ${r.external_ref} ignored` };
    if (res.outcome === "conflict") {
      const incident = await store.createIncident({
        property_id: property.id, severity: "high", category: "calendar_conflict",
        summary: `Double booking: ${r.channel} ${r.external_ref} (${r.check_in} → ${r.check_out}) overlaps a confirmed stay at ${property.code}`,
        respond_by: new Date(Date.now() + 15 * 60000).toISOString(),
      });
      await store.upsertTask({ property_id: property.id, kind: "guest", priority: "urgent", title: `Resolve double booking at ${property.code}`, due_at: new Date(Date.now() + 15 * 60000).toISOString(), details: { incident_id: incident }, dedupe_key: `incident:${incident}` });
      return { status: "success", level: 2, summary: `Double booking at ${property.code}: incident opened, stay not saved`, output: { conflict: true, incident_id: incident } };
    }
    if (r.status === "cancelled") {
      const n = await store.cancelTasksForReservation(res.id, "Reservation cancelled");
      return { status: "success", level: 2, summary: `${property.code} ${r.external_ref} cancelled; ${n} task(s) cancelled`, output: { reservation_id: res.id } };
    }
    if (r.status !== "confirmed") return { status: "success", level: 2, summary: `${property.code} ${r.external_ref} saved as ${r.status}`, output: { reservation_id: res.id } };

    // Turnover clean on checkout day 11:00-15:00 local time; one per reservation however often this runs.
    const clean = await store.upsertTask({
      property_id: property.id, reservation_id: res.id, kind: "cleaning",
      title: `Turnover clean · ${property.code} · checkout ${r.check_out}`,
      due_at: zonedTimeToUtc(r.check_out, 15, 0, property.timezone),
      details: { window_start: zonedTimeToUtc(r.check_out, 11, 0, property.timezone), checklist: "standard_turnover", photo_qa: true, guests: r.guest_count },
      dedupe_key: `turnover:${res.id}`,
    });
    const inspect = await store.upsertTask({
      property_id: property.id, reservation_id: res.id, kind: "inspection",
      title: `Pre-arrival check · ${property.code} · arrival ${r.check_in}`,
      due_at: zonedTimeToUtc(addDays(r.check_in, -1), 18, 0, property.timezone),
      dedupe_key: `prearrival:${res.id}`,
    });
    return {
      status: "success", level: 2,
      summary: `${property.code} ${r.channel} ${r.external_ref} ${res.outcome}; turnover ${clean.created ? "scheduled" : "already scheduled"}`,
      output: { reservation_id: res.id, turnover_task: clean.id, inspection_task: inspect.id },
    };
  },
};

// Outreach (with Prospector scoring): scores a new lead with evidence and drafts the first email.
const outreach: Agent = {
  name: "outreach",
  job: "Checks the opt-out list, scores each new lead from verified facts, and drafts a personalised first-touch email offering a free revenue audit.",
  listens: ["lead.created"],
  async run(e, { store, ask }) {
    const lead = await store.lead(s(e.payload.lead_id));
    if (!lead) throw new BadEvent("Lead not found");
    if (await store.isSuppressed(lead.email, lead.phone)) {
      await store.updateLead(lead.id, { stage: "suppressed", next_action: "Do not contact (opted out)" });
      return { status: "skipped", level: 0, summary: `${lead.email || lead.phone}: on the opt-out list, not contacted` };
    }
    const ai = (await ask<LeadAi>({
      copilot: "Outreach agent",
      instructions: "Score how well this lead fits Hostly's US short-term rental co-hosting service (listing optimisation, AI dynamic pricing, 24/7 guest messaging and cleaning coordination, for a share of booking revenue) and draft a first-touch email. Use only the lead fields given; anything else is a hypothesis.",
      input: { lead, offer: "Free 15-minute revenue audit of their listing; no setup fee" },
      schema: LEAD_SCHEMA,
      effort: "low",
    })) as AiResult<LeadAi> | null;

    const fallback = heuristicLeadScore(lead);
    const score = ai ? Math.max(0, Math.min(100, Math.round(ai.data.score))) : fallback.score;
    await store.updateLead(lead.id, {
      score,
      score_reason: ai ? ai.data.reason : fallback.reason,
      hypotheses: ai ? ai.data.hypotheses : [],
      stage: lead.stage === "new" ? (score >= 60 ? "qualified" : "new") : lead.stage,
      next_action: ai ? ai.data.next_action : "Research the listing, then write the first email",
      next_action_at: new Date(Date.now() + 24 * 3600000).toISOString(),
    });
    if (!ai || !lead.email || score < 60) {
      return { status: "success", level: 0, summary: `Lead scored ${score}${ai ? "" : " (rules, no AI)"}${!lead.email ? ", no email to contact" : ""}`, output: { score }, ai };
    }
    const body = /unsubscribe|opt.?out|reply .*stop/i.test(ai.data.email_body) ? ai.data.email_body : `${ai.data.email_body}\n\nIf you'd rather not hear from us, reply "stop" and we won't email again.`;
    return {
      status: "success", level: 1, ai,
      summary: `Lead scored ${score}; first email drafted`,
      output: { score, facts: ai.data.facts, missing: ai.data.missing },
      proposals: [{
        action: "send_outreach", minAutoLevel: 2, withinGuardrails: true,
        title: `Send first email to ${lead.name || lead.email}${lead.city ? ` (${lead.city})` : ""}`,
        payload: { lead_id: lead.id, to: lead.email, subject: ai.data.email_subject, body },
        evidence: { score, reason: ai.data.reason, facts: ai.data.facts, hypotheses: ai.data.hypotheses },
        expires_at: new Date(Date.now() + 7 * 86400000).toISOString(),
      }],
    };
  },
};

// Concierge: guest messages. Safety first; replies are drafted from verified facts.
const concierge: Agent = {
  name: "concierge",
  job: "Reads every guest message. Emergencies and urgent problems open an incident and an urgent task for the on-call person at once; everything else gets a reply drafted from verified property facts.",
  listens: ["guest.message"],
  async run(e, { store, ask }) {
    const p = e.payload;
    const body = s(p.body).slice(0, 4000);
    if (!body) throw new BadEvent("Empty message");
    const property = p.property_code ? await store.propertyByCode(s(p.property_code)) : null;
    const resv = p.reservation_ref && p.channel ? await store.reservationByRef(s(p.channel).toLowerCase(), s(p.reservation_ref)) : null;
    const propertyId = property?.id ?? resv?.property_id ?? null;
    const msgId = await store.insertMessage({ property_id: propertyId, reservation_id: resv?.id ?? null, channel: s(p.channel).toLowerCase() || "unknown", direction: "in", sender: s(p.from).replace(/\D/g, "") || s(p.from) || null, body });

    const before = keywordRisk(body);
    let ai: AiResult<GuestAi> | null = null;
    if (before !== "emergency") {   // emergencies don't wait for an AI call
      ai = (await ask<GuestAi>({
        copilot: "Concierge agent",
        instructions: "Classify the guest message and, unless it is an emergency, draft a short, warm reply using only the property facts given. Do not offer refunds, discounts or compensation, and never share access codes.",
        input: { message: body, property: property ? { name: property.name, code: property.code } : null, property_facts: p.property_facts ?? null },
        schema: GUEST_SCHEMA,
        effort: "low",
      })) as AiResult<GuestAi> | null;
    }
    const risk: Risk = maxRisk(before, ai?.data.risk ?? "routine");
    const summary = ai?.data.summary || body.slice(0, 140);
    const respondBy = new Date(Date.now() + RESPONSE_MINUTES[risk] * 60000).toISOString();

    if (risk === "emergency" || risk === "urgent") {
      const incident = await store.createIncident({
        property_id: propertyId, reservation_id: resv?.id ?? null, message_id: msgId,
        severity: risk === "emergency" ? "emergency" : "high", category: ai?.data.intent || "safety", summary, respond_by: respondBy,
      });
      await store.upsertTask({ property_id: propertyId, kind: "guest", priority: "urgent", title: `${risk === "emergency" ? "EMERGENCY" : "Urgent"}: ${summary}`, due_at: respondBy, details: { incident_id: incident, message_id: msgId }, dedupe_key: `incident:${incident}` });
      await store.updateMessage(msgId, { risk, intent: ai?.data.intent ?? null, status: "escalated" });
      return { status: "success", level: 0, summary: `${risk.toUpperCase()} escalated to on-call: ${summary}`, output: { incident_id: incident, risk }, ai };
    }
    if (risk === "sensitive") {
      await store.createIncident({ property_id: propertyId, reservation_id: resv?.id ?? null, message_id: msgId, severity: "medium", category: ai?.data.intent || "complaint", summary, respond_by: respondBy });
    }
    const reply = ai?.data.reply?.trim();
    await store.updateMessage(msgId, { risk, intent: ai?.data.intent ?? null, draft_reply: reply || null, status: reply ? "awaiting_approval" : "new" });
    if (!reply) {
      await store.upsertTask({ property_id: propertyId, kind: "guest", priority: risk === "sensitive" ? "high" : "normal", title: `Reply to guest: ${summary}`, due_at: respondBy, dedupe_key: `reply:${msgId}` });
      return { status: "success", level: 0, summary: `Reply task created (${risk})`, output: { message_id: msgId, risk } };
    }
    return {
      status: "success", level: 1, ai, summary: `Reply drafted (${risk}): ${summary}`,
      output: { message_id: msgId, risk, needs_facts: ai?.data.needs_facts ?? [] },
      proposals: [{
        action: risk === "sensitive" ? "sensitive_reply" : "send_guest_reply", minAutoLevel: 2,
        withinGuardrails: (ai?.data.needs_facts ?? []).length === 0,
        title: `Reply to guest${property ? ` at ${property.code}` : ""}: ${summary}`.slice(0, 200),
        payload: { message_id: msgId, channel: s(p.channel).toLowerCase(), to: s(p.from), body: reply },
        evidence: { guest_message: body, risk, intent: ai?.data.intent, needs_facts: ai?.data.needs_facts ?? [] },
        expires_at: respondBy,
      }],
    };
  },
};

// Revenue: daily price review inside the owner's guardrails.
const revenue: Agent = {
  name: "revenue",
  job: "Each day compares the next 14 days' booking pace with the last 28 days, suggests a nightly price, clamps it to the owner's min/max and discount limits, and proposes the change.",
  listens: ["pricing.review"],
  async run(e, { store, ask, now }) {
    const property = await store.propertyByCode(s(e.payload.property_code));
    if (!property) throw new BadEvent("Unknown property");
    const current = num(e.payload.current_price) ?? property.base_price;
    if (!current || current <= 0) return { status: "skipped", level: 0, summary: `${property.code}: no current/base price set, nothing to review` };
    const today = now.toISOString().slice(0, 10);
    const ahead = await store.bookedNights(property.id, today, addDays(today, 14));
    const past = await store.bookedNights(property.id, addDays(today, -28), today);
    const evidence = {
      next_14_days: { booked_nights: ahead.booked, occupancy: +(ahead.booked / 14).toFixed(3) },
      last_28_days: { booked_nights: past.booked, occupancy: +(past.booked / 28).toFixed(3), adr: past.booked ? +(past.revenue / past.booked).toFixed(2) : null },
      current_price: current, currency: property.currency,
      guardrails: { min: property.min_price, max: property.max_price, max_discount_pct: property.max_discount_pct, auto_change_limit_pct: property.auto_change_limit_pct },
    };
    const ai = (await ask<PriceAi>({
      copilot: "Revenue agent",
      instructions: "Suggest one nightly price for the next 14 days from the booking pace given. Weak forward occupancy versus the recent past suggests lowering; strong pace suggests raising. Stay inside the guardrails. With little data, stay close to the current price and say confidence is low.",
      input: { property: { code: property.code, market: property.market }, evidence },
      schema: PRICE_SCHEMA,
      effort: "medium",
    })) as AiResult<PriceAi> | null;
    if (!ai) return { status: "skipped", level: 0, summary: `${property.code}: pricing review needs the AI key; evidence saved`, output: { evidence } };

    const d = decidePrice(current, ai.data.suggested_price, {
      basePrice: property.base_price, minPrice: property.min_price, maxPrice: property.max_price,
      maxDiscountPct: property.max_discount_pct, autoChangeLimitPct: property.auto_change_limit_pct,
    });
    if (d.allowed === current) {
      return { status: "success", level: 0, summary: `${property.code}: keep ${property.currency} ${current} (${ai.data.confidence} confidence)`, output: { evidence, rationale: ai.data.rationale }, ai };
    }
    const recId = await store.insertPricingRec({
      property_id: property.id, stay_date: today, current_price: current, suggested_price: ai.data.suggested_price, allowed_price: d.allowed,
      confidence: ai.data.confidence, rationale: ai.data.rationale, evidence: { ...evidence, risks: ai.data.risks, clamped_by: d.clampedBy }, status: "proposed",
    });
    return {
      status: "success", level: 1, ai,
      summary: `${property.code}: ${property.currency} ${current} → ${d.allowed} (${d.changePct > 0 ? "+" : ""}${d.changePct}%) proposed`,
      output: { recommendation_id: recId, ...d },
      proposals: [{
        action: "apply_price", minAutoLevel: 3, withinGuardrails: d.withinGuardrails && ai.data.confidence !== "low",
        title: `${property.code}: nightly price ${property.currency} ${current} → ${d.allowed} for the next 14 days`,
        payload: { recommendation_id: recId, property_code: property.code, from: current, to: d.allowed, window_days: 14 },
        evidence: { ...evidence, rationale: ai.data.rationale, risks: ai.data.risks, confidence: ai.data.confidence, clamped_by: d.clampedBy },
        expires_at: new Date(now.getTime() + 2 * 86400000).toISOString(),
      }],
    };
  },
};

// Exec Copilot: the morning brief (L0, read only).
const execCopilot: Agent = {
  name: "exec_copilot",
  job: "Each morning turns KPIs, the approval queue, open incidents, due tasks and failed automations into a short brief in English and Roman Urdu.",
  listens: ["brief.daily"],
  async run(_e, { store, ask }) {
    const snap = await store.snapshot();
    const ai = (await ask<BriefAi>({
      copilot: "Exec Copilot",
      instructions: "Write the owner's morning brief from this snapshot. Lead with what needs a decision. Use only the numbers given.",
      input: snap,
      schema: BRIEF_SCHEMA,
      effort: "low",
    })) as AiResult<BriefAi> | null;
    return { status: "success", level: 0, summary: ai?.data.headline || "Daily snapshot saved (the AI brief needs the API key)", output: { snapshot: snap, brief: ai?.data ?? null }, ai };
  },
};

export const AGENTS: Agent[] = [fieldOps, outreach, concierge, revenue, execCopilot];
export const agentsFor = (type: string) => AGENTS.filter(a => a.listens.includes(type));
