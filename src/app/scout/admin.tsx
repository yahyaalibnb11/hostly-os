"use client";

import { useMemo, useState } from "react";
import { COUNTRIES, leadReadiness, MARKETS, marketById } from "@/lib/scout/catalog";
import { exportCsv, gradeBadge, statusOf } from "./pages";
import { Avatar, Card, H, type Listing, type Member } from "./ui";

// Yahya only: every lead split into "ready for outreach" (real contact, host name, problems, pitch)
// and "incomplete", with what each one is missing, how complete each student's work is, and the Excel download.

export function AdminLeads({ members, listings, onOpen }: { members: Member[]; listings: Listing[]; onOpen: (l: Listing) => void }) {
  const [view, setView] = useState<"ready" | "incomplete">("ready");
  const [by, setBy] = useState("");
  const [country, setCountry] = useState("");
  const [market, setMarket] = useState("");
  const [q, setQ] = useState("");
  const nameOf = (id: string) => members.find(m => m.id === id)?.name ?? "?";

  const all = useMemo(() => listings.map(l => ({ l, r: leadReadiness(l) })), [listings]);
  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    return all.filter(({ l }) =>
      (!by || l.added_by === by) && (!country || marketById(l.market)?.country === country) && (!market || l.market === market) &&
      (!t || [l.title, l.host_name, l.contact, l.link].some(x => String(x ?? "").toLowerCase().includes(t))),
    );
  }, [all, by, country, market, q]);
  const ready = filtered.filter(x => x.r.complete).sort((a, b) => b.l.score - a.l.score);
  const incomplete = filtered.filter(x => !x.r.complete).sort((a, b) => a.r.missing.length - b.r.missing.length || b.l.score - a.l.score);
  const rows = view === "ready" ? ready : incomplete;

  const perMember = members.map((m, i) => {
    const mine = all.filter(x => x.l.added_by === m.id);
    const ok = mine.filter(x => x.r.complete).length;
    return { m, i, total: mine.length, ok, noContact: mine.filter(x => x.r.missing.includes("Contact")).length };
  }).filter(p => p.total);
  const sel = "scout-input w-auto text-xs";

  return (
    <div className="space-y-4" data-testid="admin-leads">
      <div className="grid grid-cols-2 gap-3">
        <button onClick={() => setView("ready")} className={`scout-card p-4 text-left transition ${view === "ready" ? "!border-emerald-400" : "opacity-80 hover:opacity-100"}`}>
          <div className="text-3xl font-black text-emerald-300 tabular-nums">{ready.length}</div>
          <div className="text-sm font-bold">✅ Ready for outreach</div>
          <div className="text-xs text-mist">Contact, host name, problems and pitch all there</div>
        </button>
        <button onClick={() => setView("incomplete")} className={`scout-card p-4 text-left transition ${view === "incomplete" ? "!border-amber-400" : "opacity-80 hover:opacity-100"}`}>
          <div className="text-3xl font-black text-amber-300 tabular-nums">{incomplete.length}</div>
          <div className="text-sm font-bold">⚠️ Incomplete</div>
          <div className="text-xs text-mist">Something is missing, mostly the contact</div>
        </button>
      </div>

      <Card>
        <H right={<span className="text-xs text-mist/70">Complete leads / all leads</span>}>👥 Quality per student</H>
        <ul className="space-y-2 text-sm">
          {perMember.map(p => (
            <li key={p.m.id} className="flex items-center gap-3">
              <Avatar name={p.m.name} i={p.i} size={28} />
              <div className="min-w-0 flex-1">
                <div className="flex justify-between gap-2"><b>{p.m.name}</b><span className="text-xs text-mist"><b className="text-emerald-300">{p.ok}</b> / {p.total} ready · {p.noContact} without contact</span></div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-white/5"><div className="h-full rounded-full bg-emerald-400" style={{ width: `${(p.ok / p.total) * 100}%` }} /></div>
              </div>
            </li>
          ))}
          {!perMember.length && <li className="text-mist">No leads yet.</li>}
        </ul>
      </Card>

      <Card>
        <H right={
          <button data-testid="admin-download" onClick={() => exportCsv(rows.map(x => x.l), members, view === "ready" ? "hostly-ready-leads" : "hostly-incomplete-leads")} className="rounded-xl bg-emerald-500 px-4 py-2 text-sm font-black text-emerald-950 transition hover:brightness-110">⬇️ Download Excel ({rows.length})</button>
        }>{view === "ready" ? "✅ Ready for outreach" : "⚠️ Incomplete leads"}</H>
        <div className="mb-3 flex flex-wrap gap-2">
          <input className="scout-input max-w-xs text-xs" placeholder="🔍 Title, host, contact…" value={q} onChange={e => setQ(e.target.value)} />
          <select className={sel} value={by} onChange={e => setBy(e.target.value)}><option value="">All members</option>{members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
          <select className={sel} value={country} onChange={e => { setCountry(e.target.value); setMarket(""); }}><option value="">All countries</option>{COUNTRIES.map(c => <option key={c}>{c}</option>)}</select>
          <select className={sel} value={market} onChange={e => setMarket(e.target.value)}><option value="">All markets</option>{MARKETS.filter(m => !country || m.country === country).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
        </div>
        {!rows.length && <p className="py-8 text-center text-sm text-mist">Nothing here.</p>}
        <div className="space-y-2">
          {rows.map(({ l, r }) => (
            <button key={l.id} onClick={() => onOpen(l)} className="flex w-full items-center gap-3 rounded-xl bg-white/5 p-3 text-left transition hover:bg-white/10">
              <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg font-black ${gradeBadge(l.grade)}`}>{l.score}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-bold">{l.title || l.link}</div>
                <div className="truncate text-xs text-mist">{l.host_name || "No host name"} · {marketById(l.market)?.flag} {marketById(l.market)?.name} · by {nameOf(l.added_by)} · {statusOf(l.status).label}</div>
                {r.complete
                  ? <div className="truncate text-xs text-sky-300">📇 {l.contact}</div>
                  : <div className="text-xs font-semibold text-amber-300">Missing: {r.missing.join(", ")}</div>}
              </div>
            </button>
          ))}
        </div>
      </Card>
    </div>
  );
}

// For students: a faint name stamp over the screen, so a screenshot or photo of the leads shows who took it.
export function Watermark({ name }: { name: string }) {
  const text = `${name} · Hostly Scout · ${new Date().toLocaleDateString()}`;
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-40 overflow-hidden" data-testid="watermark">
      <div className="absolute -inset-1/2 flex rotate-[-24deg] flex-wrap content-start gap-x-16 gap-y-20 opacity-[.05]">
        {Array.from({ length: 120 }, (_, i) => <span key={i} className="whitespace-nowrap text-sm font-bold text-white">{text}</span>)}
      </div>
    </div>
  );
}
