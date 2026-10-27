import { adminClient, errorResponse, requireTeamUser } from "@/lib/server/auth";
import { aiReady, hostlyReady, whatsappReady } from "@/lib/server/env";
import { AGENTS } from "@/lib/hostly/agents";

export const dynamic = "force-dynamic";

// Everything the Hostly OS command center shows, in one call.
export async function GET(req: Request) {
  try {
    const user = await requireTeamUser(req);
    const connections = { database: hostlyReady(), ai: aiReady(), whatsapp: whatsappReady(), email: false, pms: false, pricing_engine: false };
    if (!hostlyReady()) return Response.json({ user, connections, ready: false });
    const db = adminClient();
    const today = new Date().toISOString().slice(0, 10);
    const in30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    const [kpis, approvals, runs, incidents, tasks, events, autonomy, quality, leads] = await Promise.all([
      db.rpc("hostly_kpis", { p_from: today, p_to: in30 }),
      db.from("hostly_approvals").select("id, agent, action, level, title, payload, evidence, requested_at, expires_at, result").eq("status", "pending").order("requested_at").limit(50),
      db.from("hostly_automation_runs").select("id, agent, level, status, summary, ai_model, duration_ms, started_at").order("started_at", { ascending: false }).limit(40),
      db.from("hostly_incidents").select("id, severity, category, summary, status, respond_by, opened_at").neq("status", "resolved").order("opened_at", { ascending: false }).limit(30),
      db.from("hostly_tasks").select("id, kind, title, priority, status, due_at, assignee").in("status", ["open", "in_progress"]).order("due_at").limit(50),
      db.from("hostly_events").select("id, source, type, status, attempts, last_error, received_at").in("status", ["failed", "dead"]).order("received_at", { ascending: false }).limit(20),
      db.from("hostly_autonomy").select("agent, action, level, max_level, description, updated_by, updated_at").order("agent"),
      db.from("hostly_agent_quality").select("*"),
      db.from("hostly_leads").select("stage"),
    ]);
    const firstError = [kpis, approvals, runs, incidents, tasks, events, autonomy, quality, leads].find(r => r.error)?.error;
    if (firstError) {
      // Most likely the 0001 migration hasn't been applied to this Supabase project yet.
      return Response.json({ user, connections, ready: false, error: firstError.message });
    }
    const pipeline: Record<string, number> = {};
    for (const l of leads.data ?? []) pipeline[l.stage] = (pipeline[l.stage] ?? 0) + 1;
    return Response.json({
      user, connections, ready: true,
      agents: AGENTS.map(a => ({ name: a.name, job: a.job, listens: a.listens })),
      kpis: kpis.data, approvals: approvals.data, runs: runs.data, incidents: incidents.data, tasks: tasks.data,
      failed_events: events.data, autonomy: autonomy.data, quality: quality.data, pipeline,
    }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}
