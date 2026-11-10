"use client";

import { useMemo, useState } from "react";
import { COUNTRIES, GRADE, leadReadiness, MANAGED_BY, MARKETS, marketById, problemById, STATUSES } from "@/lib/scout/catalog";
import { ago, Avatar, Card, CountUp, H, Ring, startOfDay, startOfWeek, type Api, type Listing, type Member } from "./ui";

const QUOTES = [
  "Every listing you check brings you one step closer to a deal. 💪",
  "10 listings a day = 300 a month. If just 3 say yes, the game changes.",
  "Spotting problems is the real skill. More problems, stronger pitch.",
  "Today's work is tomorrow's recurring income. Let's go! 🚀",
  "Every big company started with one listing.",
];
export const statusOf = (id: string) => STATUSES.find(s => s.id === id) ?? STATUSES[0];
export const gradeBadge = (g: string) => g === "hot" ? "bg-door text-night" : g === "warm" ? "bg-door-hi/90 text-night" : "bg-slate-600 text-white";

export function useStats(listings: Listing[], members: Member[]) {
  return useMemo(() => {
    const day = startOfDay(), week = startOfWeek();
    const isReady = (l: Listing) => l.ready ?? leadReadiness(l).complete;
    const per = members.map((m, i) => {
      const mine = listings.filter(l => l.added_by === m.id);
      const done = mine.filter(isReady);
      return {
        ...m, i, total: mine.length,
        ready: done.length,
        readyWeek: done.filter(l => new Date(l.created_at).getTime() >= week).length,
        today: mine.filter(l => new Date(l.created_at).getTime() >= day).length,
        week: mine.filter(l => new Date(l.created_at).getTime() >= week).length,
        hot: mine.filter(l => l.grade === "hot").length,
      };
    });
    return {
      // Complete leads count, not just uploads: quality beats speed.
      per, ranked: [...per].sort((a, b) => b.readyWeek - a.readyWeek || b.ready - a.ready || b.week - a.week),
      total: listings.length,
      ready: listings.filter(isReady).length,
      hot: listings.filter(l => l.grade === "hot").length,
      contacted: listings.filter(l => ["contacted", "replied", "call", "won"].includes(l.status)).length,
      won: listings.filter(l => l.status === "won").length,
      today: listings.filter(l => new Date(l.created_at).getTime() >= day).length,
    };
  }, [listings, members]);
}

export function Dashboard({ me, members, listings, onOpen, onAdd }: { me: Member; members: Member[]; listings: Listing[]; onOpen: (l: Listing) => void; onAdd: () => void }) {
  const st = useStats(listings, members);
  const mine = st.per.find(p => p.id === me.id);
  const goal = me.daily_goal || 10;
  const left = Math.max(0, goal - (mine?.today ?? 0));
  const quote = QUOTES[new Date().getDate() % QUOTES.length];
  const nameOf = (id: string) => members.find(m => m.id === id)?.name ?? "?";
  const hot = listings.filter(l => l.link && ["new", "drafted"].includes(l.status)).sort((a, b) => b.score - a.score).slice(0, 6);
  const byCountry = COUNTRIES.map(c => ({ c, n: listings.filter(l => marketById(l.market)?.country === c).length })).filter(x => x.n || x.c !== "Other");
  const maxWeek = Math.max(1, ...st.per.map(p => p.readyWeek));

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="relative overflow-hidden lg:col-span-2" delay={0}>
        <div className="pointer-events-none absolute -right-10 -top-10 h-48 w-48 rounded-full bg-door/20 blur-3xl" />
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
          <Ring value={mine?.today ?? 0} max={goal} size={150} stroke={12} color={left === 0 ? "#34d399" : "#FFB347"}>
            <div className="text-4xl font-black tabular-nums"><CountUp value={mine?.today ?? 0} /></div>
            <div className="text-xs text-mist">/ {goal} today</div>
          </Ring>
          <div className="space-y-2">
            <h2 className="text-2xl font-black md:text-3xl">Welcome back, <span className="scout-shine">{me.name}</span> 👋</h2>
            <p className="text-bone/80">{left === 0 ? "🎉 Daily target hit! Now send pitches to your hot leads." : `${left} more listing${left > 1 ? "s" : ""} to hit today's target.`}</p>
            <p className="text-sm italic text-mist">{quote}</p>
            <button onClick={onAdd} className="mt-1 rounded-xl bg-gradient-to-r from-door-deep to-door px-5 py-2.5 font-black text-night shadow-lg shadow-door/25 transition hover:brightness-110 active:scale-[.98]">➕ Add a new listing</button>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-3">
        {([["Total listings", st.total, "📋"], ["Ready leads", st.ready, "✅"], ["Contacted", st.contacted, "✉️"], ["Deals", st.won, "🏆"]] as const).map(([l, v, e], i) => (
          <Card key={l} delay={80 + i * 60} className="!p-4">
            <div className="text-2xl">{e}</div>
            <div className="mt-1 text-3xl font-black tabular-nums"><CountUp value={v} /></div>
            <div className="text-xs text-mist">{l}</div>
          </Card>
        ))}
      </div>

      <Card className="lg:col-span-2" delay={200}>
        <H right={<span className="text-xs text-mist/70">Ranked by complete leads this week</span>}>🏆 Team leaderboard</H>
        <ul className="space-y-3">
          {st.ranked.map((p, rank) => (
            <li key={p.id} className="scout-rise flex items-center gap-3" style={{ animationDelay: `${250 + rank * 80}ms` }}>
              <div className="w-7 text-center text-xl">{["🥇", "🥈", "🥉"][rank] ?? <span className="text-sm text-mist/70">{rank + 1}</span>}</div>
              <Avatar name={p.name} i={p.i} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <b className={p.id === me.id ? "text-door" : ""}>{p.name}{p.id === me.id && " (you)"}</b>
                  <span className="text-xs text-mist"><b className="text-emerald-300">{p.readyWeek} ✅</b> this week · {p.week} added · {p.ready}/{p.total} complete</span>
                </div>
                <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-white/5">
                  <div className={`scout-bar h-full rounded-full bg-gradient-to-r ${rank === 0 ? "from-door-deep to-door-hi" : "from-pool-deep to-pool"}`} style={{ width: `${(p.readyWeek / maxWeek) * 100}%` }} />
                </div>
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <Card delay={260}>
        <H>🌍 Listings by market</H>
        <ul className="space-y-2 text-sm">
          {byCountry.map(x => (
            <li key={x.c} className="flex items-center justify-between rounded-lg bg-white/5 px-3 py-2">
              <span>{MARKETS.find(m => m.country === x.c)?.flag} {x.c}</span><b className="tabular-nums">{x.n}</b>
            </li>
          ))}
        </ul>
      </Card>

      <Card className="lg:col-span-2" delay={320}>
        <H right={<span className="text-xs text-mist/70">Not contacted yet</span>}>🔥 Hottest leads</H>
        {!hot.length && <p className="text-sm text-mist">No leads yet. Add the first listing!</p>}
        <div className="grid gap-2 sm:grid-cols-2">
          {hot.map((l, i) => (
            <button key={l.id} onClick={() => onOpen(l)} className="scout-rise flex items-center gap-3 rounded-xl border border-white/5 bg-white/5 p-3 text-left transition hover:-translate-y-0.5 hover:border-door/40" style={{ animationDelay: `${360 + i * 50}ms` }}>
              <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-lg font-black ${gradeBadge(l.grade)} ${l.grade === "hot" ? "scout-glow" : ""}`}>{l.score}</div>
              <div className="min-w-0">
                <div className="truncate text-sm font-bold">{l.title || l.link}</div>
                <div className="truncate text-xs text-mist">{marketById(l.market)?.flag} {marketById(l.market)?.name} · {l.problem_count} problems · {nameOf(l.added_by)}</div>
              </div>
            </button>
          ))}
        </div>
      </Card>

      <Card delay={380}>
        <H>⚡ Latest activity</H>
        <ul className="space-y-2.5 text-sm">
          {listings.slice(0, 8).map(l => (
            <li key={l.id} className="flex gap-2">
              <Avatar name={nameOf(l.added_by)} i={members.findIndex(m => m.id === l.added_by)} size={26} />
              <div className="min-w-0"><b>{nameOf(l.added_by)}</b> <span className="text-mist">added</span> <span className="truncate">{l.title || "listing"}</span><div className="text-xs text-mist/70">{ago(l.created_at)}</div></div>
            </li>
          ))}
          {!listings.length && <li className="text-mist">Nothing yet.</li>}
        </ul>
      </Card>
    </div>
  );
}

// ---------------- The sheet ----------------
const COLS: [string, string, (l: Listing, names: (id: string) => string) => string | number][] = [
  ["Added by", "added_by", (l, n) => n(l.added_by)],
  ["Date", "created_at", l => new Date(l.created_at).toISOString().slice(0, 10)],
  ["Country", "country", l => marketById(l.market)?.country ?? ""],
  ["Market", "market", l => marketById(l.market)?.name ?? l.market],
  ["Listing link", "link", l => l.link],
  ["Name of host", "host_name", l => l.host_name ?? ""],
  ["Number of properties", "host_listings", l => l.host_listings ?? ""],
  ["Property type", "property_type", l => l.property_type ?? ""],
  ["Listing title", "title", l => l.title ?? ""],
  ["Rating", "rating", l => l.rating ?? ""],
  ["Reviews", "reviews", l => l.reviews ?? ""],
  ["Currency", "currency", l => l.currency ?? ""],
  ["Weekday price", "weekday_price", l => l.weekday_price ?? ""],
  ["Weekend price", "weekend_price", l => l.weekend_price ?? ""],
  ["Minimum nights", "min_nights", l => l.min_nights ?? ""],
  ["No of photos", "photos", l => l.photos ?? ""],
  ["Response rate %", "response_rate", l => l.response_rate ?? ""],
  ["Managing by", "managed_by", l => MANAGED_BY.find(m => m.id === l.managed_by)?.label ?? ""],
  ["Licence number", "licence_number", l => l.licence_number ?? ""],
  ["Number of problems", "problem_count", l => l.problem_count ?? 0],
  ["Problems", "problems", l => [...(l.problems ?? []).map((id: string) => problemById(id)?.label ?? id), ...String(l.custom_problems ?? "").split("\n").filter(Boolean)].join("; ")],
  ["Solutions of problems", "solutions", l => String(l.solutions ?? "").replace(/\n/g, " ")],
  ["Score", "score", l => l.score],
  ["Lead", "grade", l => GRADE[l.grade]?.label.replace(/^\S+ /, "") ?? ""],
  ["Status", "status", l => statusOf(l.status).label],
  ["Contact", "contact", l => l.contact ?? ""],
  ["Pitch subject", "pitch_subject", l => l.pitch_subject ?? ""],
  ["Pitch draft", "pitch", l => l.pitch ?? ""],
  ["Notes", "notes", l => l.notes ?? ""],
];

export function exportCsv(rows: Listing[], members: Member[], name = "hostly-scout", log?: (detail: string) => void) {
  log?.(`${name}: ${rows.length} rows`);
  const names = (id: string) => members.find(m => m.id === id)?.name ?? "";
  const esc = (v: unknown) => { const s = String(v ?? ""); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = [COLS.map(c => c[0]).join(","), ...rows.map(r => COLS.map(c => esc(c[2](r, names))).join(","))].join("\r\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${name}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export function Sheet({ me, members, listings, onOpen, onDelete, log }: { me: Member; members: Member[]; listings: Listing[]; onOpen: (l: Listing) => void; onDelete: (l: Listing) => void; log?: (detail: string) => void }) {
  const [q, setQ] = useState("");
  const [country, setCountry] = useState("");
  const [market, setMarket] = useState("");
  const [by, setBy] = useState("");
  const [grade, setGrade] = useState("");
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState<"score" | "date">("score");
  const nameOf = (id: string) => members.find(m => m.id === id)?.name ?? "?";
  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    return listings.filter(l => l.link && (me.is_admin || l.added_by === me.id || l.assigned_to === me.id)).filter(l =>
      (!t || [l.title, l.host_name, l.link, l.notes].some(x => String(x ?? "").toLowerCase().includes(t))) &&
      (!country || marketById(l.market)?.country === country) && (!market || l.market === market) &&
      (!by || l.added_by === by) && (!grade || l.grade === grade) && (!status || l.status === status),
    ).sort((a, b) => sort === "score" ? b.score - a.score : +new Date(b.created_at) - +new Date(a.created_at));
  }, [listings, me, q, country, market, by, grade, status, sort]);
  const sel = "scout-input w-auto text-xs";

  return (
    <Card>
      <H right={me.is_admin ? <button onClick={() => exportCsv(rows, members, "hostly-scout", log)} className="rounded-xl bg-emerald-500 px-4 py-2 text-sm font-black text-emerald-950 transition hover:brightness-110">⬇️ Download Excel ({rows.length})</button> : <span className="text-xs text-mist/70">🔒 Only Yahya can download</span>}>{me.is_admin ? "📋 All listings" : "📋 My listings"}</H>
      <div className="mb-3 flex flex-wrap gap-2">
        <input className="scout-input max-w-xs text-xs" placeholder="🔍 Title, host, link…" value={q} onChange={e => setQ(e.target.value)} />
        <select className={sel} value={country} onChange={e => { setCountry(e.target.value); setMarket(""); }}><option value="">All countries</option>{COUNTRIES.map(c => <option key={c}>{c}</option>)}</select>
        <select className={sel} value={market} onChange={e => setMarket(e.target.value)}><option value="">All markets</option>{MARKETS.filter(m => !country || m.country === country).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
        {me.is_admin && <select className={sel} value={by} onChange={e => setBy(e.target.value)}><option value="">All members</option>{members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select>}
        <select className={sel} value={grade} onChange={e => setGrade(e.target.value)}><option value="">All leads</option>{Object.entries(GRADE).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
        <select className={sel} value={status} onChange={e => setStatus(e.target.value)}><option value="">All statuses</option>{STATUSES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}</select>
        <select className={sel} value={sort} onChange={e => setSort(e.target.value as "score" | "date")}><option value="score">By score</option><option value="date">Newest first</option></select>
      </div>
      {!rows.length && <p className="py-8 text-center text-sm text-mist">No listings found.</p>}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase tracking-wider text-mist/70">
            <tr>{["Score", "Listing", "Market", "Host", "Rating", "Weekday / Weekend", "Problems", "By", "Ready?", "Status", ""].map(h => <th key={h} className="px-2 py-2 font-semibold">{h}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((l, i) => (
              <tr key={l.id} onClick={() => onOpen(l)} className="scout-rise cursor-pointer border-t border-white/5 transition hover:bg-white/5" style={{ animationDelay: `${Math.min(i, 20) * 25}ms` }}>
                <td className="px-2 py-2.5"><span className={`inline-flex h-9 w-9 items-center justify-center rounded-lg font-black ${gradeBadge(l.grade)}`}>{l.score}</span></td>
                <td className="max-w-[260px] px-2"><div className="truncate font-semibold">{l.title || "—"}</div><a href={l.link} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} className="truncate text-xs text-sky-300 hover:underline">{l.link.replace(/^https?:\/\/(www\.)?/, "").slice(0, 40)}</a></td>
                <td className="px-2 text-xs">{marketById(l.market)?.flag} {marketById(l.market)?.name}</td>
                <td className="px-2 text-xs">{l.host_name || "—"}{l.host_listings != null && <span className="text-mist/70"> · {l.host_listings} props</span>}</td>
                <td className="px-2 text-xs">{l.rating ?? "—"}{l.reviews != null && <span className="text-mist/70"> ({l.reviews})</span>}</td>
                <td className="px-2 text-xs tabular-nums">{l.weekday_price ?? "—"} / {l.weekend_price ?? "—"} {l.currency}</td>
                <td className="px-2 text-center font-bold">{l.problem_count}</td>
                <td className="px-2 text-xs">{nameOf(l.added_by)}</td>
                <td className="px-2"><Ready l={l} /></td>
                <td className="px-2"><span className={`rounded-full px-2 py-0.5 text-[11px] font-bold text-white ${statusOf(l.status).color}`}>{statusOf(l.status).label}</span></td>
                <td className="px-2 text-right">{((l.added_by === me.id && !l.locked) || me.is_admin) && <button title="Remove" onClick={e => { e.stopPropagation(); onDelete(l); }} className="rounded px-2 py-1 text-mist/70 hover:bg-red-500/20 hover:text-red-300">🗑</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="space-y-2 md:hidden">
        {rows.map(l => (
          <button key={l.id} onClick={() => onOpen(l)} className="flex w-full items-center gap-3 rounded-xl bg-white/5 p-3 text-left">
            <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg font-black ${gradeBadge(l.grade)}`}>{l.score}</span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-bold">{l.title || l.link}</div>
              <div className="truncate text-xs text-mist">{marketById(l.market)?.name} · {l.problem_count} problems · {nameOf(l.added_by)} · {statusOf(l.status).label}</div>
              <div className="mt-1"><Ready l={l} /></div>
            </div>
          </button>
        ))}
      </div>
    </Card>
  );
}

// ✅ ready for outreach, or what is still missing.
export function Ready({ l }: { l: Listing }) {
  const r = leadReadiness(l);
  if (l.locked) return <span data-testid="locked" title="Complete lead: handed to Yahya" className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[11px] font-bold text-emerald-300">🔒 Complete · handed over</span>;
  return r.complete || l.ready
    ? <span data-testid="ready" className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[11px] font-bold text-emerald-300">✅ Ready</span>
    : <span data-testid="missing" title={`Missing: ${r.missing.join(", ")}`} className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-bold text-amber-300">⚠️ Missing: {r.missing.join(", ")}</span>;
}

// ---------------- Pitches ----------------
export function Pitches({ api, members, listings, onOpen, onChanged, toast }: { api: Api; members: Member[]; listings: Listing[]; onOpen: (l: Listing) => void; onChanged: (l: Listing) => void; toast: (m: string, k?: "ok" | "err") => void }) {
  const [tab, setTab] = useState("drafted");
  const withPitch = listings.filter(l => l.pitch);
  const rows = withPitch.filter(l => l.status === tab).sort((a, b) => b.score - a.score);
  const nameOf = (id: string) => members.find(m => m.id === id)?.name ?? "?";
  const move = async (l: Listing, status: string) => {
    try { const r = await api("/api/scout/listings", { body: { id: l.id, status } }); onChanged(r.listing); toast(status === "won" ? "Congratulations! 🎉 Deal won" : `Status: ${statusOf(status).label}`); }
    catch (e) { toast((e as Error).message, "err"); }
  };
  return (
    <div className="space-y-4">
      <div className="flex gap-2 overflow-x-auto pb-1">
        {STATUSES.filter(s => s.id !== "new").map(s => {
          const n = withPitch.filter(l => l.status === s.id).length;
          return <button key={s.id} onClick={() => setTab(s.id)} className={`shrink-0 rounded-xl px-4 py-2 text-sm font-bold transition ${tab === s.id ? "bg-white text-night" : "bg-white/5 text-bone/80 hover:bg-white/10"}`}>{s.label} <span className="ml-1 rounded-full bg-black/20 px-1.5 text-xs">{n}</span></button>;
        })}
      </div>
      {!rows.length && <Card><p className="py-6 text-center text-sm text-mist">Nothing in this list yet.</p></Card>}
      <div className="grid gap-4 lg:grid-cols-2">
        {rows.map((l, i) => (
          <Card key={l.id} delay={i * 50}>
            <div className="mb-2 flex items-start justify-between gap-2">
              <div className="min-w-0">
                <button onClick={() => onOpen(l)} className="truncate text-left font-bold hover:underline">{l.title || l.link}</button>
                <div className="text-xs text-mist">{l.host_name || "Host"} · {marketById(l.market)?.name} · {nameOf(l.added_by)} {l.contact && <>· <span className="text-sky-300">{l.contact}</span></>}</div>
              </div>
              <span className={`shrink-0 rounded-lg px-2 py-1 text-sm font-black ${gradeBadge(l.grade)}`}>{l.score}</span>
            </div>
            <div className="mb-1 text-sm font-semibold text-bone">{l.pitch_subject}</div>
            <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-xl bg-black/30 p-3 font-sans text-xs leading-relaxed text-bone/80">{l.pitch}</pre>
            <div className="mt-3 flex flex-wrap gap-2">
              <button onClick={async () => { try { await navigator.clipboard.writeText(`${l.pitch_subject}\n\n${l.pitch}`); toast("Copied 📋"); } catch { toast("Couldn't copy", "err"); } }} className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold hover:bg-white/15">📋 Copy</button>
              <select className="scout-input w-auto text-xs" value={l.status} onChange={e => move(l, e.target.value)}>{STATUSES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}</select>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ---------------- Markets ----------------
export function Markets({ listings }: { listings: Listing[] }) {
  return (
    <div className="space-y-6">
      {COUNTRIES.filter(c => c !== "Other").map((c, ci) => (
        <div key={c}>
          <h2 className="scout-rise mb-3 text-xl font-black" style={{ animationDelay: `${ci * 80}ms` }}>{MARKETS.find(m => m.country === c)?.flag} {c === "Europe" ? "Rest of Europe" : c}</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {MARKETS.filter(m => m.country === c).map((m, i) => {
              const n = listings.filter(l => l.market === m.id).length;
              return (
                <Card key={m.id} delay={ci * 80 + i * 50} className="flex flex-col !p-4 transition hover:-translate-y-1">
                  <div className="flex items-start justify-between gap-2"><h3 className="font-extrabold">{m.flag} {m.name}</h3><span className="rounded-full bg-white/10 px-2 py-0.5 text-xs font-bold">{n}</span></div>
                  <p className="mt-1 text-xs text-mist">{m.areas}</p>
                  <p className="mt-2 text-xs text-bone/80">{m.note}</p>
                  <p className="mt-2 text-xs text-door-hi/90">📜 {m.licence}</p>
                  <div className="mt-auto flex gap-2 pt-3">
                    <a className="rounded-lg bg-white/10 px-2.5 py-1 text-xs font-semibold hover:bg-white/20" target="_blank" rel="noreferrer" href={`https://www.airbnb.com/s/${encodeURIComponent(m.areas.split(",")[0] + ", " + m.name.replace(/ \(.*\)$/, ""))}/homes`}>Search on Airbnb ↗</a>
                    <span className="self-center text-xs text-mist/70">{m.currency}</span>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------- Guide ----------------
const GUIDE: { t: string; e: string; body: React.ReactNode }[] = [
  { t: "Daily routine (45 minutes)", e: "⏰", body: <ol className="list-decimal space-y-1 pl-5"><li>Open the Dashboard and check your target (10 listings).</li><li>Pick your market on the Markets page and press &quot;Search on Airbnb&quot;.</li><li>Give each listing 3-4 minutes: screenshots or data, tick problems, save.</li><li>At the end of the day, copy the pitches for 🔥 hot leads and send them.</li><li>Update the status on the Pitches page: Contacted, Replied, Call booked.</li></ol> },
  { t: "📸 A listing in 1 minute with 9 screenshots", e: "🤖", body: <ol className="list-decimal space-y-1 pl-5"><li>Open the listing in the Airbnb app or website.</li><li>Take 9 screenshots (Windows + Shift + S on a laptop, never a phone photo of the screen): (1) the top: title, photos, rating, reviews, link (2) &quot;Show all photos&quot; scrolled down, to count photos (3) calendar, Tue → Wed, 1 night, with this month and next month showing (open and booked days) plus the price box: nightly price, cleaning fee, minimum nights and the Reserve / Request to book button (4) calendar, Fri → Sat, 1 night: weekend price (5) &quot;About this space&quot; → Show more (6) &quot;What this place offers&quot; (7) reviews: rating breakdown and 3-4 full reviews, ideally sorted by Lowest rated (8) the host profile: name, &quot;Lives in…&quot;, response rate, years hosting, and the host&apos;s other listings (9) Europe / UK: scroll to the bottom of the listing and open &quot;Business details&quot; / &quot;Host details&quot; if it&apos;s there: company name, address and registration number. This is the #1 way to find the owner. Spain / Portugal / Greece: add the licence number. No map or video needed.</li><li>In &quot;New listing&quot;, press 📷 Camera or 🖼️ Choose screenshots. On a laptop you can also paste with Ctrl+V.</li><li>Press &quot;Scan&quot;. AI fills in the title, rating, prices, photos, host, problems and guest complaints.</li><li>Always paste the listing link (that&apos;s how duplicates are caught), check everything, then save.</li></ol> },
  { t: "💰 Save credits: the right way", e: "✅", body: <div className="space-y-2"><p>Every AI button costs real money. Done right, 10 listings cost about $0.50-1.00 a day.</p><ol className="list-decimal space-y-1 pl-5"><li><b>Pick findable listings:</b> hosts with 2-15 listings, a brand name or Business details. Skip Superhosts with 4.9+ and full calendars, and single hosts with just a first name.</li><li><b>Scan once</b> with the 9 good screenshots (3-5¢). Fix small mistakes by hand, don&apos;t rescan.</li><li><b>Check the badge:</b> 🟢 / 🟡 = run Quick search. 🔴 = no AI search: try the free buttons, save, move on.</li><li><b>Free buttons first</b>, then <b>Quick search (~5¢)</b>. <b>Deep search (~30¢)</b> only for a strong lead when Quick found nothing.</li><li>Never press the same search twice on one listing. The answer won&apos;t change.</li><li><b>5-minute rule:</b> no contact in 5 minutes? Save it and go to the next listing.</li></ol><p className="text-xs text-mist">Contact found? Press &quot;Add to Contact and Notes&quot;, send a personal pitch (never in the Airbnb inbox) and update the status.</p></div> },
  { t: "Finding the host outside Airbnb", e: "🕵️", body: <div className="space-y-2"><p><b>Never pitch in the Airbnb inbox.</b> First press <b>🤖 Find contact with AI</b> in the form: it reads the whole listing and checks Google, Booking, Vrbo, company registers, Google Maps, Facebook, Instagram, LinkedIn, TikTok and the host&apos;s own website, then shows what it tried. Look at the 🟢🟡🔴 badge: spend your time on 🟢 and 🟡 hosts. You can also check by hand with the buttons, in this order:</p><ol className="list-decimal space-y-1 pl-5"><li><b>Google: host + city</b>. Often finds the host&apos;s own website or holiday-let page with an email or phone.</li><li><b>Title on Google</b>. If the same property is on Booking.com or its own site, the contact is there.</li><li><b>Google Lens</b>: upload a screenshot of the cover photo to find sites using the same photos.</li><li><b>Facebook / Instagram</b>: host name + city. Match the profile photo with the Airbnb one.</li><li><b>LinkedIn</b>: hosts with several listings are often landlords or investors.</li><li><b>UK: Companies House</b>: if the host is a company, you get the director&apos;s name and address.</li><li><b>Spain / Portugal: licence number</b> on Google can reveal the company name.</li><li><b>Facebook groups</b>: join the city&apos;s host groups and post helpful content (the Listing Makeover offer).</li></ol><p className="text-xs text-mist">Found it? Put it in the &quot;Contact&quot; box. Not found? Save the listing anyway, you can reach them later through groups.</p></div> },
  { t: "Which listings to pick", e: "🎯", body: <ul className="list-disc space-y-1 pl-5"><li>The host has 1-5 listings (not big companies).</li><li>Rating under 4.8, few reviews, or weak photos.</li><li>The calendar looks empty while the rest of the area is booked.</li><li>The host manages it alone (personal messages, no &quot;Co-host&quot; listed).</li><li>In Spain / Portugal / Greece always check the licence number. No licence, no pitch.</li></ul> },
  { t: "Where to find each field", e: "🔎", body: <div className="overflow-x-auto"><table className="w-full text-left text-xs"><tbody>{[
    ["Name of host", "At the bottom of the listing: \"Hosted by …\""], ["Number of properties", "Click the host name → \"Listings\" on the profile"], ["Property type / BHK", "Under the title: \"2 bedrooms · 3 beds\""],
    ["Rating and reviews", "Next to the title: ⭐ 4.72 · 38 reviews"], ["Weekday / weekend price", "Pick a Tuesday and a Saturday in the calendar and note the price"], ["Minimum nights", "In the calendar: \"2 night minimum\""],
    ["No. of photos", "Press \"Show all photos\" and count"], ["Response rate", "On the host profile: \"Response rate: 90%\""], ["Self or co-host", "Look for a \"Co-hosts\" section and the host's other listings"],
    ["Licence", "Under the description: \"Registration number\" / \"Licence\""],
  ].map(([a, b]) => <tr key={a} className="border-t border-white/5"><td className="py-1.5 pr-3 font-bold">{a}</td><td className="py-1.5 text-bone/80">{b}</td></tr>)}</tbody></table></div> },
  { t: "What the score means", e: "📈", body: <div className="grid gap-2 sm:grid-cols-3">{Object.values(GRADE).map((g, i) => <div key={g.label} className="rounded-xl bg-white/5 p-3"><b>{g.label}</b><div className="text-xs text-mist">{["Score 60+. The owner is losing money. Message today, follow up in 2 days.", "Score 35-59. Plenty of problems. A personal message and a free offer.", "Score under 35. The listing is doing fine. Short message, don't spend long."][i]}</div></div>)}<p className="text-xs text-mist sm:col-span-3">⚡ problems are ticked automatically from the numbers (for example a rating under 4.7). You tick the rest. Each problem has points; the total makes the score.</p></div> },
  { t: "How to send a pitch", e: "✉️", body: <ul className="list-disc space-y-1 pl-5"><li><b>Never pitch in the Airbnb / Vrbo inbox.</b> It can get the account banned.</li><li>Use Facebook, the host&apos;s website, email or LinkedIn. Note it in the Contact box.</li><li>Always read the draft and add one line of your own (something nice about their listing).</li><li>Mention only 2-3 problems, not all of them. Friendly tone, not criticism.</li><li>No reply? One short follow-up after 3 days, then stop.</li><li>In the UK / Europe add &quot;Reply STOP if you&apos;d rather not hear from me&quot; under emails.</li></ul> },
  { t: "Don'ts", e: "🚫", body: <ul className="list-disc space-y-1 pl-5"><li>Don&apos;t add the same listing twice. Paste the link first and the tool will stop you.</li><li>No made-up numbers or &quot;guarantees&quot;.</li><li>Barcelona, Palma, Ibiza, central London, Vienna residential zones: don&apos;t pitch short-term lets there.</li><li>Don&apos;t send one generic message to everyone.</li></ul> },
  { t: "Where the data is saved", e: "🔒", body: <p>Everything is saved in Hostly&apos;s online database, not on your phone or laptop. Deleting a listing only hides it; it stays in the database. Use &quot;Download Excel&quot; on the Sheet page to export the whole sheet any time.</p> },
];

export function Guide() {
  const [open, setOpen] = useState(0);
  return (
    <div className="mx-auto max-w-3xl space-y-3">
      <Card className="text-center"><div className="scout-float text-5xl">📘</div><h2 className="mt-2 text-2xl font-black">Hostly Scout guide</h2><p className="text-sm text-mist">From listing research to pitch, step by step.</p></Card>
      {GUIDE.map((g, i) => (
        <Card key={g.t} delay={i * 50} className="!p-0">
          <button onClick={() => setOpen(open === i ? -1 : i)} className="flex w-full items-center gap-3 p-4 text-left">
            <span className="text-2xl">{g.e}</span><b className="flex-1">{i + 1}. {g.t}</b>
            <span className={`transition-transform duration-300 ${open === i ? "rotate-180" : ""}`}>⌄</span>
          </button>
          <div className={`grid transition-all duration-300 ${open === i ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}>
            <div className="overflow-hidden"><div className="px-4 pb-4 text-sm text-bone">{g.body}</div></div>
          </div>
        </Card>
      ))}
    </div>
  );
}

// ---------------- Team ----------------
export function Team({ api, me, members, reload, toast }: { api: Api; me: Member; members: Member[]; reload: () => void; toast: (m: string, k?: "ok" | "err") => void }) {
  const [pins, setPins] = useState<Record<string, string>>({});
  const [goals, setGoals] = useState<Record<string, string>>({});
  const [newName, setNewName] = useState("");
  const [newPin, setNewPin] = useState("");
  const run = async (body: unknown, ok: string) => { try { await api("/api/scout/team", { body }); toast(ok); reload(); } catch (e) { toast((e as Error).message, "err"); } };
  const visible = me.is_admin ? members : members.filter(m => m.id === me.id);
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Card>
        <H>👥 Team {me.is_admin && <span className="ml-1 text-xs font-normal text-mist">(you&apos;re an admin)</span>}</H>
        <ul className="space-y-3">
          {visible.map((m, i) => (
            <li key={m.id} className="flex flex-wrap items-center gap-3 rounded-xl bg-white/5 p-3">
              <Avatar name={m.name} i={members.indexOf(m)} />
              <div className="min-w-[90px] flex-1"><b>{m.name}</b><div className="text-xs text-mist">{m.is_admin ? "Admin" : "Member"} · target {m.daily_goal}/day {m.has_pin === false && <span className="text-red-300">· no PIN set</span>}</div></div>
              <input className="scout-input w-28 text-xs" inputMode="numeric" maxLength={6} placeholder="New PIN" value={pins[m.id] ?? ""} onChange={e => setPins({ ...pins, [m.id]: e.target.value.replace(/\D/g, "") })} />
              <button disabled={(pins[m.id] ?? "").length !== 6} onClick={() => { run({ member_id: m.id, pin: pins[m.id] }, `${m.name}'s PIN changed`); setPins({ ...pins, [m.id]: "" }); }} className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold disabled:opacity-40">PIN save</button>
              {me.is_admin && <>
                <input className="scout-input w-20 text-xs" type="number" min={1} max={200} placeholder={String(m.daily_goal)} value={goals[m.id] ?? ""} onChange={e => setGoals({ ...goals, [m.id]: e.target.value })} />
                <button disabled={!goals[m.id]} onClick={() => run({ member_id: m.id, daily_goal: Number(goals[m.id]) }, "Target saved")} className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold disabled:opacity-40">Target</button>
              </>}
              <span className="hidden">{i}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-mist/70">PINs have 6 digits. Never share yours.</p>
      </Card>
      {me.is_admin && (
        <Card>
          <H>➕ New member</H>
          <div className="flex flex-wrap gap-2">
            <input className="scout-input max-w-[180px] text-sm" placeholder="Name" value={newName} onChange={e => setNewName(e.target.value)} />
            <input className="scout-input w-32 text-sm" inputMode="numeric" maxLength={6} placeholder="6-digit PIN" value={newPin} onChange={e => setNewPin(e.target.value.replace(/\D/g, ""))} />
            <button disabled={!newName.trim() || newPin.length !== 6} onClick={() => { run({ add_name: newName, pin: newPin }, `${newName} joined the team`); setNewName(""); setNewPin(""); }} className="rounded-lg bg-gradient-to-r from-door-deep to-door px-4 py-2 text-sm font-black text-night disabled:opacity-40">Add</button>
          </div>
        </Card>
      )}
    </div>
  );
}
