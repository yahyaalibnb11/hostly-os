"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

// The Listings and Calendar screens of the command center. Both read and write through /api/hostly/*.

/* eslint-disable @typescript-eslint/no-explicit-any */
type Api = (path: string, body?: unknown) => Promise<any>;

const AREAS: [string, string][] = [["US-FL", "Florida"], ["US-TN", "Tennessee"], ["AE", "Dubai / UAE"], ["GB", "United Kingdom"], ["PK", "Pakistan"]];
const STATUS_LABEL: Record<string, string> = { onboarding: "Getting ready", live: "Live", paused: "Paused", offboarded: "Removed" };
const input = "w-full rounded bg-ember-800 px-2 py-1.5 text-sm";
const fmtDay = (s?: string) => (s ? new Date(s).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "");

function Box({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-ember-700 bg-ember-900 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-bold uppercase tracking-wider text-ember-400">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

const EMPTY = { name: "", market: "US-FL", city: "", status: "onboarding", bedrooms: "", capacity: "", base_price: "", min_price: "", max_price: "", max_discount_pct: "15", auto_change_limit_pct: "10", listing_url: "", airbnb: "", vrbo: "", booking: "" };

export function ListingsView({ api, isAdmin, onMessage }: { api: Api; isAdmin: boolean; onMessage: (m: string) => void }) {
  const [list, setList] = useState<any[] | null>(null);
  const [form, setForm] = useState<Record<string, string> | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => api("/api/hostly/properties").then(r => setList(r.properties)).catch(e => onMessage(e.message)), [api, onMessage]);
  useEffect(() => { load(); }, [load]);

  const edit = (p?: any) => setForm(p ? {
    id: p.id, name: p.name, market: p.market, city: p.city ?? "", status: p.status,
    bedrooms: p.bedrooms ?? "", capacity: p.capacity ?? "", base_price: p.base_price ?? "", min_price: p.min_price ?? "", max_price: p.max_price ?? "",
    max_discount_pct: String(p.max_discount_pct ?? 15), auto_change_limit_pct: String(p.auto_change_limit_pct ?? 10),
    listing_url: p.listing_ids?.listing_url ?? "", airbnb: p.calendar_urls?.airbnb ?? "", vrbo: p.calendar_urls?.vrbo ?? "", booking: p.calendar_urls?.booking ?? "",
  } : { ...EMPTY });

  const save = async () => {
    if (!form) return;
    setBusy(true);
    try {
      const { airbnb, vrbo, booking, ...rest } = form;
      await api("/api/hostly/properties", { ...rest, calendar_urls: { airbnb, vrbo, booking } });
      onMessage(form.id ? "Listing saved." : "Listing added. Press \"Sync calendars\" on the Calendar tab to bring in its bookings.");
      setForm(null);
      await load();
    } catch (e) {
      onMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const field = (k: string, label: string, ph = "", type = "text") => (
    <label className="block text-xs text-stone-400">{label}
      <input className={input + " mt-0.5 text-stone-100"} type={type} placeholder={ph} value={form?.[k] ?? ""} onChange={e => setForm({ ...form!, [k]: e.target.value })} />
    </label>
  );

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="lg:col-span-2">
        <Box title={`Your listings (${list?.length ?? 0})`} right={isAdmin && <button onClick={() => edit()} className="rounded bg-ember-500 px-3 py-1 text-sm font-semibold text-ember-950">+ Add listing</button>}>
          {list === null && <p className="text-sm text-stone-400">Loading…</p>}
          {list?.length === 0 && <p className="text-sm text-stone-400">No listings yet. Press <b>+ Add listing</b> and paste its Airbnb calendar link, so bookings come in by themselves.</p>}
          <div className="grid gap-3 md:grid-cols-2">
            {list?.map(p => (
              <div key={p.id} className="rounded-lg border border-ember-700 bg-ember-950 p-3 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <div><b>{p.name}</b><div className="text-xs text-stone-400">{p.city || p.market} · {p.code}</div></div>
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${p.status === "live" ? "bg-emerald-900 text-emerald-200" : "bg-ember-800"}`}>{STATUS_LABEL[p.status] ?? p.status}</span>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-1 text-xs text-stone-300">
                  <span>Normal: <b>{p.base_price ?? "–"}</b></span><span>Lowest: <b>{p.min_price ?? "–"}</b></span><span>Highest: <b>{p.max_price ?? "–"}</b></span>
                </div>
                <div className="mt-1 text-xs text-stone-400">
                  Calendars: {Object.keys(p.calendar_urls ?? {}).length ? Object.keys(p.calendar_urls).join(", ") : "none yet"}
                  {p.calendar_synced_at && <> · synced {fmtDay(p.calendar_synced_at)}</>}
                </div>
                {p.calendar_error && <div className="mt-1 text-xs text-red-300">Calendar problem: {p.calendar_error}</div>}
                {isAdmin && <button onClick={() => edit(p)} className="mt-2 rounded bg-ember-800 px-2 py-1 text-xs">Edit</button>}
              </div>
            ))}
          </div>
        </Box>
      </div>
      <div>
        {form ? (
          <Box title={form.id ? "Edit listing" : "Add a listing"}>
            <div className="space-y-2">
              {field("name", "Name", "Lake Nona Pool Villa")}
              <div className="grid grid-cols-2 gap-2">
                <label className="block text-xs text-stone-400">Area
                  <select className={input + " mt-0.5 text-stone-100"} value={form.market} onChange={e => setForm({ ...form, market: e.target.value })}>
                    {AREAS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </label>
                {field("city", "City", "Orlando")}
              </div>
              <label className="block text-xs text-stone-400">Status
                <select className={input + " mt-0.5 text-stone-100"} value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}>
                  {Object.entries(STATUS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </label>
              <div className="grid grid-cols-2 gap-2">{field("bedrooms", "Bedrooms", "3", "number")}{field("capacity", "Max guests", "8", "number")}</div>
              <p className="pt-1 text-xs font-semibold text-stone-300">Price per night (the Price helper never goes outside these)</p>
              <div className="grid grid-cols-3 gap-2">{field("base_price", "Normal", "180", "number")}{field("min_price", "Lowest", "120", "number")}{field("max_price", "Highest", "350", "number")}</div>
              <div className="grid grid-cols-2 gap-2">{field("max_discount_pct", "Biggest discount %", "15", "number")}{field("auto_change_limit_pct", "Biggest daily change %", "10", "number")}</div>
              {field("listing_url", "Listing link (optional)", "https://www.airbnb.com/rooms/…")}
              <p className="pt-1 text-xs font-semibold text-stone-300">Calendar links (.ics). Bookings come in by themselves.</p>
              {field("airbnb", "Airbnb calendar link", "https://www.airbnb.com/calendar/ical/….ics")}
              {field("vrbo", "Vrbo calendar link", "https://www.vrbo.com/icalendar/….ics")}
              {field("booking", "Booking.com calendar link", "https://admin.booking.com/hotel/hoteladmin/ical.html?…")}
              <p className="text-xs text-stone-500">Airbnb: Listing → Availability → Connect calendars → Export calendar → copy the link.</p>
              <div className="flex gap-2 pt-1">
                <button disabled={busy} onClick={save} className="rounded bg-ember-500 px-3 py-1.5 text-sm font-semibold text-ember-950 disabled:opacity-50">{busy ? "Saving…" : "Save"}</button>
                <button onClick={() => setForm(null)} className="rounded bg-ember-800 px-3 py-1.5 text-sm">Cancel</button>
              </div>
            </div>
          </Box>
        ) : (
          <Box title="How listings work">
            <ol className="list-decimal space-y-1.5 pl-4 text-sm text-stone-300">
              <li>Add the listing with its lowest and highest price.</li>
              <li>Paste its Airbnb (and Vrbo) calendar link.</li>
              <li>Bookings appear on the Calendar, and a cleaning is booked for every checkout.</li>
              <li>Set it to <b>Live</b> when guests can book it. Then the Price helper checks it every morning.</li>
            </ol>
          </Box>
        )}
      </div>
    </div>
  );
}

const DAY = 86400000;

export function CalendarView({ api, isAdmin, onMessage }: { api: Api; isAdmin: boolean; onMessage: (m: string) => void }) {
  const [data, setData] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api("/api/hostly/calendar").then(setData).catch(e => onMessage(e.message)), [api, onMessage]);
  useEffect(() => { load(); }, [load]);

  const days = useMemo(() => {
    const start = Date.parse(new Date().toISOString().slice(0, 10));
    return Array.from({ length: 28 }, (_, i) => new Date(start + i * DAY).toISOString().slice(0, 10));
  }, []);

  const sync = async () => {
    setBusy(true);
    try {
      const r = await api("/api/hostly/calendar", {});
      const bad = (r.sync ?? []).filter((s: any) => s.error);
      const n = (r.sync ?? []).reduce((a: number, s: any) => a + s.queued, 0);
      onMessage(bad.length ? `Some calendars failed: ${bad.map((s: any) => `${s.property} ${s.channel}: ${s.error}`).join("; ")}` : `Calendars synced. ${n} change(s) brought in.`);
      await load();
    } catch (e) {
      onMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const cell = (propertyId: string, day: string) => {
    const s = data?.stays?.find((r: any) => r.property_id === propertyId && r.check_in <= day && r.check_out > day);
    const out = data?.stays?.some((r: any) => r.property_id === propertyId && r.status === "confirmed" && r.check_out === day);
    if (!s) return <span className={`block h-5 rounded ${out ? "border-l-4 border-sky-400" : ""}`} title={out ? "Checkout: cleaning day" : "Free"} />;
    const first = s.check_in === day;
    return <span className={`block h-5 rounded ${s.status === "blocked" ? "bg-stone-600" : first ? "bg-ember-500" : "bg-ember-700"} ${out ? "border-l-4 border-sky-400" : ""}`} title={`${s.status === "blocked" ? "Blocked" : "Booked"} on ${s.channel}: ${s.check_in} → ${s.check_out}`} />;
  };

  return (
    <div className="space-y-4">
      <Box title="Calendar: next 4 weeks" right={isAdmin && <button disabled={busy} onClick={sync} className="rounded bg-ember-500 px-3 py-1 text-sm font-semibold text-ember-950 disabled:opacity-50">{busy ? "Syncing…" : "Sync calendars now"}</button>}>
        <div className="mb-2 flex flex-wrap gap-3 text-xs text-stone-400">
          <span><i className="mr-1 inline-block h-3 w-3 rounded bg-ember-500 align-middle" />Check-in</span>
          <span><i className="mr-1 inline-block h-3 w-3 rounded bg-ember-700 align-middle" />Booked</span>
          <span><i className="mr-1 inline-block h-3 w-3 rounded bg-stone-600 align-middle" />Blocked</span>
          <span><i className="mr-1 inline-block h-3 w-1 rounded bg-sky-400 align-middle" />Checkout / cleaning day</span>
          <span>Calendars also sync by themselves every morning.</span>
        </div>
        {!data && <p className="text-sm text-stone-400">Loading…</p>}
        {data && !data.properties?.length && <p className="text-sm text-stone-400">No listings yet. Add one on the Listings tab first.</p>}
        {data?.properties?.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-xs">
              <thead>
                <tr className="text-stone-400">
                  <th className="sticky left-0 bg-ember-900 py-1 pr-2 text-left font-normal">Listing</th>
                  {days.map(d => <th key={d} className="px-0.5 font-normal">{new Date(d + "T12:00:00Z").getUTCDate()}</th>)}
                </tr>
              </thead>
              <tbody>
                {data.properties.map((p: any) => (
                  <tr key={p.id} className="border-t border-ember-800">
                    <td className="sticky left-0 bg-ember-900 py-1.5 pr-2 whitespace-nowrap">{p.name}{p.calendar_error && <span className="ml-1 text-red-300" title={p.calendar_error}>⚠</span>}</td>
                    {days.map(d => <td key={d} className="px-0.5">{cell(p.id, d)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Box>
      <Box title="Cleanings and tasks">
        {!data?.tasks?.length && <p className="text-sm text-stone-400">No tasks yet. A cleaning is added for every checkout once bookings come in.</p>}
        <ul className="space-y-1.5 text-sm">
          {data?.tasks?.map((t: any) => (
            <li key={t.id} className="flex justify-between gap-2"><span>{t.title}</span><span className="shrink-0 text-xs text-stone-400">{fmtDay(t.due_at)}</span></li>
          ))}
        </ul>
      </Box>
    </div>
  );
}
