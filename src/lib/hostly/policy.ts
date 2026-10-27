// Hostly OS rules that every agent action goes through. Pure functions, no I/O, so they are easy to test.
// This is step 4 of the agent loop (blueprint 2.0, 14.1): the guardrail and autonomy check is code,
// so no model output can talk its way around it.

// Autonomy ladder (blueprint 2.0, 1.3): 0 observe, 1 draft, 2 act with review, 3 act within guardrails, 4 human only.
export type Level = 0 | 1 | 2 | 3 | 4;
export const levelName = (n: number) => `L${Math.max(0, Math.min(4, Math.round(n)))}` as "L0" | "L1" | "L2" | "L3" | "L4";

// Hard rule: these never run on their own, whatever level is configured.
export const HUMAN_ONLY = new Set(["sensitive_reply", "refund", "damage_claim", "access_change", "contract_change", "emergency_response"]);

export type GateInput = {
  action: string;
  configured: number | null;   // level set for this agent action (null = not configured → draft)
  minAutoLevel: 2 | 3;         // level the action needs before it may run without a person
  withinGuardrails: boolean;   // for L3 actions: inside the owner's hard limits
  executorReady: boolean;      // the integration that performs it is connected
};
export type Gate = { mode: "auto" | "approval"; level: Level; reason: string };

export function gate(g: GateInput): Gate {
  const level = (g.configured == null ? 1 : Math.max(0, Math.min(4, g.configured))) as Level;
  if (HUMAN_ONLY.has(g.action)) return { mode: "approval", level: 4, reason: "Human-only action" };
  if (level < g.minAutoLevel) return { mode: "approval", level, reason: `Autonomy L${level}: a person approves` };
  if (g.minAutoLevel === 3 && !g.withinGuardrails) return { mode: "approval", level, reason: "Outside the owner's guardrails" };
  if (!g.executorReady) return { mode: "approval", level, reason: "Integration not connected: a person carries it out" };
  return { mode: "auto", level, reason: `Autonomy L${level}: done automatically, reviewable` };
}

export type Guardrails = {
  basePrice: number | null;
  minPrice: number | null;
  maxPrice: number | null;
  maxDiscountPct: number;
  autoChangeLimitPct: number;
};

export type PriceDecision = {
  allowed: number;
  clampedBy: "min_price" | "max_price" | "max_discount" | null;
  changePct: number;
  // True when the AI's own suggestion fit the guardrails and the step is within the auto-change limit.
  withinGuardrails: boolean;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

// Applies owner guardrails (blueprint 8.3) to an AI price suggestion. The AI never sets a price
// outside min/max or below the allowed discount; changes larger than the auto limit need a human.
export function decidePrice(current: number, suggested: number, g: Guardrails): PriceDecision {
  if (!(current > 0) || !(suggested > 0)) throw new Error("Prices must be positive numbers");
  let allowed = suggested;
  let clampedBy: PriceDecision["clampedBy"] = null;
  const ref = g.basePrice && g.basePrice > 0 ? g.basePrice : current;
  const floor = ref * (1 - g.maxDiscountPct / 100);
  if (allowed < floor) { allowed = floor; clampedBy = "max_discount"; }
  if (g.minPrice != null && allowed < g.minPrice) { allowed = g.minPrice; clampedBy = "min_price"; }
  if (g.maxPrice != null && allowed > g.maxPrice) { allowed = g.maxPrice; clampedBy = "max_price"; }
  allowed = round2(allowed);
  const changePct = round2(((allowed - current) / current) * 100);
  const withinGuardrails = !clampedBy && Math.abs(changePct) <= g.autoChangeLimitPct;
  return { allowed, clampedBy, changePct, withinGuardrails };
}

export type Risk = "routine" | "sensitive" | "urgent" | "emergency";
const RISK_ORDER: Risk[] = ["routine", "sensitive", "urgent", "emergency"];

// Keyword safety net that runs before and after the AI. It can only raise the risk, never lower it,
// so a missed or wrong AI answer can't turn "there's smoke" into a routine reply.
const RULES: { risk: Risk; re: RegExp }[] = [
  { risk: "emergency", re: /\b(fire|smoke|gas leak|smell(s)? gas|carbon monoxide|co alarm|flood(ing)?|injur(ed|y)|bleeding|unconscious|ambulance|police|break[- ]?in|intruder|assault|threat(en)?|weapon|911|999|1122)\b/i },
  { risk: "urgent", re: /\b(locked out|can'?t get in|cannot get in|code (doesn'?t|does not|not) work|no (power|electricity|water|heat|ac|a\/c)|power cut|leak(ing)?|broken lock|door won'?t|stuck|no hot water)\b/i },
  { risk: "sensitive", re: /\b(refund|money back|chargeback|dispute|compensat|discount|complain|dirty|filthy|bed ?bugs?|cockroach|damage|broke|lawyer|bad review|cancel(l)?ation|scam)\b/i },
];

export function keywordRisk(text: string): Risk {
  for (const r of RULES) if (r.re.test(text)) return r.risk;
  return "routine";
}

export const maxRisk = (a: Risk, b: Risk): Risk => (RISK_ORDER.indexOf(a) >= RISK_ORDER.indexOf(b) ? a : b);

// Target first-response time by risk, in minutes (blueprint 9.4: internal targets, not promises to guests).
export const RESPONSE_MINUTES: Record<Risk, number> = { emergency: 5, urgent: 15, sensitive: 60, routine: 240 };

// Lead score used when no AI key is set: only counts facts we actually have.
export function heuristicLeadScore(l: { email?: string | null; phone?: string | null; listing_url?: string | null; city?: string | null; lead_type?: string | null }): { score: number; reason: string } {
  let score = 20;
  const why: string[] = [];
  if (l.listing_url) { score += 25; why.push("has a listing link"); }
  if (l.email) { score += 15; why.push("has an email"); }
  if (l.phone) { score += 10; why.push("has a phone"); }
  if (l.city) { score += 10; why.push("city known"); }
  if (l.lead_type === "host" || l.lead_type === "owner") { score += 15; why.push("is a host/owner"); }
  return { score: Math.min(100, score), reason: why.length ? `Rule-based (no AI): ${why.join(", ")}` : "Rule-based (no AI): very little information" };
}

// Wall-clock time in a property's time zone → UTC ISO string (e.g. checkout day 11:00 in Orlando).
export function zonedTimeToUtc(date: string, hour: number, minute: number, timeZone: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d, hour, minute);
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
    .formatToParts(new Date(guess))
    .reduce<Record<string, string>>((acc, p) => ((acc[p.type] = p.value), acc), {});
  const asZoned = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
  return new Date(guess - (asZoned - guess)).toISOString();
}
