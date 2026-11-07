"use client";

import { useMemo, useState } from "react";
import { COUNTRIES, GRADE, MANAGED_BY, MARKETS, marketById, problemById, STATUSES } from "@/lib/scout/catalog";
import { ago, Avatar, Card, CountUp, H, Ring, startOfDay, startOfWeek, type Api, type Listing, type Member } from "./ui";

const QUOTES = [
  "Har listing jo aap check karte ho, ek deal ke qareeb le jati hai. 💪",
  "10 listings roz = 300 mahine mein. Un mein se 3 bhi haan kahein to game change.",
  "Problems dhundna hi asal skill hai. Jitni zyada problems, utna strong pitch.",
  "Aaj ki mehnat kal ka passive income hai. Chalo shuru karein! 🚀",
  "Bari companies bhi ek listing se shuru hui thi.",
];
const statusOf = (id: string) => STATUSES.find(s => s.id === id) ?? STATUSES[0];
const gradeBadge = (g: string) => g === "hot" ? "bg-orange-500 text-stone-950" : g === "warm" ? "bg-amber-400/90 text-stone-950" : "bg-slate-600 text-white";

export function useStats(listings: Listing[], members: Member[]) {
  return useMemo(() => {
    const day = startOfDay(), week = startOfWeek();
    const per = members.map((m, i) => {
      const mine = listings.filter(l => l.added_by === m.id);
      return {
        ...m, i, total: mine.length,
        today: mine.filter(l => new Date(l.created_at).getTime() >= day).length,
        week: mine.filter(l => new Date(l.created_at).getTime() >= week).length,
        hot: mine.filter(l => l.grade === "hot").length,
      };
    });
    return {
      per, ranked: [...per].sort((a, b) => b.week - a.week || b.total - a.total),
      total: listings.length,
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
  const hot = listings.filter(l => ["new", "drafted"].includes(l.status)).sort((a, b) => b.score - a.score).slice(0, 6);
  const byCountry = COUNTRIES.map(c => ({ c, n: listings.filter(l => marketById(l.market)?.country === c).length })).filter(x => x.n || x.c !== "Other");
  const maxWeek = Math.max(1, ...st.per.map(p => p.week));

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="relative overflow-hidden lg:col-span-2" delay={0}>
        <div className="pointer-events-none absolute -right-10 -top-10 h-48 w-48 rounded-full bg-orange-500/20 blur-3xl" />
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
          <Ring value={mine?.today ?? 0} max={goal} size={150} stroke={12} color={left === 0 ? "#34d399" : "#f97316"}>
            <div className="text-4xl font-black tabular-nums"><CountUp value={mine?.today ?? 0} /></div>
            <div className="text-xs text-stone-400">/ {goal} aaj</div>
          </Ring>
          <div className="space-y-2">
            <h2 className="text-2xl font-black md:text-3xl">Assalam o Alaikum, <span className="scout-shine">{me.name}</span> 👋</h2>
            <p className="text-stone-300">{left === 0 ? "🎉 Aaj ka target poora! Ab garam leads ko pitch bhejo." : `Aaj ke target mein ${left} listing${left > 1 ? "s" : ""} baqi hain.`}</p>
            <p className="text-sm italic text-stone-400">{quote}</p>
            <button onClick={onAdd} className="mt-1 rounded-xl bg-gradient-to-r from-orange-500 to-amber-400 px-5 py-2.5 font-black text-stone-950 shadow-lg shadow-orange-500/25 transition hover:brightness-110 active:scale-[.98]">➕ Nayi listing add karo</button>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-3">
        {([["Total listings", st.total, "📋"], ["Garam leads", st.hot, "🔥"], ["Messages bheje", st.contacted, "✉️"], ["Deals", st.won, "🏆"]] as const).map(([l, v, e], i) => (
          <Card key={l} delay={80 + i * 60} className="!p-4">
            <div className="text-2xl">{e}</div>
            <div className="mt-1 text-3xl font-black tabular-nums"><CountUp value={v} /></div>
            <div className="text-xs text-stone-400">{l}</div>
          </Card>
        ))}
      </div>

      <Card className="lg:col-span-2" delay={200}>
        <H right={<span className="text-xs text-stone-500">Is hafte ki ranking</span>}>🏆 Team leaderboard</H>
        <ul className="space-y-3">
          {st.ranked.map((p, rank) => (
            <li key={p.id} className="scout-rise flex items-center gap-3" style={{ animationDelay: `${250 + rank * 80}ms` }}>
              <div className="w-7 text-center text-xl">{["🥇", "🥈", "🥉"][rank] ?? <span className="text-sm text-stone-500">{rank + 1}</span>}</div>
              <Avatar name={p.name} i={p.i} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <b className={p.id === me.id ? "text-orange-300" : ""}>{p.name}{p.id === me.id && " (aap)"}</b>
                  <span className="text-xs text-stone-400"><b className="text-stone-100">{p.week}</b> is hafte · {p.today} aaj · {p.total} total · {p.hot} 🔥</span>
                </div>
                <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-white/5">
                  <div className={`scout-bar h-full rounded-full bg-gradient-to-r ${rank === 0 ? "from-orange-500 to-amber-300" : "from-indigo-500 to-sky-400"}`} style={{ width: `${(p.week / maxWeek) * 100}%` }} />
                </div>
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <Card delay={260}>
        <H>🌍 Markets mein listings</H>
        <ul className="space-y-2 text-sm">
          {byCountry.map(x => (
            <li key={x.c} className="flex items-center justify-between rounded-lg bg-white/5 px-3 py-2">
              <span>{MARKETS.find(m => m.country === x.c)?.flag} {x.c}</span><b className="tabular-nums">{x.n}</b>
            </li>
          ))}
        </ul>
      </Card>

      <Card className="lg:col-span-2" delay={320}>
        <H right={<span className="text-xs text-stone-500">Jinko abhi message nahi gaya</span>}>🔥 Sab se garam leads</H>
        {!hot.length && <p className="text-sm text-stone-400">Abhi koi lead nahi. Pehli listing add karo!</p>}
        <div className="grid gap-2 sm:grid-cols-2">
          {hot.map((l, i) => (
            <button key={l.id} onClick={() => onOpen(l)} className="scout-rise flex items-center gap-3 rounded-xl border border-white/5 bg-white/5 p-3 text-left transition hover:-translate-y-0.5 hover:border-orange-400/40" style={{ animationDelay: `${360 + i * 50}ms` }}>
              <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-lg font-black ${gradeBadge(l.grade)} ${l.grade === "hot" ? "scout-glow" : ""}`}>{l.score}</div>
              <div className="min-w-0">
                <div className="truncate text-sm font-bold">{l.title || l.link}</div>
                <div className="truncate text-xs text-stone-400">{marketById(l.market)?.flag} {marketById(l.market)?.name} · {l.problem_count} problems · {nameOf(l.added_by)}</div>
              </div>
            </button>
          ))}
        </div>
      </Card>

      <Card delay={380}>
        <H>⚡ Taaza activity</H>
        <ul className="space-y-2.5 text-sm">
          {listings.slice(0, 8).map(l => (
            <li key={l.id} className="flex gap-2">
              <Avatar name={nameOf(l.added_by)} i={members.findIndex(m => m.id === l.added_by)} size={26} />
              <div className="min-w-0"><b>{nameOf(l.added_by)}</b> <span className="text-stone-400">ne add ki</span> <span className="truncate">{l.title || "listing"}</span><div className="text-xs text-stone-500">{ago(l.created_at)}</div></div>
            </li>
          ))}
          {!listings.length && <li className="text-stone-400">Abhi kuch nahi.</li>}
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

export function exportCsv(rows: Listing[], members: Member[], name = "hostly-scout") {
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

export function Sheet({ me, members, listings, onOpen, onDelete }: { me: Member; members: Member[]; listings: Listing[]; onOpen: (l: Listing) => void; onDelete: (l: Listing) => void }) {
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
    return listings.filter(l =>
      (!t || [l.title, l.host_name, l.link, l.notes].some(x => String(x ?? "").toLowerCase().includes(t))) &&
      (!country || marketById(l.market)?.country === country) && (!market || l.market === market) &&
      (!by || l.added_by === by) && (!grade || l.grade === grade) && (!status || l.status === status),
    ).sort((a, b) => sort === "score" ? b.score - a.score : +new Date(b.created_at) - +new Date(a.created_at));
  }, [listings, q, country, market, by, grade, status, sort]);
  const sel = "scout-input w-auto text-xs";

  return (
    <Card>
      <H right={<button onClick={() => exportCsv(rows, members)} className="rounded-xl bg-emerald-500 px-4 py-2 text-sm font-black text-emerald-950 transition hover:brightness-110">⬇️ Excel download ({rows.length})</button>}>📋 Sab listings ki sheet</H>
      <div className="mb-3 flex flex-wrap gap-2">
        <input className="scout-input max-w-xs text-xs" placeholder="🔍 Title, host, link…" value={q} onChange={e => setQ(e.target.value)} />
        <select className={sel} value={country} onChange={e => { setCountry(e.target.value); setMarket(""); }}><option value="">Sab mulk</option>{COUNTRIES.map(c => <option key={c}>{c}</option>)}</select>
        <select className={sel} value={market} onChange={e => setMarket(e.target.value)}><option value="">Sab markets</option>{MARKETS.filter(m => !country || m.country === country).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
        <select className={sel} value={by} onChange={e => setBy(e.target.value)}><option value="">Sab members</option>{members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
        <select className={sel} value={grade} onChange={e => setGrade(e.target.value)}><option value="">Sab leads</option>{Object.entries(GRADE).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
        <select className={sel} value={status} onChange={e => setStatus(e.target.value)}><option value="">Sab status</option>{STATUSES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}</select>
        <select className={sel} value={sort} onChange={e => setSort(e.target.value as "score" | "date")}><option value="score">Score se</option><option value="date">Naye pehle</option></select>
      </div>
      {!rows.length && <p className="py-8 text-center text-sm text-stone-400">Koi listing nahi mili.</p>}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase tracking-wider text-stone-500">
            <tr>{["Score", "Listing", "Market", "Host", "Rating", "Weekday / Weekend", "Problems", "By", "Status", ""].map(h => <th key={h} className="px-2 py-2 font-semibold">{h}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((l, i) => (
              <tr key={l.id} onClick={() => onOpen(l)} className="scout-rise cursor-pointer border-t border-white/5 transition hover:bg-white/5" style={{ animationDelay: `${Math.min(i, 20) * 25}ms` }}>
                <td className="px-2 py-2.5"><span className={`inline-flex h-9 w-9 items-center justify-center rounded-lg font-black ${gradeBadge(l.grade)}`}>{l.score}</span></td>
                <td className="max-w-[260px] px-2"><div className="truncate font-semibold">{l.title || "—"}</div><a href={l.link} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} className="truncate text-xs text-sky-300 hover:underline">{l.link.replace(/^https?:\/\/(www\.)?/, "").slice(0, 40)}</a></td>
                <td className="px-2 text-xs">{marketById(l.market)?.flag} {marketById(l.market)?.name}</td>
                <td className="px-2 text-xs">{l.host_name || "—"}{l.host_listings != null && <span className="text-stone-500"> · {l.host_listings} props</span>}</td>
                <td className="px-2 text-xs">{l.rating ?? "—"}{l.reviews != null && <span className="text-stone-500"> ({l.reviews})</span>}</td>
                <td className="px-2 text-xs tabular-nums">{l.weekday_price ?? "—"} / {l.weekend_price ?? "—"} {l.currency}</td>
                <td className="px-2 text-center font-bold">{l.problem_count}</td>
                <td className="px-2 text-xs">{nameOf(l.added_by)}</td>
                <td className="px-2"><span className={`rounded-full px-2 py-0.5 text-[11px] font-bold text-white ${statusOf(l.status).color}`}>{statusOf(l.status).label}</span></td>
                <td className="px-2 text-right">{(l.added_by === me.id || me.is_admin) && <button title="Hatao" onClick={e => { e.stopPropagation(); onDelete(l); }} className="rounded px-2 py-1 text-stone-500 hover:bg-red-500/20 hover:text-red-300">🗑</button>}</td>
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
              <div className="truncate text-xs text-stone-400">{marketById(l.market)?.name} · {l.problem_count} problems · {nameOf(l.added_by)} · {statusOf(l.status).label}</div>
            </div>
          </button>
        ))}
      </div>
    </Card>
  );
}

// ---------------- Pitches ----------------
export function Pitches({ api, members, listings, onOpen, onChanged, toast }: { api: Api; members: Member[]; listings: Listing[]; onOpen: (l: Listing) => void; onChanged: (l: Listing) => void; toast: (m: string, k?: "ok" | "err") => void }) {
  const [tab, setTab] = useState("drafted");
  const withPitch = listings.filter(l => l.pitch);
  const rows = withPitch.filter(l => l.status === tab).sort((a, b) => b.score - a.score);
  const nameOf = (id: string) => members.find(m => m.id === id)?.name ?? "?";
  const move = async (l: Listing, status: string) => {
    try { const r = await api("/api/scout/listings", { body: { id: l.id, status } }); onChanged(r.listing); toast(status === "won" ? "Mubarak ho! 🎉 Deal ho gayi" : `Status: ${statusOf(status).label}`); }
    catch (e) { toast((e as Error).message, "err"); }
  };
  return (
    <div className="space-y-4">
      <div className="flex gap-2 overflow-x-auto pb-1">
        {STATUSES.filter(s => s.id !== "new").map(s => {
          const n = withPitch.filter(l => l.status === s.id).length;
          return <button key={s.id} onClick={() => setTab(s.id)} className={`shrink-0 rounded-xl px-4 py-2 text-sm font-bold transition ${tab === s.id ? "bg-white text-stone-950" : "bg-white/5 text-stone-300 hover:bg-white/10"}`}>{s.label} <span className="ml-1 rounded-full bg-black/20 px-1.5 text-xs">{n}</span></button>;
        })}
      </div>
      {!rows.length && <Card><p className="py-6 text-center text-sm text-stone-400">Is list mein abhi kuch nahi.</p></Card>}
      <div className="grid gap-4 lg:grid-cols-2">
        {rows.map((l, i) => (
          <Card key={l.id} delay={i * 50}>
            <div className="mb-2 flex items-start justify-between gap-2">
              <div className="min-w-0">
                <button onClick={() => onOpen(l)} className="truncate text-left font-bold hover:underline">{l.title || l.link}</button>
                <div className="text-xs text-stone-400">{l.host_name || "Host"} · {marketById(l.market)?.name} · {nameOf(l.added_by)} {l.contact && <>· <span className="text-sky-300">{l.contact}</span></>}</div>
              </div>
              <span className={`shrink-0 rounded-lg px-2 py-1 text-sm font-black ${gradeBadge(l.grade)}`}>{l.score}</span>
            </div>
            <div className="mb-1 text-sm font-semibold text-stone-200">{l.pitch_subject}</div>
            <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-xl bg-black/30 p-3 font-sans text-xs leading-relaxed text-stone-300">{l.pitch}</pre>
            <div className="mt-3 flex flex-wrap gap-2">
              <button onClick={async () => { try { await navigator.clipboard.writeText(`${l.pitch_subject}\n\n${l.pitch}`); toast("Copy ho gaya 📋"); } catch { toast("Copy nahi hua", "err"); } }} className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold hover:bg-white/15">📋 Copy</button>
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
          <h2 className="scout-rise mb-3 text-xl font-black" style={{ animationDelay: `${ci * 80}ms` }}>{MARKETS.find(m => m.country === c)?.flag} {c === "Europe" ? "Baaqi Europe" : c}</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {MARKETS.filter(m => m.country === c).map((m, i) => {
              const n = listings.filter(l => l.market === m.id).length;
              return (
                <Card key={m.id} delay={ci * 80 + i * 50} className="flex flex-col !p-4 transition hover:-translate-y-1">
                  <div className="flex items-start justify-between gap-2"><h3 className="font-extrabold">{m.flag} {m.name}</h3><span className="rounded-full bg-white/10 px-2 py-0.5 text-xs font-bold">{n}</span></div>
                  <p className="mt-1 text-xs text-stone-400">{m.areas}</p>
                  <p className="mt-2 text-xs text-stone-300">{m.note}</p>
                  <p className="mt-2 text-xs text-amber-300/90">📜 {m.licence}</p>
                  <div className="mt-auto flex gap-2 pt-3">
                    <a className="rounded-lg bg-white/10 px-2.5 py-1 text-xs font-semibold hover:bg-white/20" target="_blank" rel="noreferrer" href={`https://www.airbnb.com/s/${encodeURIComponent(m.areas.split(",")[0] + ", " + m.name.replace(/ \(.*\)$/, ""))}/homes`}>Airbnb pe dhundo ↗</a>
                    <span className="self-center text-xs text-stone-500">{m.currency}</span>
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
  { t: "Roz ka routine (45 minute)", e: "⏰", body: <ol className="list-decimal space-y-1 pl-5"><li>Dashboard kholo, apna target dekho (10 listings).</li><li>Markets page se apna market chuno, &quot;Airbnb pe dhundo&quot; dabao.</li><li>Har listing ko 3-4 minute do: data bharo, problems tick karo, save.</li><li>Din ke akhir mein 🔥 garam leads ka pitch copy karke bhejo.</li><li>Pitches page pe status update karo: Message bheja, Jawab aaya, Call booked.</li></ol> },
  { t: "Kaun si listing uthani hai", e: "🎯", body: <ul className="list-disc space-y-1 pl-5"><li>Host ki 1-5 listings hon (badi companies nahi).</li><li>Rating 4.8 se kam, ya reviews kam, ya photos kamzor.</li><li>Calendar khaali dikhe jab baaqi area bhara ho.</li><li>Host khud manage kar raha ho (messages personal hon, &quot;Co-host&quot; na likha ho).</li><li>Spain / Portugal / Greece mein licence number zaroor check karo. Licence nahi to pitch mat karo.</li></ul> },
  { t: "Har cheez kahan milegi", e: "🔎", body: <div className="overflow-x-auto"><table className="w-full text-left text-xs"><tbody>{[
    ["Name of host", "Listing pe neeche \"Hosted by …\""], ["Number of properties", "Host ke naam pe click → profile pe \"Listings\""], ["Property type / BHK", "Title ke neeche: \"2 bedrooms · 3 beds\""],
    ["Rating aur reviews", "Title ke paas ⭐ 4.72 · 38 reviews"], ["Weekday / Weekend price", "Calendar mein ek Tuesday aur ek Saturday chuno, price note karo"], ["Minimum nights", "Calendar mein \"2 night minimum\""],
    ["No of photos", "\"Show all photos\" dabao aur gino"], ["Response rate", "Host profile pe \"Response rate: 90%\""], ["Self ya co-host", "\"Co-hosts\" section dekho; host ki baaqi listings ke naam"],
    ["Licence", "Description ke neeche \"Registration number\" / \"Licence\""],
  ].map(([a, b]) => <tr key={a} className="border-t border-white/5"><td className="py-1.5 pr-3 font-bold">{a}</td><td className="py-1.5 text-stone-300">{b}</td></tr>)}</tbody></table></div> },
  { t: "Score ka matlab", e: "📈", body: <div className="grid gap-2 sm:grid-cols-3">{Object.values(GRADE).map((g, i) => <div key={g.label} className="rounded-xl bg-white/5 p-3"><b>{g.label}</b><div className="text-xs text-stone-400">{["Score 60+. Owner paisa kho raha hai. Aaj message karo, 2 din baad follow-up.", "Score 35-59. Kaafi problems. Personal message aur free offer.", "Score 35 se kam. Listing theek chal rahi. Short message, zyada time nahi."][i]}</div></div>)}<p className="text-xs text-stone-400 sm:col-span-3">⚡ wali problems numbers se khud lagti hain (jaise rating 4.7 se kam). Baaqi aap tick karte ho. Har problem ke points hain; total points se score banta hai.</p></div> },
  { t: "Pitch kaise bhejna hai", e: "✉️", body: <ul className="list-disc space-y-1 pl-5"><li><b>Airbnb / Vrbo inbox mein kabhi pitch mat karo.</b> Account band ho sakta hai.</li><li>Facebook, host ki website, email, ya LinkedIn se contact karo. Contact wale khane mein likh do.</li><li>Draft ko zaroor parho aur 1 line apni taraf se likho (unki listing ki koi achhi baat).</li><li>Sirf 2-3 problems likho, sab nahi. Tone dosti wala, criticism wala nahi.</li><li>Jawab na aaye to 3 din baad ek chhota follow-up. Phir ruk jao.</li><li>UK / Europe mein email ke neeche &quot;Reply STOP if you&apos;d rather not hear from me&quot; likho.</li></ul> },
  { t: "Kya nahi karna", e: "🚫", body: <ul className="list-disc space-y-1 pl-5"><li>Ek hi listing do dafa mat dalo. Tool khud rok dega, link pehle paste karo.</li><li>Jhoote numbers ya &quot;guarantee&quot; mat likho.</li><li>Barcelona, Palma, Ibiza, central London, Vienna residential zones: yahan short-term mat pitch karo.</li><li>Ek generic message sab ko mat bhejo.</li></ul> },
  { t: "Data kahan save hota hai", e: "🔒", body: <p>Sab data Hostly ke online database mein save hota hai, aapke phone ya laptop pe nahi. Delete karne pe listing sirf chhup jati hai, database se mitti nahi. Sheet page pe &quot;Excel download&quot; se kabhi bhi poori sheet nikal sakte ho.</p> },
];

export function Guide() {
  const [open, setOpen] = useState(0);
  return (
    <div className="mx-auto max-w-3xl space-y-3">
      <Card className="text-center"><div className="scout-float text-5xl">📘</div><h2 className="mt-2 text-2xl font-black">Hostly Scout guide</h2><p className="text-sm text-stone-400">Listing research se pitch tak, step by step.</p></Card>
      {GUIDE.map((g, i) => (
        <Card key={g.t} delay={i * 50} className="!p-0">
          <button onClick={() => setOpen(open === i ? -1 : i)} className="flex w-full items-center gap-3 p-4 text-left">
            <span className="text-2xl">{g.e}</span><b className="flex-1">{i + 1}. {g.t}</b>
            <span className={`transition-transform duration-300 ${open === i ? "rotate-180" : ""}`}>⌄</span>
          </button>
          <div className={`grid transition-all duration-300 ${open === i ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}>
            <div className="overflow-hidden"><div className="px-4 pb-4 text-sm text-stone-200">{g.body}</div></div>
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
        <H>👥 Team {me.is_admin && <span className="ml-1 text-xs font-normal text-stone-400">(aap admin ho)</span>}</H>
        <ul className="space-y-3">
          {visible.map((m, i) => (
            <li key={m.id} className="flex flex-wrap items-center gap-3 rounded-xl bg-white/5 p-3">
              <Avatar name={m.name} i={members.indexOf(m)} />
              <div className="min-w-[90px] flex-1"><b>{m.name}</b><div className="text-xs text-stone-400">{m.is_admin ? "Admin" : "Member"} · target {m.daily_goal}/din {m.has_pin === false && <span className="text-red-300">· PIN set nahi</span>}</div></div>
              <input className="scout-input w-28 text-xs" inputMode="numeric" maxLength={6} placeholder="Naya PIN" value={pins[m.id] ?? ""} onChange={e => setPins({ ...pins, [m.id]: e.target.value.replace(/\D/g, "") })} />
              <button disabled={(pins[m.id] ?? "").length !== 6} onClick={() => { run({ member_id: m.id, pin: pins[m.id] }, `${m.name} ka PIN badal gaya`); setPins({ ...pins, [m.id]: "" }); }} className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold disabled:opacity-40">PIN save</button>
              {me.is_admin && <>
                <input className="scout-input w-20 text-xs" type="number" min={1} max={200} placeholder={String(m.daily_goal)} value={goals[m.id] ?? ""} onChange={e => setGoals({ ...goals, [m.id]: e.target.value })} />
                <button disabled={!goals[m.id]} onClick={() => run({ member_id: m.id, daily_goal: Number(goals[m.id]) }, "Target save ho gaya")} className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold disabled:opacity-40">Target</button>
              </>}
              <span className="hidden">{i}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-stone-500">PIN 6 digits ka hota hai. Kisi ko apna PIN mat batao.</p>
      </Card>
      {me.is_admin && (
        <Card>
          <H>➕ Naya member</H>
          <div className="flex flex-wrap gap-2">
            <input className="scout-input max-w-[180px] text-sm" placeholder="Naam" value={newName} onChange={e => setNewName(e.target.value)} />
            <input className="scout-input w-32 text-sm" inputMode="numeric" maxLength={6} placeholder="6-digit PIN" value={newPin} onChange={e => setNewPin(e.target.value.replace(/\D/g, ""))} />
            <button disabled={!newName.trim() || newPin.length !== 6} onClick={() => { run({ add_name: newName, pin: newPin }, `${newName} team mein aa gaya`); setNewName(""); setNewPin(""); }} className="rounded-lg bg-gradient-to-r from-orange-500 to-amber-400 px-4 py-2 text-sm font-black text-stone-950 disabled:opacity-40">Add karo</button>
          </div>
        </Card>
      )}
    </div>
  );
}
