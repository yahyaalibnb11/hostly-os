"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { marketById } from "@/lib/scout/catalog";
import type { Api } from "./ui";

// Listing Scanner UI: camera, upload or paste screenshots of a listing, and AI fills the form.
// Also the "Contact dhundo" box, so the team reaches hosts off Airbnb (never in the Airbnb inbox).

/* eslint-disable @typescript-eslint/no-explicit-any */
export type ScanResult = Record<string, any>;
type Shot = { id: string; url: string; type: string; data: string; bytes: number };

const MAX_SHOTS = 8;
const MAX_EDGE = 1600;
const BUDGET = 3_800_000; // the server takes ~4.5 MB per request, keep room for JSON

// Shrink a photo in the browser so uploads stay small and fast on mobile data.
async function shrink(file: Blob, quality = 0.82): Promise<Omit<Shot, "id">> {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height));
  const cv = document.createElement("canvas");
  cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
  cv.getContext("2d")!.drawImage(bmp, 0, 0, cv.width, cv.height);
  bmp.close?.();
  const url = cv.toDataURL("image/jpeg", quality);
  const data = url.slice(url.indexOf(",") + 1);
  return { url, type: "image/jpeg", data, bytes: Math.round(data.length * 0.75) };
}

const STEPS = ["Screenshots parh raha hai…", "Rating aur reviews gin raha hai…", "Price aur nights dhoond raha hai…", "Photos aur title check kar raha hai…", "Reviews mein complaints dhoond raha hai…", "Problems aur score bana raha hai…"];

export function ScreenshotScanner({ api, ai, onResult, toast }: { api: Api; ai: boolean; onResult: (r: ScanResult) => void; toast: (m: string, k?: "ok" | "err") => void }) {
  const [shots, setShots] = useState<Shot[]>([]);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(0);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [drag, setDrag] = useState(false);
  const cam = useRef<HTMLInputElement>(null);
  const files = useRef<HTMLInputElement>(null);

  const add = useCallback(async (list: Blob[]) => {
    const imgs = list.filter(f => f.type.startsWith("image/"));
    if (!imgs.length) return;
    const room = MAX_SHOTS - shots.length;
    if (room <= 0) { toast(`Zyada se zyada ${MAX_SHOTS} screenshots`, "err"); return; }
    try {
      const done = await Promise.all(imgs.slice(0, room).map(shrink));
      setShots(s => [...s, ...done.map(d => ({ ...d, id: Math.random().toString(36).slice(2) }))]);
      if (imgs.length > room) toast(`Sirf ${MAX_SHOTS} screenshots tak, baaqi chhor diye`, "err");
    } catch { toast("Ye image khul nahi saki. Screenshot JPG/PNG mein lo.", "err"); }
  }, [shots.length, toast]);

  // Ctrl+V / paste from the clipboard anywhere on the page.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const items = Array.from(e.clipboardData?.files ?? []);
      if (items.some(f => f.type.startsWith("image/"))) { e.preventDefault(); add(items); }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [add]);

  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => setStep(s => Math.min(s + 1, STEPS.length - 1)), 2200);
    return () => clearInterval(t);
  }, [busy]);

  const scan = async () => {
    if (!shots.length) return;
    setBusy(true); setStep(0); setResult(null);
    try {
      let list = shots;
      if (list.reduce((a, s) => a + s.bytes, 0) > BUDGET) {
        // Too big for one request: squeeze harder before sending.
        list = await Promise.all(list.map(async s => ({ ...s, ...(await shrink(await (await fetch(s.url)).blob(), 0.6)) })));
      }
      const r = await api("/api/scout/scan", { body: { images: list.map(s => ({ type: s.type, data: s.data })) } });
      setResult(r.result); onResult(r.result);
      toast("✨ Data bhar diya! Ek dafa check kar lo");
    } catch (e) { toast((e as Error).message, "err"); } finally { setBusy(false); }
  };

  const onFiles = (e: React.ChangeEvent<HTMLInputElement>) => { add(Array.from(e.target.files ?? [])); e.target.value = ""; };

  return (
    <div className="scout-card scout-rise relative overflow-hidden p-4 md:p-5">
      <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-fuchsia-500/20 blur-3xl" />
      <div className="mb-3 flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-xl shadow-lg shadow-fuchsia-500/30">📸</div>
        <div>
          <h3 className="font-extrabold">Screenshots se auto-bharo <span className="ml-1 rounded-full bg-fuchsia-500/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-fuchsia-200">AI</span></h3>
          <p className="text-xs text-stone-400">Listing ke 3-6 screenshots lo: upar wala hissa (title, rating), host profile, price/calendar, reviews. AI sab khud bhar dega.</p>
        </div>
      </div>

      {!ai && <p className="mb-3 rounded-xl border border-amber-400/40 bg-amber-400/10 p-3 text-xs text-amber-200">AI abhi connect nahi hai. Yahya Vercel mein ANTHROPIC_API_KEY lagaye ga, phir ye button chalega. Tab tak form haath se bharo.</p>}

      <div onDragOver={e => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={e => { e.preventDefault(); setDrag(false); add(Array.from(e.dataTransfer.files)); }}
        className={`rounded-2xl border-2 border-dashed p-3 transition ${drag ? "border-fuchsia-400 bg-fuchsia-500/10" : "border-white/15"}`}>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => cam.current?.click()} disabled={busy} className="rounded-xl bg-white px-4 py-2.5 text-sm font-black text-stone-950 shadow active:scale-95 disabled:opacity-50">📷 Camera</button>
          <button type="button" onClick={() => files.current?.click()} disabled={busy} className="rounded-xl bg-white/10 px-4 py-2.5 text-sm font-bold hover:bg-white/15 disabled:opacity-50">🖼️ Screenshots chuno</button>
          <span className="hidden self-center text-xs text-stone-500 md:inline">ya yahan drag karo · Ctrl+V se paste</span>
        </div>
        <input ref={cam} type="file" accept="image/*" capture="environment" className="hidden" onChange={onFiles} />
        <input ref={files} type="file" accept="image/*" multiple className="hidden" onChange={onFiles} data-testid="scan-files" />

        {shots.length > 0 && (
          <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
            {shots.map((s, i) => (
              <div key={s.id} className="scout-pop relative h-24 w-16 shrink-0 overflow-hidden rounded-lg border border-white/10" style={{ animationDelay: `${i * 40}ms` }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={s.url} alt={`Screenshot ${i + 1}`} className="h-full w-full object-cover object-top" />
                {busy && <div className="scout-scanline absolute inset-x-0 h-6" />}
                {!busy && <button type="button" onClick={() => setShots(x => x.filter(y => y.id !== s.id))} aria-label="Hatao" className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-[10px]">✕</button>}
              </div>
            ))}
          </div>
        )}
      </div>

      {shots.length > 0 && (
        <button type="button" disabled={busy || !ai} onClick={scan} className="mt-3 w-full rounded-xl bg-gradient-to-r from-indigo-500 to-fuchsia-500 py-3 font-black text-white shadow-lg shadow-fuchsia-500/25 transition active:scale-[.98] disabled:opacity-50">
          {busy ? <span key={step} className="scout-pop inline-block">🔍 {STEPS[step]}</span> : `✨ ${shots.length} screenshot${shots.length > 1 ? "s" : ""} scan karo`}
        </button>
      )}

      {result && !busy && (
        <div className="scout-pop mt-3 space-y-2 rounded-xl bg-white/5 p-3 text-sm">
          {result.summary_roman_urdu && <p className="text-stone-100">🧠 {result.summary_roman_urdu}</p>}
          {(result.review_complaints?.length > 0 || result.review_praise?.length > 0) && (
            <div className="grid gap-2 sm:grid-cols-2">
              {result.review_complaints?.length > 0 && <div><div className="text-xs font-bold text-red-300">👎 Guests ki shikayat</div><ul className="list-disc pl-4 text-xs text-stone-300">{result.review_complaints.map((x: string) => <li key={x}>{x}</li>)}</ul></div>}
              {result.review_praise?.length > 0 && <div><div className="text-xs font-bold text-emerald-300">👍 Guests ko pasand</div><ul className="list-disc pl-4 text-xs text-stone-300">{result.review_praise.map((x: string) => <li key={x}>{x}</li>)}</ul></div>}
            </div>
          )}
          {result.not_visible?.length > 0 && <p className="text-xs text-amber-300">✍️ Ye screenshots mein nahi mila, haath se bharo: {result.not_visible.join(", ")}</p>}
          <button type="button" onClick={() => { setShots([]); setResult(null); }} className="text-xs text-fuchsia-300 hover:underline">↺ Nayi listing ke screenshots</button>
        </div>
      )}
    </div>
  );
}

const q = encodeURIComponent;

// Search links to find the host outside Airbnb: Google, Facebook, Instagram, LinkedIn, company and licence registers.
export function contactLinks({ host, title, market, area, licence }: { host?: string; title?: string; market?: string; area?: string; licence?: string }) {
  const m = marketById(market || "");
  const city = (area || m?.name || "").trim();
  const name = (host || "").trim();
  const links: { label: string; hint: string; url: string }[] = [];
  if (name) {
    links.push({ label: "Google: host + city", hint: "website, holiday-let page, reviews", url: `https://www.google.com/search?q=${q(`"${name}" ${city} (airbnb OR "holiday let" OR "short let" OR "apartments")`)}` });
    links.push({ label: "Facebook", hint: "host ka profile ya page", url: `https://www.facebook.com/search/top?q=${q(`${name} ${city}`)}` });
    links.push({ label: "Instagram", hint: "Google se Instagram profile", url: `https://www.google.com/search?q=${q(`site:instagram.com "${name}" ${city}`)}` });
    links.push({ label: "LinkedIn", hint: "property investors / landlords", url: `https://www.linkedin.com/search/results/all/?keywords=${q(`${name} ${city} property`)}` });
  }
  if (title?.trim()) links.push({ label: "Title Google pe", hint: "wohi property doosri sites pe (website, Booking)", url: `https://www.google.com/search?q=${q(`"${title.trim().slice(0, 80)}"`)}` });
  if (m?.country === "UK" && name) links.push({ label: "Companies House", hint: "UK company ho to director ka naam", url: `https://find-and-update.company-information.service.gov.uk/search?q=${q(name)}` });
  if (licence?.trim()) links.push({ label: "Licence number Google pe", hint: "owner / company ka naam mil sakta hai", url: `https://www.google.com/search?q=${q(`"${licence.trim()}"`)}` });
  if (city) links.push({ label: "Facebook groups", hint: "city ke hosts ke groups join karo", url: `https://www.facebook.com/search/groups?q=${q(`${city} airbnb hosts`)}` });
  links.push({ label: "Google Lens", hint: "cover photo upload karo, website mil jati hai", url: "https://lens.google.com/" });
  return links;
}

export function ContactFinder(props: { host?: string; title?: string; market?: string; area?: string; licence?: string }) {
  const links = contactLinks(props);
  return (
    <div className="rounded-xl border border-white/10 bg-white/[.03] p-3">
      <div className="mb-2 text-xs font-bold text-stone-300">🔎 Contact dhundo <span className="font-normal text-stone-500">· Airbnb inbox mein pitch nahi, yahan se host tak pohncho</span></div>
      {!props.host && <p className="mb-2 text-xs text-stone-500">Host ka naam likho, zyada buttons aa jayenge.</p>}
      <div className="flex flex-wrap gap-1.5">
        {links.map(l => <a key={l.label} href={l.url} target="_blank" rel="noreferrer" title={l.hint} className="rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold text-stone-200 transition hover:bg-orange-500/30 hover:text-white">{l.label} ↗</a>)}
      </div>
    </div>
  );
}
