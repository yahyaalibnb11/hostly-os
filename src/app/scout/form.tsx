"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { autoProblems, buildPitch, COUNTRIES, GRADE, linkKey, MANAGED_BY, MARKETS, marketById, OFFERS, PROBLEM_GROUPS, PROBLEMS, PROPERTY_TYPES, scoreListing, solutionsText, STATUSES } from "@/lib/scout/catalog";
import { ContactFinder, ScreenshotScanner, type ScanResult } from "./scanner";
import { Card, Ring, type Api, type Listing, type Member } from "./ui";

// Add or edit one listing. The score, problem count, solutions and pitch all update live while typing.

/* eslint-disable @typescript-eslint/no-explicit-any */
const NUM_FIELDS = ["host_listings", "rating", "reviews", "weekday_price", "weekend_price", "min_nights", "photos", "response_rate"];
const BLANK: Record<string, any> = {
  link: "", market: "", host_name: "", host_listings: "", property_type: "", title: "", rating: "", reviews: "", currency: "",
  weekday_price: "", weekend_price: "", min_nights: "", photos: "", response_rate: "", managed_by: "unknown", licence_number: "",
  contact: "", custom_problems: "", solutions: "", pitch_subject: "", pitch: "", notes: "", status: "new",
};

function Field({ label, hint, children, wide }: { label: string; hint?: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <label className={`flex flex-col gap-1 ${wide ? "sm:col-span-2" : ""}`}>
      <span className="text-xs font-bold text-bone/80">{label}{hint && <span className="ml-1 font-normal text-mist/70">· {hint}</span>}</span>
      {children}
    </label>
  );
}

function Step({ n, title, sub, children, delay }: { n: number; title: string; sub: string; children: React.ReactNode; delay: number }) {
  return (
    <Card delay={delay}>
      <div className="mb-4 flex items-start gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-door-deep to-door text-sm font-black text-night">{n}</div>
        <div><h3 className="font-extrabold">{title}</h3><p className="text-xs text-mist">{sub}</p></div>
      </div>
      {children}
    </Card>
  );
}

export function ListingForm({ api, me, members, editing, ai, onSaved, onCancel, toast }: {
  api: Api; me: Member; members: Member[]; editing: Listing | null; ai: boolean;
  onSaved: (l: Listing, isNew: boolean) => void; onCancel: () => void; toast: (m: string, k?: "ok" | "err") => void;
}) {
  const [f, setF] = useState<Record<string, any>>(() => editing ? { ...BLANK, ...Object.fromEntries(Object.entries(editing).map(([k, v]) => [k, v ?? ""])) } : { ...BLANK });
  const [picked, setPicked] = useState<string[]>(() => ((editing?.problems as string[]) ?? []).filter(id => !PROBLEMS.find(p => p.id === id)?.auto));
  const [solTouched, setSolTouched] = useState(Boolean(editing?.solutions));
  const [pitchTouched, setPitchTouched] = useState(Boolean(editing?.pitch));
  const [offer, setOffer] = useState(OFFERS[0]);
  const [dup, setDup] = useState<{ by: string; at: string; title: string } | null>(null);
  const [shake, setShake] = useState(0);
  const [busy, setBusy] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const canEdit = !editing || editing.added_by === me.id || me.is_admin;
  const owner = editing ? members.find(m => m.id === editing.added_by)?.name : me.name;
  const set = (k: string, v: any) => setF(p => ({ ...p, [k]: v }));
  const nums = useMemo(() => Object.fromEntries(NUM_FIELDS.map(k => [k, f[k] === "" ? null : Number(f[k])])), [f]);
  const input = { ...nums, managed_by: f.managed_by, market: f.market, licence_number: f.licence_number };
  const auto = useMemo(() => autoProblems(input), [JSON.stringify(input)]); // eslint-disable-line react-hooks/exhaustive-deps
  const customCount = String(f.custom_problems).split("\n").filter(s => s.trim()).length;
  const s = scoreListing(input, picked, customCount);
  const g = GRADE[s.grade];
  const market = marketById(f.market);

  // Live duplicate check while the link is typed.
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    const key = linkKey(f.link || "");
    if (!key || (editing && key === editing.link_key)) { setDup(null); return; }
    timer.current = setTimeout(async () => {
      try {
        const r = await api(`/api/scout/check?link=${encodeURIComponent(f.link)}`);
        if (r.duplicate) { setDup(r.duplicate); setShake(x => x + 1); } else setDup(null);
      } catch { /* checked again on save */ }
    }, 400);
  }, [f.link, api, editing]);

  // Solutions and pitch follow the problems until the student edits them by hand.
  useEffect(() => { if (!solTouched) set("solutions", solutionsText(s.ids, f.custom_problems)); }, [s.ids.join(), f.custom_problems, solTouched]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (pitchTouched) return;
    const p = buildPitch({ host_name: f.host_name, title: f.title, market: f.market, problems: s.ids, custom_problems: f.custom_problems, offer, sender: `${owner ?? me.name}, Hostly` });
    setF(prev => ({ ...prev, pitch: p.body, pitch_subject: p.subject }));
  }, [s.ids.join(), f.custom_problems, f.host_name, f.title, f.market, offer, pitchTouched]); // eslint-disable-line react-hooks/exhaustive-deps

  const [area, setArea] = useState("");
  const [insights, setInsights] = useState<string[]>([]); // host facts from the scan, used by the AI contact search
  const [scanKey, setScanKey] = useState(0); // a new key empties the scanner after each save

  // Put what the AI read from the screenshots into the form. The student checks it before saving.
  const applyScan = (r: ScanResult) => {
    const has = (v: unknown) => v !== null && v !== undefined && v !== "";
    setF(p => {
      const n = { ...p };
      for (const k of [...NUM_FIELDS, "host_name", "title", "property_type", "licence_number", "currency"]) if (has(r[k])) n[k] = r[k];
      if (has(r.market)) n.market = r.market;
      if (r.managed_by && r.managed_by !== "unknown") n.managed_by = r.managed_by;
      if (!p.link && r.platform === "airbnb" && /^\d{5,}$/.test(String(r.listing_id ?? ""))) n.link = `https://www.airbnb.com/rooms/${r.listing_id}`;
      if (!n.currency && n.market) n.currency = marketById(n.market)?.currency ?? "";
      const extra = (r.other_problems ?? []).filter((x: string) => x && !String(p.custom_problems).includes(x));
      if (extra.length) n.custom_problems = [String(p.custom_problems).trim(), ...extra].filter(Boolean).join("\n");
      const notes = [
        r.host_insights?.length ? `Host: ${r.host_insights.join("; ")}` : "",
        r.review_complaints?.length ? `Guest complaints: ${r.review_complaints.join("; ")}` : "",
        r.review_praise?.length ? `Guests like: ${r.review_praise.join("; ")}` : "",
        r.photo_quality ? `Photos: ${r.photo_quality}` : "",
      ].filter(Boolean).join(" | ");
      if (notes && !String(p.notes).includes(notes)) n.notes = [String(p.notes).trim(), notes].filter(Boolean).join(" | ");
      return n;
    });
    if (Array.isArray(r.problems)) setPicked(p => Array.from(new Set([...p, ...r.problems.filter((id: string) => PROBLEMS.some(x => x.id === id && !x.auto))])));
    if (r.city_or_area) setArea(r.city_or_area);
    if (Array.isArray(r.host_insights)) setInsights(r.host_insights);
  };

  const toggle = (id: string) => setPicked(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);

  const save = async () => {
    if (!canEdit) return;
    if (!linkKey(f.link)) { toast("Paste the full listing link (Airbnb / Vrbo / Booking)", "err"); setShake(x => x + 1); return; }
    if (!f.market) { toast("Pick a market", "err"); return; }
    if (dup) { toast(`${dup.by} already added this listing`, "err"); setShake(x => x + 1); return; }
    setBusy("save");
    try {
      const body: Record<string, any> = { ...f, problems: picked.filter(id => !auto.includes(id)) };
      if (editing) body.id = editing.id;
      if (body.pitch && body.status === "new") body.status = "drafted";
      delete body.link_key; delete body.added_by; delete body.created_at; delete body.updated_at; delete body.score; delete body.grade; delete body.problem_count;
      const r = await api("/api/scout/listings", { body });
      onSaved(r.listing, !editing);
      if (!editing) { setF({ ...BLANK, market: f.market }); setPicked([]); setSolTouched(false); setPitchTouched(false); setArea(""); setInsights([]); setScanKey(k => k + 1); }
    } catch (e) { toast((e as Error).message, "err"); } finally { setBusy(""); }
  };

  const aiPitch = async () => {
    setBusy("ai");
    try {
      const r = await api("/api/scout/pitch", { body: { host_name: f.host_name, title: f.title, market: f.market, property_type: f.property_type, problems: s.ids, custom_problems: f.custom_problems, offer } });
      setF(p => ({ ...p, pitch: r.body, pitch_subject: r.subject })); setPitchTouched(true);
      toast("AI wrote a new draft ✨");
    } catch (e) { toast((e as Error).message, "err"); } finally { setBusy(""); }
  };

  const copy = async () => {
    try { await navigator.clipboard.writeText(`${f.pitch_subject}\n\n${f.pitch}`); toast("Copied. Now paste it into Facebook / email 📋"); }
    catch { toast("Couldn't copy. Select the text and copy it", "err"); }
  };

  const inp = "scout-input text-sm";
  const ro = !canEdit;

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
      <div className="space-y-4">
        {editing && <p className="scout-rise text-sm text-mist">Edit: <b className="text-bone">{editing.title || editing.link}</b> · added by {owner}{ro && " · you can only change status, pitch, contact and notes"}</p>}

        {!ro && !editing && <ScreenshotScanner key={scanKey} api={api} ai={ai} onResult={applyScan} toast={toast} />}

        <Step n={1} title="Listing link and market" sub="The link tells us if someone already added this listing" delay={0}>
          <div key={shake} className={`grid gap-3 sm:grid-cols-2 ${shake ? "scout-shake" : ""}`}>
            <Field label="Listing link" hint="Airbnb / Vrbo / Booking" wide>
              <input className={`${inp} ${dup ? "!border-red-500" : linkKey(f.link) ? "!border-emerald-500/60" : ""}`} placeholder="https://www.airbnb.com/rooms/12345678" value={f.link} disabled={ro} onChange={e => set("link", e.target.value)} />
            </Field>
            {dup && <div className="scout-pop rounded-xl border border-red-500/50 bg-red-500/10 p-3 text-sm sm:col-span-2">⛔ <b>{dup.by}</b> already added this listing on {new Date(dup.at).toLocaleDateString()}{dup.title ? ` (“${dup.title}”)` : ""}. Find another one.</div>}
            {!dup && linkKey(f.link) && !editing && <div className="scout-pop text-xs text-emerald-400 sm:col-span-2">✓ New listing, carry on</div>}
            <Field label="Market" wide>
              <select className={inp} value={f.market} disabled={ro} onChange={e => { set("market", e.target.value); if (!f.currency) set("currency", marketById(e.target.value)?.currency ?? ""); }}>
                <option value="">Pick a market…</option>
                {COUNTRIES.map(c => <optgroup key={c} label={c}>{MARKETS.filter(m => m.country === c).map(m => <option key={m.id} value={m.id}>{m.flag} {m.name} · {m.areas}</option>)}</optgroup>)}
              </select>
            </Field>
            {market && market.id !== "other" && <p className="text-xs text-door-hi/90 sm:col-span-2">📜 {market.licence}</p>}
          </div>
        </Step>

        <Step n={2} title="Host details" sub="Open the host profile: name, number of listings, self-managed or company" delay={60}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name of host"><input className={inp} placeholder="Sarah" value={f.host_name} disabled={ro} onChange={e => set("host_name", e.target.value)} /></Field>
            <Field label="Number of properties" hint="how many listings the host has"><input className={inp} type="number" min={0} value={f.host_listings} disabled={ro} onChange={e => set("host_listings", e.target.value)} /></Field>
            <Field label="Managing by" hint="self or co-host">
              <select className={inp} value={f.managed_by} disabled={ro} onChange={e => set("managed_by", e.target.value)}>{MANAGED_BY.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}</select>
            </Field>
            <Field label="Contact" hint="Facebook / email / website"><input className={inp} placeholder="facebook.com/… or email" value={f.contact} onChange={e => set("contact", e.target.value)} /></Field>
            <div className="sm:col-span-2"><ContactFinder key={scanKey} host={f.host_name} title={f.title} market={f.market} area={area} licence={f.licence_number}
              listings={f.host_listings} managedBy={f.managed_by} insights={insights} link={f.link} api={api} ai={ai} toast={toast}
              onUse={(c, n) => setF(p => ({ ...p, contact: c && !String(p.contact).includes(c) ? [String(p.contact).trim(), c].filter(Boolean).join(" , ") : p.contact, notes: n && !String(p.notes).includes(n) ? [String(p.notes).trim(), n].filter(Boolean).join(" | ") : p.notes }))} /></div>
          </div>
        </Step>

        <Step n={3} title="Listing details" sub="Copy straight from the listing page" delay={120}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Listing title" wide><input className={inp} placeholder="Sea view 2BR with pool, 5 min to beach" value={f.title} disabled={ro} onChange={e => set("title", e.target.value)} /></Field>
            <Field label="Property type">
              <select className={inp} value={f.property_type} disabled={ro} onChange={e => set("property_type", e.target.value)}><option value="">Choose…</option>{PROPERTY_TYPES.map(t => <option key={t}>{t}</option>)}</select>
            </Field>
            <Field label="Rating" hint="0 – 5"><input className={inp} type="number" step="0.01" min={0} max={5} placeholder="4.62" value={f.rating} disabled={ro} onChange={e => set("rating", e.target.value)} /></Field>
            <Field label="Number of reviews"><input className={inp} type="number" min={0} value={f.reviews} disabled={ro} onChange={e => set("reviews", e.target.value)} /></Field>
            <Field label="No. of photos"><input className={inp} type="number" min={0} value={f.photos} disabled={ro} onChange={e => set("photos", e.target.value)} /></Field>
            <Field label="Response rate %" hint="on the host profile"><input className={inp} type="number" min={0} max={100} placeholder="85" value={f.response_rate} disabled={ro} onChange={e => set("response_rate", e.target.value)} /></Field>
            <Field label="Licence number" hint="VUT / VFT / AL…"><input className={inp} placeholder="If shown on the listing" value={f.licence_number} disabled={ro} onChange={e => set("licence_number", e.target.value)} /></Field>
          </div>
        </Step>

        <Step n={4} title="Price and nights" sub="In the calendar, check one weekday (Tue) and one weekend night (Sat)" delay={180}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Field label="Currency"><select className={inp} value={f.currency || market?.currency || "EUR"} disabled={ro} onChange={e => set("currency", e.target.value)}>{["GBP", "EUR", "USD", "PLN", "CZK"].map(c => <option key={c}>{c}</option>)}</select></Field>
            <Field label="Weekday price"><input className={inp} type="number" min={0} value={f.weekday_price} disabled={ro} onChange={e => set("weekday_price", e.target.value)} /></Field>
            <Field label="Weekend price"><input className={inp} type="number" min={0} value={f.weekend_price} disabled={ro} onChange={e => set("weekend_price", e.target.value)} /></Field>
            <Field label="Minimum nights"><input className={inp} type="number" min={0} value={f.min_nights} disabled={ro} onChange={e => set("min_nights", e.target.value)} /></Field>
          </div>
        </Step>

        <Step n={5} title="Spot the problems" sub="Every problem is a pitch point. ⚡ ones are ticked automatically from the numbers." delay={240}>
          <div className="space-y-4">
            {PROBLEM_GROUPS.map(gr => (
              <div key={gr.id}>
                <div className="mb-2 text-xs font-bold uppercase tracking-wider text-mist">{gr.label}</div>
                <div className="flex flex-wrap gap-2">
                  {PROBLEMS.filter(p => p.group === gr.id).map(p => {
                    const isAuto = auto.includes(p.id), on = isAuto || picked.includes(p.id);
                    return (
                      <button key={p.id} type="button" title={p.hint} disabled={ro || isAuto} onClick={() => toggle(p.id)}
                        className={`rounded-full border px-3 py-1.5 text-left text-xs font-semibold transition-all duration-200 ${on ? "scale-[1.02] border-door bg-door/20 text-door-hi shadow-[0_0_0_3px_rgba(249,115,22,.12)]" : "border-white/10 bg-white/5 text-bone/80 hover:border-white/30"}`}>
                        {isAuto ? "⚡ " : on ? "✓ " : ""}{p.label} <span className="opacity-60">+{p.points}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
            <Field label="Other problems" hint="one per line, +1 point each">
              <textarea className={`${inp} h-20`} placeholder={"No photo of the hot tub\nNo mention of parking"} value={f.custom_problems} disabled={ro} onChange={e => set("custom_problems", e.target.value)} />
            </Field>
          </div>
        </Step>

        <Step n={6} title="Solutions" sub="A fix is written for every problem. Edit if you like." delay={300}>
          <textarea className={`${inp} h-36 font-mono text-xs`} value={f.solutions} disabled={ro} onChange={e => { set("solutions", e.target.value); setSolTouched(true); }} />
          {solTouched && !ro && <button type="button" onClick={() => setSolTouched(false)} className="mt-2 text-xs text-door hover:underline">↺ Auto-fill again</button>}
        </Step>

        <Step n={7} title="Pitch draft" sub="Always read it and add a personal line before sending." delay={360}>
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <select className="scout-input w-auto text-xs" value={offer} onChange={e => { setOffer(e.target.value); setPitchTouched(false); }}>{OFFERS.map(o => <option key={o} value={o}>Free offer: {o}</option>)}</select>
              {pitchTouched && <button type="button" onClick={() => setPitchTouched(false)} className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold hover:bg-white/15">↺ Back to template</button>}
              {ai && <button type="button" disabled={busy === "ai"} onClick={aiPitch} className="rounded-lg bg-gradient-to-r from-pool-deep to-pool px-3 py-1.5 text-xs font-bold text-night disabled:opacity-50">{busy === "ai" ? "Writing…" : "✨ Improve with AI"}</button>}
              <button type="button" onClick={copy} className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold hover:bg-white/15">📋 Copy</button>
            </div>
            <input className={inp} value={f.pitch_subject} onChange={e => { set("pitch_subject", e.target.value); setPitchTouched(true); }} placeholder="Subject" />
            <textarea className={`${inp} h-72 leading-relaxed`} value={f.pitch} onChange={e => { set("pitch", e.target.value); setPitchTouched(true); }} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Status"><select className={inp} value={f.status} onChange={e => set("status", e.target.value)}>{STATUSES.map(x => <option key={x.id} value={x.id}>{x.label}</option>)}</select></Field>
              <Field label="Notes"><input className={inp} value={f.notes} onChange={e => set("notes", e.target.value)} placeholder="Anything worth remembering" /></Field>
            </div>
          </div>
        </Step>
      </div>

      <aside className="lg:sticky lg:top-4 lg:self-start">
        <Card className="flex flex-row items-center gap-4 lg:flex-col lg:text-center" delay={100}>
          <Ring value={s.score} size={132} stroke={11} color={g.ring}>
            <div className="text-4xl font-black tabular-nums">{s.score}</div>
            <div className="text-[10px] uppercase tracking-widest text-mist">score</div>
          </Ring>
          <div className="flex-1 space-y-2">
            <div key={s.grade} className={`scout-pop inline-block rounded-full px-3 py-1 text-sm font-bold ${s.grade === "hot" ? "scout-glow bg-door text-night" : s.grade === "warm" ? "bg-door-hi/90 text-night" : "bg-slate-600 text-white"}`}>{g.label}</div>
            <div className="text-sm text-bone/80">{g.text}</div>
            <div className="text-sm"><b className="text-2xl font-black tabular-nums">{s.count}</b> <span className="text-mist">problems found</span></div>
            <p className="hidden text-xs text-mist/70 lg:block">More problems means a stronger pitch. Score 60+ = hot lead.</p>
          </div>
        </Card>
        <div className="sticky bottom-3 z-20 mt-3 flex gap-2 lg:static">
          {editing && <button type="button" onClick={onCancel} className="rounded-xl bg-white/10 px-4 py-3 font-semibold">Back</button>}
          <button type="button" disabled={busy === "save" || Boolean(dup)} onClick={editing && ro ? async () => {
            setBusy("save");
            try { const r = await api("/api/scout/listings", { body: { id: editing.id, status: f.status, pitch: f.pitch, pitch_subject: f.pitch_subject, contact: f.contact, notes: f.notes } }); onSaved(r.listing, false); }
            catch (e) { toast((e as Error).message, "err"); } finally { setBusy(""); }
          } : save}
            className="flex-1 rounded-xl bg-gradient-to-r from-door-deep to-door px-4 py-3 font-black text-night shadow-lg shadow-door/20 transition hover:brightness-110 active:scale-[.98] disabled:opacity-50">
            {busy === "save" ? "Saving…" : editing ? "💾 Save changes" : "🚀 Save listing"}
          </button>
        </div>
      </aside>
    </div>
  );
}
