// Everything the automation engine reads or writes. Workflows only talk to this interface, so the same
// workflows run against Supabase in production and against an in-memory store in tests.

export type HostlyEvent = {
  id: string;
  source: string;
  external_id: string;
  type: string;
  payload: Record<string, unknown>;
  attempts: number;
};

export type Property = {
  id: string;
  code: string;
  name: string;
  market: string;
  timezone: string;
  currency: string;
  status: string;
  base_price: number | null;
  min_price: number | null;
  max_price: number | null;
  max_discount_pct: number;
  auto_change_limit_pct: number;
  guest_info?: string | null;   // what the Guest helper may tell guests: wifi, check-in time, parking, rules
};

export type Reservation = {
  id?: string;
  property_id: string;
  channel: string;
  external_ref: string;
  status: "inquiry" | "confirmed" | "cancelled" | "blocked";
  guest_name?: string | null;
  guest_count?: number | null;
  check_in: string;
  check_out: string;
  currency: string;
  gross_amount?: number | null;
  fees_amount?: number | null;
  payout_amount?: number | null;
  source_updated_at?: string | null;
};

export type Lead = {
  id: string;
  market: string;
  name: string | null;
  company: string | null;
  email: string | null;
  phone: string | null;
  lead_type: string;
  listing_url: string | null;
  city: string | null;
  source: string;
  stage: string;
  facts: unknown;
};

export type Task = {
  property_id?: string | null;
  reservation_id?: string | null;
  lead_id?: string | null;
  kind: "cleaning" | "inspection" | "maintenance" | "onboarding" | "guest" | "sales" | "finance" | "other";
  title: string;
  priority?: "low" | "normal" | "high" | "urgent";
  due_at?: string | null;
  details?: Record<string, unknown>;
  dedupe_key: string;
};

export type Approval = {
  agent: string;
  action: string;
  level: "L1" | "L2" | "L3" | "L4";
  title: string;
  payload: Record<string, unknown>;
  evidence?: Record<string, unknown>;
  expires_at?: string | null;
  status?: "pending" | "executed" | "failed";
  decided_by?: string | null;
  decided_at?: string | null;
  result?: Record<string, unknown> | null;
};

export type Run = {
  event_id: string | null;
  agent: string;
  level: "L0" | "L1" | "L2" | "L3" | "L4";
  status: "success" | "skipped" | "failed" | "awaiting_approval";
  summary: string;
  output?: Record<string, unknown>;
  error?: string | null;
  ai_model?: string | null;
  ai_input_tokens?: number | null;
  ai_output_tokens?: number | null;
  duration_ms?: number;
};

export type UpsertResult = { id: string; outcome: "inserted" | "updated" | "stale" | "conflict"; previousStatus?: string };

export interface HostlyStore {
  // Event inbox
  insertEvent(e: { source: string; external_id: string; type: string; payload: Record<string, unknown> }): Promise<{ id: string | null; duplicate: boolean }>;
  claimEvents(limit: number): Promise<HostlyEvent[]>;
  finishEvent(id: string, error: string | null, dead?: boolean): Promise<string>;

  // Records
  propertyByCode(code: string): Promise<Property | null>;
  liveProperties(): Promise<Property[]>;
  upsertReservation(r: Reservation): Promise<UpsertResult>;
  bookedNights(propertyId: string, from: string, to: string): Promise<{ booked: number; revenue: number }>;
  upsertTask(t: Task): Promise<{ id: string; created: boolean }>;
  cancelTasksForReservation(reservationId: string, reason: string): Promise<number>;
  lead(id: string): Promise<Lead | null>;
  updateLead(id: string, patch: Record<string, unknown>): Promise<void>;
  isSuppressed(email: string | null, phone: string | null): Promise<boolean>;
  insertMessage(m: Record<string, unknown>): Promise<string>;
  updateMessage(id: string, patch: Record<string, unknown>): Promise<void>;
  createIncident(i: Record<string, unknown>): Promise<string>;
  insertPricingRec(r: Record<string, unknown>): Promise<string>;
  reservationByRef(channel: string, externalRef: string): Promise<{ id: string; property_id: string } | null>;

  // Runs and approvals
  recordRun(r: Run): Promise<string>;
  createApproval(a: Approval & { run_id: string | null }): Promise<string>;
  finishApproval(id: string, status: "pending" | "executed" | "failed", decidedBy: string | null, result: Record<string, unknown>): Promise<void>;
  autonomy(agent: string, action: string): Promise<number | null>;

  // Daily brief inputs
  snapshot(): Promise<Record<string, unknown>>;
}

// Postgres error codes the engine handles on purpose.
export const PG_EXCLUSION_VIOLATION = "23P01";
