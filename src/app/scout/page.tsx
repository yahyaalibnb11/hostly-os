"use client";

import { useCallback, useEffect, useState } from "react";
import { AdminLeads, Watermark } from "./admin";
import { ListingForm } from "./form";
import { Dashboard, Guide, Markets, Pitches, Sheet, Team } from "./pages";
import { Avatar, Logo, Toast, useConfetti, type Listing, type Member } from "./ui";

// Hostly Scout: the team's listing research tool. Sign in with your name and a 6-digit PIN,
// add listings, see the score, draft the pitch, and watch the team leaderboard.

const PASS_KEY = "hostly-scout-pass";
const getPass = () => { try { return localStorage.getItem(PASS_KEY); } catch { return null; } };
const setPass = (v: string | null) => { try { if (v) localStorage.setItem(PASS_KEY, v); else localStorage.removeItem(PASS_KEY); } catch { /* private mode */ } };

const TABS = [
  ["home", "🏠", "Dashboard"], ["add", "➕", "New listing"], ["sheet", "📋", "Sheet"], ["leads", "🎯", "Leads"], ["pitches", "✉️", "Pitches"],
  ["markets", "🌍", "Markets"], ["guide", "📘", "Guide"], ["team", "👥", "Team"],
] as const;
type Tab = typeof TABS[number][0];

export default function ScoutPage() {
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [data, setData] = useState<{ me: Member; members: Member[]; listings: Listing[]; ai: boolean } | null>(null);
  const [tab, setTab] = useState<Tab>("home");
  const [editing, setEditing] = useState<Listing | null>(null);
  const [toastMsg, setToastMsg] = useState<{ m: string; k: "ok" | "err" } | null>(null);
  const confetti = useConfetti();
  const toast = useCallback((m: string, k: "ok" | "err" = "ok") => setToastMsg({ m, k }), []);

  useEffect(() => { setToken(getPass()); setReady(true); }, []);

  const api = useCallback(async (path: string, opts: { body?: unknown; method?: string } = {}) => {
    const r = await fetch(path, { method: opts.method ?? (opts.body ? "POST" : "GET"), headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: opts.body ? JSON.stringify(opts.body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) { setPass(null); setToken(null); }
    if (!r.ok) throw new Error(j.error || `Error ${r.status}`);
    return j;
  }, [token]);

  const load = useCallback(async () => {
    if (!token) return;
    try { setData(await api("/api/scout/data")); } catch (e) { toast((e as Error).message, "err"); }
  }, [api, token, toast]);

  useEffect(() => {
    if (!token) return;
    load();
    const t = setInterval(load, 45000); // teammates' new listings show up without a refresh
    return () => clearInterval(t);
  }, [load, token]);

  const go = (t: Tab) => { setTab(t); if (t !== "add") setEditing(null); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const open = (l: Listing) => { setEditing(l); setTab("add"); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const upsert = (l: Listing) => setData(d => d && ({ ...d, listings: d.listings.some(x => x.id === l.id) ? d.listings.map(x => x.id === l.id ? l : x) : [l, ...d.listings] }));

  if (!ready) return <main className="scout-bg" />;
  if (!token) return <SignIn onIn={t => { setPass(t); setToken(t); }} />;
  if (!data) return <main className="scout-bg flex items-center justify-center"><Logo size={64} className="scout-float" /></main>;

  const { me, members, listings, ai } = data;
  const tabs = TABS.filter(t => t[0] !== "leads" || me.is_admin);
  // Students can't select, copy, right-click or print the leads; Yahya can.
  const guard = (e: React.SyntheticEvent) => { if (!me.is_admin && !(e.target as HTMLElement).closest?.("input, textarea")) e.preventDefault(); };
  const myToday = listings.filter(l => l.added_by === me.id && new Date(l.created_at).toDateString() === new Date().toDateString()).length;

  return (
    <main className={`scout-bg pb-24 md:pb-10 ${me.is_admin ? "" : "scout-locked"}`} onCopy={guard} onCut={guard} onContextMenu={guard} onDragStart={guard}>
      {!me.is_admin && <Watermark name={me.name} />}
      <div className="mx-auto max-w-7xl px-4 py-4 md:px-6">
        <header className="mb-5 flex items-center justify-between gap-3">
          <button onClick={() => go("home")} className="flex items-center gap-2.5 text-left">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-hairline bg-night"><Logo size={30} /></div>
            <div><div className="scout-display text-xl font-extrabold leading-none">hostly<span className="text-door">.</span> <span className="font-mono text-[11px] font-medium uppercase tracking-[.2em] text-door">Scout</span></div><div className="mt-0.5 text-[11px] text-mist">Listing research · outreach</div></div>
          </button>
          <div className="flex items-center gap-2">
            <span className="hidden rounded-full bg-white/5 px-3 py-1 text-xs text-bone/80 sm:inline">Today: <b>{myToday}</b>/{me.daily_goal}</span>
            <Avatar name={me.name} i={members.findIndex(m => m.id === me.id)} size={34} />
            <button onClick={() => { setPass(null); setToken(null); setData(null); }} className="rounded-full bg-white/5 px-3 py-1.5 text-xs text-bone/80 hover:bg-white/10">Sign out</button>
          </div>
        </header>

        <nav className="mb-5 hidden gap-1.5 md:flex">
          {tabs.map(([k, e, l]) => (
            <button key={k} onClick={() => go(k)} className={`relative rounded-xl px-4 py-2 text-sm font-bold transition ${tab === k ? "bg-white text-night shadow-lg" : "text-bone/80 hover:bg-white/5"}`}>{e} {k === "add" && editing ? "Edit listing" : l}</button>
          ))}
        </nav>

        <div key={tab + (editing?.id ?? "")}>
          {tab === "home" && <Dashboard me={me} members={members} listings={listings} onOpen={open} onAdd={() => go("add")} />}
          {tab === "add" && <ListingForm api={api} me={me} members={members} editing={editing} ai={ai} toast={toast} onCancel={() => go("sheet")}
            onSaved={(l, isNew) => {
              upsert(l);
              if (isNew) {
                const n = myToday + 1;
                confetti(n === me.daily_goal || l.grade === "hot");
                toast(n === me.daily_goal ? `🎉 Daily target hit! ${n} listings` : l.grade === "hot" ? `🔥 Hot lead! Score ${l.score}. Listing #${n} today` : `✅ Saved! Listing #${n} today`);
              } else { toast("💾 Changes saved"); if (l.status === "won") confetti(true); go("sheet"); }
            }} />}
          {tab === "sheet" && <Sheet me={me} members={members} listings={listings} onOpen={open} onDelete={async l => {
            if (!confirm(`Remove "${l.title || l.link}" from the sheet? (It stays safe in the database.)`)) return;
            try { await api(`/api/scout/listings?id=${l.id}`, { method: "DELETE" }); setData(d => d && ({ ...d, listings: d.listings.filter(x => x.id !== l.id) })); toast("Listing removed"); } catch (e) { toast((e as Error).message, "err"); }
          }} />}
          {tab === "leads" && me.is_admin && <AdminLeads members={members} listings={listings} onOpen={open} />}
          {tab === "pitches" && <Pitches api={api} members={members} listings={listings} onOpen={open} toast={toast} onChanged={l => { upsert(l); if (l.status === "won") confetti(true); }} />}
          {tab === "markets" && <Markets listings={listings} />}
          {tab === "guide" && <Guide />}
          {tab === "team" && <Team api={api} me={me} members={members} reload={load} toast={toast} />}
        </div>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-30 flex justify-around border-t border-white/10 bg-night/90 px-1 py-1.5 backdrop-blur md:hidden">
        {tabs.filter(t => t[0] !== "team" && (t[0] !== "markets" || !me.is_admin)).map(([k, e, l]) => (
          <button key={k} onClick={() => go(k)} className={`flex flex-col items-center rounded-lg px-2 py-1 text-[10px] font-semibold ${tab === k ? "text-door" : "text-mist"}`}>
            <span className={`text-lg transition-transform ${tab === k ? "scale-125" : ""}`}>{e}</span>{l.split(" ").pop()}
          </button>
        ))}
      </nav>
      {toastMsg && <Toast msg={toastMsg.m} kind={toastMsg.k} onDone={() => setToastMsg(null)} />}
    </main>
  );
}

function SignIn({ onIn }: { onIn: (token: string) => void }) {
  const [names, setNames] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(0);
  useEffect(() => { fetch("/api/scout/members").then(r => r.json()).then(j => j.names ? setNames(j.names) : setMsg(j.error || "Can't reach the server")).catch(() => setMsg("Can't reach the server")); }, []);
  const submit = async (p = pin) => {
    if (!name || p.length !== 6) return;
    setBusy(true); setMsg("");
    try {
      const r = await fetch("/api/scout/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, pin: p }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Sign-in failed");
      onIn(j.token);
    } catch (e) { setMsg((e as Error).message); setPin(""); setShake(s => s + 1); } finally { setBusy(false); }
  };
  return (
    <main className="scout-bg flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="scout-rise mb-6 text-center">
          <div className="relative mx-auto mb-3 w-fit"><div className="absolute inset-x-0 bottom-0 h-10 rounded-full bg-door/30 blur-2xl" /><Logo size={84} className="scout-float relative" /></div>
          <h1 className="text-4xl font-extrabold">hostly<span className="text-door">.</span> <span className="scout-shine">Scout</span></h1>
          <p className="mt-1 text-sm text-mist">Find listings. Spot the problems. Close the deals.</p>
        </div>
        <div className="scout-card scout-rise p-5" style={{ animationDelay: "120ms" }}>
          <p className="mb-3 text-sm font-bold text-bone/80">1. Pick your name</p>
          <div className="mb-5 grid grid-cols-2 gap-2">
            {names.map((n, i) => (
              <button key={n} onClick={() => { setName(n); setMsg(""); }} className={`flex items-center gap-2 rounded-xl border p-3 text-left font-bold transition ${name === n ? "scale-[1.03] border-door bg-door/15" : "border-white/10 bg-white/5 hover:border-white/30"}`}>
                <Avatar name={n} i={i} size={30} />{n}
              </button>
            ))}
          </div>
          <p className="mb-3 text-sm font-bold text-bone/80">2. Your 6-digit PIN</p>
          <div key={shake} className={shake ? "scout-shake" : ""}>
            <input autoComplete="one-time-code" inputMode="numeric" type="password" maxLength={6} disabled={!name || busy} value={pin} placeholder={name ? "• • • • • •" : "Pick your name first"}
              onChange={e => { const v = e.target.value.replace(/\D/g, "").slice(0, 6); setPin(v); if (v.length === 6) submit(v); }}
              className="scout-input text-center text-2xl tracking-[.6em]" />
          </div>
          <button disabled={!name || pin.length !== 6 || busy} onClick={() => submit()} className="mt-4 w-full rounded-xl bg-gradient-to-r from-door-deep to-door py-3 font-black text-night shadow-lg shadow-door/25 disabled:opacity-40">{busy ? "Checking…" : "Sign in 🚀"}</button>
          {msg && <p className="scout-pop mt-3 text-center text-sm text-red-300">{msg}</p>}
        </div>
        <p className="mt-4 text-center text-xs text-mist/70">Forgot your PIN? Ask Yahya for a new one.</p>
      </div>
    </main>
  );
}
