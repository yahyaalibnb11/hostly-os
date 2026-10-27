"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useMemo, useState } from "react";

// Hostly OS command center: the agent workforce, the approval queue, incidents, today's work and KPIs.
// Signs in with Hostly OS's own Supabase project and reads everything through /api/hostly/*,
// so the server checks the staff role on every call.

/* eslint-disable @typescript-eslint/no-explicit-any */
type Overview = {
  user: { email: string; role: string };
  connections: Record<string, boolean>;
  ready: boolean;
  error?: string;
  agents?: { name: string; job: string; listens: string[] }[];
  kpis?: any[]; approvals?: any[]; runs?: any[]; incidents?: any[]; tasks?: any[]; failed_events?: any[];
  autonomy?: any[]; quality?: any[]; pipeline?: Record<string, number>;
};

const AGENT_LABEL: Record<string, string> = {
  field_ops: "Field Ops", outreach: "Outreach", concierge: "Concierge", revenue: "Revenue", exec_copilot: "Exec Copilot",
};
const LEVEL_LABEL = ["L0 Observe", "L1 Draft", "L2 Act with review", "L3 Act within guardrails", "L4 Human only"];
const sevColor: Record<string, string> = { emergency: "bg-red-600", high: "bg-orange-600", medium: "bg-amber-600", low: "bg-stone-600" };
const fmtTime = (s?: string) => (s ? new Date(s).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "");
const pct = (n: number | null | undefined) => (n == null ? "–" : `${Math.round(Number(n) * 100)}%`);

function Card({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-ember-700 bg-ember-900 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-bold uppercase tracking-wider text-ember-400">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

const Empty = ({ children }: { children: React.ReactNode }) => <p className="text-sm text-stone-400">{children}</p>;

export default function HostlyCommandCenter() {
  const [sb, setSb] = useState<SupabaseClient | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "no-cloud" | "signed-out" | "ok">("loading");
  const [data, setData] = useState<Overview | null>(null);
  const [flash, setFlash] = useState<string>("");
  const [busy, setBusy] = useState<string>("");

  useEffect(() => {
    (async () => {
      const cfg = await fetch("/api/config").then(r => r.json()).catch(() => ({ cloud: false }));
      if (!cfg.cloud) return setState("no-cloud");
      const client = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
      setSb(client);
      client.auth.onAuthStateChange((_e, session) => {
        setToken(session?.access_token ?? null);
        setState(session ? "ok" : "signed-out");
      });
      const { data: s } = await client.auth.getSession();
      if (!s.session) return setState("signed-out");
      // The very first person to sign in becomes the owner; for everyone else this does nothing.
      await client.rpc("hostly_claim_first_owner").then(() => {}, () => {});
      setToken(s.session.access_token);
      setState("ok");
    })();
  }, []);

  const api = useCallback(async (path: string, body?: unknown) => {
    const r = await fetch(path, { method: body ? "POST" : "GET", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `Error ${r.status}`);
    return j;
  }, [token]);

  const load = useCallback(async () => {
    if (!token) return;
    try { setData(await api("/api/hostly/overview")); } catch (e) { setFlash((e as Error).message); }
  }, [api, token]);

  useEffect(() => {
    if (!token) return;
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [load, token]);

  const act = async (key: string, fn: () => Promise<any>, ok: (r: any) => string) => {
    setBusy(key); setFlash("");
    try { setFlash(ok(await fn())); await load(); } catch (e) { setFlash((e as Error).message); } finally { setBusy(""); }
  };

  const qualityOf = useMemo(() => {
    const m: Record<string, any> = {};
    for (const q of data?.quality ?? []) m[`${q.agent}.${q.action}`] = q;
    return m;
  }, [data]);

  const totals = useMemo(() => {
    const k = data?.kpis ?? [];
    const avail = k.reduce((a, r) => a + Number(r.available_nights || 0), 0);
    const booked = k.reduce((a, r) => a + Number(r.booked_nights || 0), 0);
    return { properties: k.length, occupancy: avail ? booked / avail : null, booked };
  }, [data]);

  if (state === "loading") return <main className="p-8 text-stone-400">Loading Hostly OS…</main>;
  if (state === "no-cloud") return <main className="p-8"><h1 className="text-xl font-bold">Hostly OS</h1><p className="mt-2 text-stone-400">The database isn&apos;t connected on this deployment.</p></main>;
  if (state === "signed-out" && sb) return <SignIn sb={sb} />;

  const isAdmin = data?.user.role === "owner" || data?.user.role === "admin";

  return (
    <main className="mx-auto max-w-7xl p-4 md:p-6">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black tracking-wide">HOSTLY <span className="font-normal text-ember-400">OS</span></h1>
          <p className="text-xs text-stone-400">AI agent command center · {data?.user.email} ({data?.user.role})</p>
        </div>
        <div className="flex flex-wrap gap-1.5 text-xs">
          {Object.entries(data?.connections ?? {}).map(([k, v]) => (
            <span key={k} className={`rounded-full px-2.5 py-1 ${v ? "bg-emerald-900 text-emerald-200" : "bg-stone-800 text-stone-400"}`}>{v ? "●" : "○"} {k.replace("_", " ")}</span>
          ))}
          <button onClick={() => sb?.auth.signOut()} className="rounded-full bg-ember-800 px-2.5 py-1 text-ember-400">Sign out</button>
        </div>
      </header>

      {flash && <div className="mb-4 rounded-lg border border-ember-500 bg-ember-800 px-3 py-2 text-sm">{flash}</div>}

      {data && !data.ready && (
        <Card title="Setup needed">
          <p className="text-sm text-stone-300">Hostly OS tables aren&apos;t reachable yet{data.error ? ` (${data.error})` : ""}. Apply <code>supabase/migrations/0001_hostly_core.sql</code> to the Hostly OS Supabase project and set SUPABASE_SERVICE_ROLE_KEY.</p>
        </Card>
      )}

      {data?.ready && (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="grid grid-cols-2 gap-3 lg:col-span-3 md:grid-cols-4">
            {[
              ["Live properties", String(totals.properties)],
              ["Occupancy, next 30 days", pct(totals.occupancy)],
              ["Waiting for you", String(data.approvals?.length ?? 0)],
              ["Open incidents", String(data.incidents?.length ?? 0)],
            ].map(([l, v]) => (
              <div key={l} className="rounded-xl border border-ember-700 bg-ember-900 p-4">
                <div className="text-2xl font-black">{v}</div>
                <div className="text-xs text-stone-400">{l}</div>
              </div>
            ))}
          </div>

          <div className="lg:col-span-2">
            <Card title={`Approval queue (${data.approvals?.length ?? 0})`}>
              {!data.approvals?.length && <Empty>Nothing waiting. Agents put drafts and price changes here before anything leaves Hostly.</Empty>}
              <div className="space-y-3">
                {data.approvals?.map(a => <ApprovalCard key={a.id} a={a} busy={busy === a.id} canDecide={isAdmin || !(a.level === "L3" || a.level === "L4")}
                  onDecide={(decision, payload, note) => act(a.id, () => api("/api/hostly/approvals", { id: a.id, decision, payload, note }),
                    r => r.status === "executed" ? "Approved and sent." : r.manual ? r.message : decision === "approve" ? "Approved." : "Rejected.")} />)}
              </div>
            </Card>
          </div>

          <div className="space-y-4">
            <Card title="Incidents">
              {!data.incidents?.length && <Empty>No open incidents.</Empty>}
              <ul className="space-y-2">
                {data.incidents?.map(i => (
                  <li key={i.id} className="text-sm">
                    <span className={`mr-2 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${sevColor[i.severity] ?? "bg-stone-600"}`}>{i.severity}</span>
                    {i.summary}
                    <div className="text-xs text-stone-400">respond by {fmtTime(i.respond_by)}</div>
                  </li>
                ))}
              </ul>
            </Card>
            <Card title="Due work">
              {!data.tasks?.length && <Empty>No open tasks.</Empty>}
              <ul className="space-y-1.5 text-sm">
                {data.tasks?.slice(0, 12).map(t => (
                  <li key={t.id} className="flex justify-between gap-2">
                    <span className={t.priority === "urgent" ? "text-red-300" : ""}>{t.title}</span>
                    <span className="shrink-0 text-xs text-stone-400">{fmtTime(t.due_at)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          </div>

          <div className="lg:col-span-2">
            <Card title="AI agent workforce" right={<span className="text-xs text-stone-500">autonomy is earned: ≥97% approved unchanged over 200 decisions</span>}>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs text-stone-400"><tr><th className="py-1">Agent · action</th><th>Level</th><th>28-day quality</th></tr></thead>
                  <tbody>
                    {data.autonomy?.map(a => {
                      const q = qualityOf[`${a.agent}.${a.action}`];
                      return (
                        <tr key={`${a.agent}.${a.action}`} className="border-t border-ember-800 align-top">
                          <td className="py-2 pr-2"><b>{AGENT_LABEL[a.agent] ?? a.agent}</b> · {a.action.replace(/_/g, " ")}<div className="text-xs text-stone-400">{a.description}</div></td>
                          <td className="py-2 pr-2">
                            {isAdmin && a.max_level > 0 ? (
                              <select className="rounded bg-ember-800 px-1.5 py-1 text-xs" value={a.level} disabled={busy === `${a.agent}.${a.action}`}
                                onChange={e => act(`${a.agent}.${a.action}`, () => api("/api/hostly/autonomy", { agent: a.agent, action: a.action, level: Number(e.target.value) }), () => "Autonomy updated.")}>
                                {LEVEL_LABEL.slice(0, a.max_level + 1).map((l, i) => <option key={l} value={i}>{l}</option>)}
                              </select>
                            ) : <span className="text-xs">{LEVEL_LABEL[a.level]}</span>}
                          </td>
                          <td className="py-2 text-xs text-stone-300">{q ? `${pct(q.accuracy)} of ${q.decided}` : "no decisions yet"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>

          <div className="space-y-4">
            <Card title="Add a US lead"><LeadForm busy={busy === "lead"} onSubmit={lead => act("lead", () => api("/api/hostly/leads", lead), r => `Lead added; the Outreach agent ${r.report?.runs?.[0]?.summary?.toLowerCase() ?? "is on it"}.`)} /></Card>
            <Card title="Lead pipeline">
              {!Object.keys(data.pipeline ?? {}).length && <Empty>No leads yet.</Empty>}
              <div className="flex flex-wrap gap-1.5 text-xs">
                {Object.entries(data.pipeline ?? {}).map(([k, v]) => <span key={k} className="rounded bg-ember-800 px-2 py-1">{k.replace(/_/g, " ")}: <b>{v}</b></span>)}
              </div>
            </Card>
          </div>

          <div className="lg:col-span-2">
            <Card title="Agent activity">
              {!data.runs?.length && <Empty>No agent runs yet. Events arrive at /api/hostly/events.</Empty>}
              <ul className="divide-y divide-ember-800 text-sm">
                {data.runs?.map(r => (
                  <li key={r.id} className="flex gap-3 py-1.5">
                    <span className="w-24 shrink-0 text-xs text-stone-400">{fmtTime(r.started_at)}</span>
                    <span className="w-24 shrink-0 text-xs font-bold text-ember-400">{AGENT_LABEL[r.agent] ?? r.agent}</span>
                    <span className={r.status === "failed" ? "text-red-300" : ""}>{r.summary}</span>
                  </li>
                ))}
              </ul>
            </Card>
          </div>

          <Card title="Failed automations">
            {!data.failed_events?.length && <Empty>Nothing failing. Failed events retry with backoff, then land here.</Empty>}
            <ul className="space-y-2 text-sm">
              {data.failed_events?.map(e => (
                <li key={e.id}><b>{e.type}</b> <span className="text-xs text-stone-400">from {e.source}, {e.status}, {e.attempts} tries</span><div className="text-xs text-red-300">{e.last_error}</div></li>
              ))}
            </ul>
          </Card>
        </div>
      )}
    </main>
  );
}

function ApprovalCard({ a, busy, canDecide, onDecide }: { a: any; busy: boolean; canDecide: boolean; onDecide: (d: "approve" | "reject", payload?: any, note?: string) => void }) {
  const [subject, setSubject] = useState<string>(a.payload?.subject ?? "");
  const [body, setBody] = useState<string>(a.payload?.body ?? "");
  const editable = typeof a.payload?.body === "string";
  const ev = a.evidence ?? {};
  return (
    <div className="rounded-lg border border-ember-700 bg-ember-950 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="text-sm font-semibold">{a.title}</div>
        <span className="rounded bg-ember-800 px-1.5 py-0.5 text-[10px] font-bold">{AGENT_LABEL[a.agent] ?? a.agent} · {a.level}</span>
      </div>
      {ev.guest_message && <p className="mt-2 rounded bg-ember-900 p-2 text-xs text-stone-300">Guest: “{ev.guest_message}”</p>}
      {ev.rationale && <p className="mt-2 text-xs text-stone-300">{ev.rationale}</p>}
      {Array.isArray(ev.facts) && ev.facts.length > 0 && <p className="mt-2 text-xs text-emerald-300">Facts: {ev.facts.join(" · ")}</p>}
      {Array.isArray(ev.hypotheses) && ev.hypotheses.length > 0 && <p className="mt-1 text-xs text-amber-300">Guesses (check first): {ev.hypotheses.join(" · ")}</p>}
      {Array.isArray(ev.needs_facts) && ev.needs_facts.length > 0 && <p className="mt-1 text-xs text-amber-300">Missing facts: {ev.needs_facts.join(" · ")}</p>}
      {editable && (
        <div className="mt-2 space-y-1.5">
          {"subject" in (a.payload ?? {}) && <input className="w-full rounded bg-ember-800 px-2 py-1 text-sm" value={subject} onChange={e => setSubject(e.target.value)} />}
          <textarea className="h-28 w-full rounded bg-ember-800 px-2 py-1 text-sm" value={body} onChange={e => setBody(e.target.value)} />
        </div>
      )}
      {a.result?.auto_error && <p className="mt-1 text-xs text-red-300">Auto-send failed: {a.result.auto_error}</p>}
      <div className="mt-2 flex items-center gap-2">
        {canDecide ? (<>
          <button disabled={busy} onClick={() => onDecide("approve", editable ? { subject, body } : undefined)} className="rounded bg-ember-500 px-3 py-1 text-sm font-semibold text-ember-950 disabled:opacity-50">Approve</button>
          <button disabled={busy} onClick={() => onDecide("reject", undefined, prompt("Why reject? (helps the agent learn)") || undefined)} className="rounded bg-ember-800 px-3 py-1 text-sm disabled:opacity-50">Reject</button>
        </>) : <span className="text-xs text-stone-400">An owner or admin decides this one.</span>}
        {a.expires_at && <span className="ml-auto text-xs text-stone-500">expires {fmtTime(a.expires_at)}</span>}
      </div>
    </div>
  );
}

function LeadForm({ busy, onSubmit }: { busy: boolean; onSubmit: (l: Record<string, string>) => void }) {
  const [f, setF] = useState<Record<string, string>>({ market: "US-FL", lead_type: "host" });
  const field = (k: string, ph: string) => <input className="w-full rounded bg-ember-800 px-2 py-1 text-sm" placeholder={ph} value={f[k] ?? ""} onChange={e => setF({ ...f, [k]: e.target.value })} />;
  return (
    <form className="space-y-1.5" onSubmit={e => { e.preventDefault(); onSubmit(f); }}>
      {field("name", "Name")}{field("email", "Email")}{field("listing_url", "Airbnb/VRBO listing link (https://…)")}{field("city", "City (e.g. Kissimmee)")}
      <div className="flex gap-1.5">
        <select className="flex-1 rounded bg-ember-800 px-2 py-1 text-sm" value={f.market} onChange={e => setF({ ...f, market: e.target.value })}>
          <option value="US-FL">Florida</option><option value="US-TN">Tennessee</option>
        </select>
        <select className="flex-1 rounded bg-ember-800 px-2 py-1 text-sm" value={f.lead_type} onChange={e => setF({ ...f, lead_type: e.target.value })}>
          {["host", "owner", "realtor", "investor", "property_manager", "other"].map(t => <option key={t} value={t}>{t.replace("_", " ")}</option>)}
        </select>
      </div>
      <button disabled={busy} className="w-full rounded bg-ember-500 py-1.5 text-sm font-semibold text-ember-950 disabled:opacity-50">{busy ? "Scoring…" : "Add and score"}</button>
    </form>
  );
}

function SignIn({ sb }: { sb: SupabaseClient }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<{ error: { message: string } | null }>, ok: string) => {
    setBusy(true); setMsg("");
    const { error } = await fn();
    setBusy(false);
    setMsg(error ? error.message : ok);
  };
  return (
    <main className="mx-auto mt-24 max-w-sm p-6">
      <h1 className="text-2xl font-black tracking-wide">HOSTLY <span className="font-normal text-ember-400">OS</span></h1>
      <p className="mb-5 text-sm text-stone-400">Sign in to the agent command center.</p>
      <form className="space-y-2" onSubmit={e => { e.preventDefault(); run(() => sb.auth.signInWithPassword({ email: email.trim(), password }), ""); }}>
        <input className="w-full rounded bg-ember-800 px-3 py-2" type="email" placeholder="Email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required />
        <input className="w-full rounded bg-ember-800 px-3 py-2" type="password" placeholder="Password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} />
        <button disabled={busy || !password} className="w-full rounded bg-ember-500 py-2 font-semibold text-ember-950 disabled:opacity-50">Sign in</button>
        <button type="button" disabled={busy || !email} onClick={() => run(() => sb.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: location.origin, shouldCreateUser: true } }), "Check your email for a sign-in link.")}
          className="w-full rounded bg-ember-800 py-2 text-sm disabled:opacity-50">Email me a sign-in link</button>
      </form>
      {msg && <p className="mt-3 text-sm text-ember-400">{msg}</p>}
      <p className="mt-6 text-xs text-stone-500">Only emails on the Hostly OS staff list can see data. The first person to sign in becomes the owner.</p>
    </main>
  );
}
