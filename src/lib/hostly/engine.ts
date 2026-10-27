import { askClaude } from "./ai";
import { agentsFor, BadEvent, type Ask } from "./agents";
import { gate, levelName } from "./policy";
import type { HostlyStore } from "./store";

// The orchestrator: events in, agents run, every step logged, each proposed action either executed
// (when its autonomy level and guardrails allow and the integration is connected) or queued for a person.
// Safe on overlapping schedules: events are claimed with SKIP LOCKED, and an agent that already
// succeeded for an event can't log a second success for it (unique run per event + agent).

export type Executor = {
  ready: () => boolean;
  run: (payload: Record<string, unknown>, ctx: { approvalId: string; actor: string }) => Promise<Record<string, unknown>>;
};
export type Executors = Record<string, Executor>;

export type IngestInput = { source: string; external_id: string; type: string; payload: Record<string, unknown> };

const SOURCE_RE = /^[a-z0-9_.-]{2,40}$/;
const TYPE_RE = /^[a-z_]+\.[a-z_]+$/;

export async function ingest(store: HostlyStore, e: IngestInput) {
  if (!SOURCE_RE.test(e.source)) throw new BadEvent("source must be 2-40 lowercase letters, digits, . _ -");
  if (!TYPE_RE.test(e.type)) throw new BadEvent("type must look like reservation.upsert");
  if (!e.external_id || e.external_id.length > 200) throw new BadEvent("external_id is required (max 200 characters)");
  if (!agentsFor(e.type).length) throw new BadEvent(`No agent listens to "${e.type}"`);
  if (!e.payload || typeof e.payload !== "object" || Array.isArray(e.payload)) throw new BadEvent("payload must be an object");
  return store.insertEvent(e);
}

export type BatchReport = {
  claimed: number; done: number; failed: number; dead: number;
  runs: { event: string; agent: string; status: string; summary: string }[];
  actions: { action: string; mode: "auto" | "approval"; reason: string; ok?: boolean }[];
};

export async function processBatch(store: HostlyStore, opts: { limit?: number; ask?: Ask; now?: Date; executors?: Executors } = {}): Promise<BatchReport> {
  const ask = opts.ask ?? askClaude;
  const executors = opts.executors ?? {};
  const events = await store.claimEvents(opts.limit ?? 20);
  const report: BatchReport = { claimed: events.length, done: 0, failed: 0, dead: 0, runs: [], actions: [] };

  for (const ev of events) {
    let error: string | null = null;
    let fatal = false;
    for (const agent of agentsFor(ev.type)) {
      const started = Date.now();
      try {
        const res = await agent.run(ev, { store, ask, now: opts.now ?? new Date() });
        const proposals = res.proposals ?? [];
        const runId = await store.recordRun({
          event_id: ev.id, agent: agent.name, level: levelName(res.level),
          status: proposals.length ? "awaiting_approval" : res.status, summary: res.summary,
          output: res.output ?? {}, ai_model: res.ai?.model ?? null, ai_input_tokens: res.ai?.inputTokens ?? null,
          ai_output_tokens: res.ai?.outputTokens ?? null, duration_ms: Date.now() - started,
        });
        report.runs.push({ event: ev.id, agent: agent.name, status: res.status, summary: res.summary });

        // Step 4, in code: the autonomy and guardrail check the model can't influence.
        for (const p of proposals) {
          const ex = executors[p.action];
          const g = gate({
            action: p.action, configured: await store.autonomy(agent.name, p.action), minAutoLevel: p.minAutoLevel,
            withinGuardrails: p.withinGuardrails ?? false, executorReady: Boolean(ex?.ready()),
          });
          const base = { run_id: runId, agent: agent.name, action: p.action, level: levelName(Math.max(1, g.level)) as "L1", title: p.title, payload: p.payload, evidence: { ...p.evidence, gate: g.reason }, expires_at: p.expires_at ?? null };
          if (g.mode === "approval" || !ex) {
            await store.createApproval(base);
            report.actions.push({ action: p.action, mode: "approval", reason: g.reason });
            continue;
          }
          // Auto-executed actions are still recorded in the approval log, so people can review them (L2/L3).
          const actor = `agent:${agent.name} (${levelName(g.level)})`;
          const approvalId = await store.createApproval({ ...base, status: "pending" });
          try {
            const result = await ex.run(p.payload, { approvalId, actor });
            await store.finishApproval(approvalId, "executed", actor, result);
            report.actions.push({ action: p.action, mode: "auto", reason: g.reason, ok: true });
          } catch (err) {
            // Failed auto actions stay pending for a person instead of being retried blindly.
            await store.finishApproval(approvalId, "pending", null, { auto_error: err instanceof Error ? err.message : String(err) });
            report.actions.push({ action: p.action, mode: "auto", reason: g.reason, ok: false });
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await store.recordRun({ event_id: ev.id, agent: agent.name, level: "L0", status: "failed", summary: `Failed: ${msg}`.slice(0, 300), error: msg, duration_ms: Date.now() - started }).catch(() => {});
        report.runs.push({ event: ev.id, agent: agent.name, status: "failed", summary: msg });
        error = msg;
        // A malformed event will never succeed: dead-letter it now instead of retrying.
        if (err instanceof BadEvent) fatal = true;
      }
    }
    const state = await store.finishEvent(ev.id, error, fatal);
    if (state === "done") report.done++; else if (state === "dead") report.dead++; else report.failed++;
  }
  return report;
}
