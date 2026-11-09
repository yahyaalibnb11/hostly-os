"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { marketById } from "@/lib/scout/catalog";
import type { Api } from "./ui";

// Listing Scanner UI: camera, upload or paste screenshots of a listing, and AI fills the form.
// Also the "Find contact" box, so the team reaches hosts off Airbnb (never in the Airbnb inbox).

/* eslint-disable @typescript-eslint/no-explicit-any */
export type ScanResult = Record<string, any>;
type Shot = { id: string; url: string; type: string; data: string; bytes: number };

const MAX_SHOTS = 20; // 8 screenshots, or up to 20 frames from a video
const MAX_EDGE = 1600;
const MAX_VIDEO_SECONDS = 60;
const FRAME_EDGE = 1400;
const BUDGET = 3_800_000; // the server takes ~4.5 MB per request, keep room for JSON

// Shrink a photo in the browser so uploads stay small and fast on mobile data.
async function shrink(file: Blob, quality = 0.82, edge = MAX_EDGE): Promise<Omit<Shot, "id">> {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, edge / Math.max(bmp.width, bmp.height));
  const cv = document.createElement("canvas");
  cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
  cv.getContext("2d")!.drawImage(bmp, 0, 0, cv.width, cv.height);
  bmp.close?.();
  const url = cv.toDataURL("image/jpeg", quality);
  const data = url.slice(url.indexOf(",") + 1);
  return { url, type: "image/jpeg", data, bytes: Math.round(data.length * 0.75) };
}

// ---- Video: a recording of the whole listing becomes a handful of distinct frames ----
// Claude reads images, not video, so we keep one frame whenever the screen has changed enough
// (scrolled to a new part of the page), at most `room` of them.

type Frame = { url: string; sig: Uint8Array };

function grab(v: HTMLVideoElement, quality = 0.7): Frame {
  const k = Math.min(1, FRAME_EDGE / Math.max(v.videoWidth, v.videoHeight));
  const cv = document.createElement("canvas");
  cv.width = Math.round(v.videoWidth * k); cv.height = Math.round(v.videoHeight * k);
  cv.getContext("2d")!.drawImage(v, 0, 0, cv.width, cv.height);
  const sm = document.createElement("canvas"); sm.width = 24; sm.height = 24;
  const sctx = sm.getContext("2d", { willReadFrequently: true })!;
  sctx.drawImage(cv, 0, 0, 24, 24);
  const px = sctx.getImageData(0, 0, 24, 24).data, sig = new Uint8Array(576);
  for (let i = 0; i < 576; i++) sig[i] = (px[i * 4] * 3 + px[i * 4 + 1] * 6 + px[i * 4 + 2]) / 10;
  return { url: cv.toDataURL("image/jpeg", quality), sig };
}
const diff = (a: Uint8Array, b: Uint8Array) => { let d = 0; for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]); return d / a.length; };

// Keep frames that differ from the last kept one, then thin them evenly down to `room`.
export function pickFrames<T extends { sig: Uint8Array }>(frames: T[], room: number, threshold = 7): T[] {
  const kept: T[] = [];
  for (const f of frames) if (!kept.length || diff(kept[kept.length - 1].sig, f.sig) > threshold) kept.push(f);
  if (kept.length <= room) return kept;
  return Array.from({ length: room }, (_, i) => kept[Math.round((i * (kept.length - 1)) / Math.max(1, room - 1))]);
}

const toShot = (url: string): Omit<Shot, "id"> => { const data = url.slice(url.indexOf(",") + 1); return { url, type: "image/jpeg", data, bytes: Math.round(data.length * 0.75) }; };

async function framesFromVideo(file: Blob, room: number, onProgress: (p: number) => void): Promise<{ shots: Omit<Shot, "id">[]; long: boolean }> {
  const v = document.createElement("video");
  v.muted = true; v.playsInline = true; v.preload = "auto";
  const src = URL.createObjectURL(file);
  v.src = src;
  try {
    await new Promise<void>((ok, bad) => { v.onloadeddata = () => ok(); v.onerror = () => bad(new Error("unreadable")); setTimeout(() => bad(new Error("unreadable")), 15000); });
    const length = Number.isFinite(v.duration) ? v.duration : MAX_VIDEO_SECONDS;
    const end = Math.min(length, MAX_VIDEO_SECONDS);
    const frames: Frame[] = [];
    for (let t = 0.2; t < end; t += 0.75) {
      await new Promise<void>(ok => { v.onseeked = () => ok(); v.currentTime = t; setTimeout(ok, 2500); });
      frames.push(grab(v));
      onProgress(Math.min(1, t / end));
    }
    return { shots: pickFrames(frames, room).map(f => toShot(f.url)), long: length > MAX_VIDEO_SECONDS + 1 };
  } finally { URL.revokeObjectURL(src); }
}

const STEPS = ["Reading the screenshots…", "Counting rating and reviews…", "Finding prices and nights…", "Checking photos and title…", "Looking for guest complaints…", "Building problems and score…"];

export function ScreenshotScanner({ api, ai, onResult, toast }: { api: Api; ai: boolean; onResult: (r: ScanResult) => void; toast: (m: string, k?: "ok" | "err") => void }) {
  const [shots, setShots] = useState<Shot[]>([]);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(0);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [drag, setDrag] = useState(false);
  const cam = useRef<HTMLInputElement>(null);
  const files = useRef<HTMLInputElement>(null);
  const vid = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState<number | null>(null); // video frames being read, 0-1
  const [rec, setRec] = useState<{ secs: number } | null>(null); // screen recording in progress
  const recStop = useRef<(() => void) | null>(null);
  const canRecord = typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getDisplayMedia);

  const addFrames = useCallback((list: Omit<Shot, "id">[]) => {
    setShots(s => [...s, ...list.map(d => ({ ...d, id: Math.random().toString(36).slice(2) }))]);
  }, []);

  const addVideo = useCallback(async (file: Blob) => {
    const room = MAX_SHOTS - shots.length;
    if (room <= 0) { toast(`${MAX_SHOTS} images at most. Remove some first.`, "err"); return; }
    setReading(0);
    try {
      const { shots: got, long } = await framesFromVideo(file, room, setReading);
      if (!got.length) throw new Error("empty");
      addFrames(got);
      toast(long ? `🎬 Only the first minute was used: ${got.length} frames` : `🎬 ${got.length} frames taken from the video`);
    } catch {
      toast("This video can't be read in this browser. Record it again (MP4 works best) or use screenshots.", "err");
    } finally { setReading(null); }
  }, [shots.length, toast, addFrames]);

  // Laptop: record the Airbnb tab directly. We sample the shared screen once a second while the
  // student scrolls, so nothing big is ever uploaded.
  const recordScreen = async () => {
    const room = MAX_SHOTS - shots.length;
    if (room <= 0) { toast(`${MAX_SHOTS} images at most. Remove some first.`, "err"); return; }
    let stream: MediaStream;
    try { stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 5 }, audio: false }); }
    catch { return; } // the student cancelled the picker
    const v = document.createElement("video");
    v.muted = true; v.playsInline = true; v.srcObject = stream;
    await v.play().catch(() => undefined);
    const frames: Frame[] = [];
    const started = Date.now();
    setRec({ secs: 0 });
    const tick = setInterval(() => {
      if (v.videoWidth) frames.push(grab(v));
      const secs = Math.round((Date.now() - started) / 1000);
      setRec({ secs });
      if (secs >= MAX_VIDEO_SECONDS) stop();
    }, 1000);
    let done = false;
    const stop = () => {
      if (done) return; done = true;
      clearInterval(tick); stream.getTracks().forEach(t => t.stop()); setRec(null); recStop.current = null;
      const got = pickFrames(frames, room).map(f => toShot(f.url));
      if (got.length) { addFrames(got); toast(`🎬 ${got.length} frames taken from the recording`); }
      else toast("Nothing was recorded. Try again and scroll through the listing.", "err");
    };
    stream.getVideoTracks()[0]?.addEventListener("ended", stop); // "Stop sharing" in the browser bar
    recStop.current = stop;
  };

  const add = useCallback(async (list: Blob[]) => {
    const video = list.find(f => f.type.startsWith("video/"));
    if (video) { await addVideo(video); return; }
    const imgs = list.filter(f => f.type.startsWith("image/"));
    if (!imgs.length) return;
    const room = MAX_SHOTS - shots.length;
    if (room <= 0) { toast(`${MAX_SHOTS} screenshots at most`, "err"); return; }
    try {
      const done = await Promise.all(imgs.slice(0, room).map(f => shrink(f)));
      setShots(s => [...s, ...done.map(d => ({ ...d, id: Math.random().toString(36).slice(2) }))]);
      if (imgs.length > room) toast(`Only the first ${MAX_SHOTS} screenshots were added`, "err");
    } catch { toast("That image couldn't be opened. Use a JPG or PNG screenshot.", "err"); }
  }, [shots.length, toast, addVideo]);

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
        list = await Promise.all(list.map(async s => ({ ...s, ...(await shrink(await (await fetch(s.url)).blob(), 0.55, 1200)) })));
      }
      const r = await api("/api/scout/scan", { body: { images: list.map(s => ({ type: s.type, data: s.data })) } });
      setResult(r.result); onResult(r.result);
      setShots([]); // ready for the next listing
      toast("✨ Form filled! Give it a quick check");
    } catch (e) { toast((e as Error).message, "err"); } finally { setBusy(false); }
  };

  const onFiles = (e: React.ChangeEvent<HTMLInputElement>) => { add(Array.from(e.target.files ?? [])); e.target.value = ""; };

  return (
    <div className="scout-card scout-rise relative overflow-hidden p-4 md:p-5">
      <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-pool/20 blur-3xl" />
      <div className="mb-3 flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-pool-deep to-pool text-xl shadow-lg shadow-pool/30">📸</div>
        <div>
          <h3 className="font-extrabold">Auto-fill from screenshots or video <span className="ml-1 rounded-full bg-pool/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-pool-hi">AI</span></h3>
          <p className="text-xs text-mist">Add up to 8 screenshots (top of the listing, all photos, weekday and weekend price, description, amenities, reviews, host profile), or a screen recording of up to 1 minute scrolling through the same parts. AI fills in the rest.</p>
        </div>
      </div>

      {!ai && <p className="mb-3 rounded-xl border border-door/40 bg-door-hi/10 p-3 text-xs text-door-hi">AI isn&apos;t connected yet. Once Yahya adds the ANTHROPIC_API_KEY in Vercel this will work. Until then, fill the form by hand.</p>}

      <div onDragOver={e => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={e => { e.preventDefault(); setDrag(false); add(Array.from(e.dataTransfer.files)); }}
        className={`rounded-2xl border-2 border-dashed p-3 transition ${drag ? "border-pool bg-pool/10" : "border-white/15"}`}>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => cam.current?.click()} disabled={busy} className="rounded-xl bg-white px-4 py-2.5 text-sm font-black text-night shadow active:scale-95 disabled:opacity-50">📷 Camera</button>
          <button type="button" onClick={() => files.current?.click()} disabled={busy} className="rounded-xl bg-white/10 px-4 py-2.5 text-sm font-bold hover:bg-white/15 disabled:opacity-50">🖼️ Choose screenshots</button>
          <button type="button" onClick={() => vid.current?.click()} disabled={busy || reading !== null || Boolean(rec)} className="rounded-xl bg-white/10 px-4 py-2.5 text-sm font-bold hover:bg-white/15 disabled:opacity-50">🎬 Upload video</button>
          {canRecord && <button type="button" onClick={recordScreen} disabled={busy || reading !== null || Boolean(rec)} className="hidden rounded-xl bg-white/10 px-4 py-2.5 text-sm font-bold hover:bg-white/15 disabled:opacity-50 md:block">⏺️ Record screen</button>}
          <span className="hidden self-center text-xs text-mist/70 md:inline">or drag files here · paste with Ctrl+V</span>
        </div>
        {rec && (
          <div className="scout-pop mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-red-400/40 bg-red-500/10 p-3 text-sm">
            <span className="h-3 w-3 animate-pulse rounded-full bg-red-500" />
            <b className="tabular-nums">Recording {rec.secs}s / {MAX_VIDEO_SECONDS}s</b>
            <span className="text-xs text-mist">Go to the Airbnb tab and scroll slowly through the listing, host profile and calendar.</span>
            <button type="button" onClick={() => recStop.current?.()} className="ml-auto rounded-lg bg-red-500 px-3 py-1.5 text-xs font-black text-white">■ Stop</button>
          </div>
        )}
        {reading !== null && (
          <div className="mt-3 text-xs text-mist">🎬 Reading the video… {Math.round(reading * 100)}%
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full bg-pool transition-all" style={{ width: `${reading * 100}%` }} /></div>
          </div>
        )}
        <input ref={cam} type="file" accept="image/*" capture="environment" className="hidden" onChange={onFiles} />
        <input ref={files} type="file" accept="image/*" multiple className="hidden" onChange={onFiles} data-testid="scan-files" />
        <input ref={vid} type="file" accept="video/*" className="hidden" onChange={onFiles} data-testid="scan-video" />

        {shots.length > 0 && (
          <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
            {shots.map((s, i) => (
              <div key={s.id} className="scout-pop relative h-24 w-16 shrink-0 overflow-hidden rounded-lg border border-white/10" style={{ animationDelay: `${i * 40}ms` }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={s.url} alt={`Screenshot ${i + 1}`} className="h-full w-full object-cover object-top" />
                {busy && <div className="scout-scanline absolute inset-x-0 h-6" />}
                {!busy && <button type="button" onClick={() => setShots(x => x.filter(y => y.id !== s.id))} aria-label="Remove" className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-[10px]">✕</button>}
              </div>
            ))}
          </div>
        )}
      </div>

      {shots.length > 0 && (
        <button type="button" disabled={busy || !ai} onClick={scan} className="mt-3 w-full rounded-xl bg-gradient-to-r from-pool-deep to-pool py-3 font-black text-night shadow-lg shadow-pool/25 transition active:scale-[.98] disabled:opacity-50">
          {busy ? <span key={step} className="scout-pop inline-block">🔍 {STEPS[step]}</span> : `✨ Scan ${shots.length} image${shots.length > 1 ? "s" : ""}`}
        </button>
      )}

      {result && !busy && (
        <div className="scout-pop mt-3 space-y-2 rounded-xl bg-white/5 p-3 text-sm">
          {result.summary && <p className="text-bone">🧠 {result.summary}</p>}
          {result.host_insights?.length > 0 && <div><div className="text-xs font-bold text-door">👤 About the host</div><ul className="list-disc pl-4 text-xs text-bone/80">{result.host_insights.map((x: string) => <li key={x}>{x}</li>)}</ul></div>}
          {(result.review_complaints?.length > 0 || result.review_praise?.length > 0) && (
            <div className="grid gap-2 sm:grid-cols-2">
              {result.review_complaints?.length > 0 && <div><div className="text-xs font-bold text-red-300">👎 Guest complaints</div><ul className="list-disc pl-4 text-xs text-bone/80">{result.review_complaints.map((x: string) => <li key={x}>{x}</li>)}</ul></div>}
              {result.review_praise?.length > 0 && <div><div className="text-xs font-bold text-emerald-300">👍 Guests like</div><ul className="list-disc pl-4 text-xs text-bone/80">{result.review_praise.map((x: string) => <li key={x}>{x}</li>)}</ul></div>}
            </div>
          )}
          {result.not_visible?.length > 0 && <p className="text-xs text-door-hi">✍️ Not in the screenshots, fill these by hand: {result.not_visible.join(", ")}</p>}
          <button type="button" onClick={() => { setShots([]); setResult(null); }} className="text-xs text-pool hover:underline">↺ Start a new listing</button>
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
    links.push({ label: "Facebook", hint: "the host's profile or page", url: `https://www.facebook.com/search/top?q=${q(`${name} ${city}`)}` });
    links.push({ label: "Instagram", hint: "Instagram profile via Google", url: `https://www.google.com/search?q=${q(`site:instagram.com "${name}" ${city}`)}` });
    links.push({ label: "LinkedIn", hint: "property investors / landlords", url: `https://www.linkedin.com/search/results/all/?keywords=${q(`${name} ${city} property`)}` });
  }
  if (title?.trim()) links.push({ label: "Title on Google", hint: "same property on other sites (website, Booking)", url: `https://www.google.com/search?q=${q(`"${title.trim().slice(0, 80)}"`)}` });
  if (m?.country === "UK" && name) links.push({ label: "Companies House", hint: "director name if it's a UK company", url: `https://find-and-update.company-information.service.gov.uk/search?q=${q(name)}` });
  if (licence?.trim()) links.push({ label: "Licence on Google", hint: "can reveal the owner / company name", url: `https://www.google.com/search?q=${q(`"${licence.trim()}"`)}` });
  if (city) links.push({ label: "Facebook groups", hint: "join the city's host groups", url: `https://www.facebook.com/search/groups?q=${q(`${city} airbnb hosts`)}` });
  links.push({ label: "Google Lens", hint: "upload the cover photo to find their website", url: "https://lens.google.com/" });
  return links;
}

type Contact = { found: { kind: string; value: string; confidence: string; why: string }[]; owner_name: string; best_channel: string; approach_points: string[]; next_steps: string[]; summary: string };
const KIND_ICON: Record<string, string> = { website: "🌐", facebook: "📘", instagram: "📸", linkedin: "💼", company: "🏢", email: "✉️", phone: "📞", other_listing: "🏠", other: "🔗" };
const CONF: Record<string, string> = { high: "bg-pool/20 text-pool-hi", medium: "bg-door/20 text-door-hi", low: "bg-white/10 text-mist" };
const hrefOf = (v: string) => v.includes("@") && !v.startsWith("http") ? `mailto:${v}` : /^\+?[\d ()-]{7,}$/.test(v) ? `tel:${v.replace(/[^\d+]/g, "")}` : v;

type FinderProps = { host?: string; title?: string; market?: string; area?: string; licence?: string; listings?: string | number; managedBy?: string; insights?: string[]; link?: string };

export function ContactFinder(props: FinderProps & { api?: Api; ai?: boolean; toast?: (m: string, k?: "ok" | "err") => void; onUse?: (contact: string, notes: string) => void }) {
  const links = contactLinks(props);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Contact | null>(null);
  const [err, setErr] = useState("");
  const canSearch = Boolean(props.host?.trim() || props.title?.trim() || props.licence?.trim());

  const search = async () => {
    if (!props.api) return;
    setBusy(true); setErr(""); setRes(null);
    try {
      const m = marketById(props.market || "");
      const r = await props.api("/api/scout/contact", { body: { host: props.host, title: props.title, city: props.area || m?.name, country: m?.country, licence: props.licence, listings: props.listings, managed_by: props.managedBy, insights: props.insights, link: props.link } });
      setRes(r.result);
    } catch (e: any) { setErr(e?.message || "Search failed. Try again."); }
    finally { setBusy(false); }
  };

  const use = () => {
    if (!res || !props.onUse) return;
    const top = [...res.found].sort((a, b) => ["high", "medium", "low"].indexOf(a.confidence) - ["high", "medium", "low"].indexOf(b.confidence));
    const contact = top.filter(f => f.confidence !== "low").slice(0, 3).map(f => f.value).join(" , ");
    const notes = [res.owner_name && `Owner: ${res.owner_name}`, res.best_channel && `Best way: ${res.best_channel}`, res.approach_points.length ? `Approach: ${res.approach_points.join("; ")}` : ""].filter(Boolean).join(" | ");
    props.onUse(contact, notes);
    props.toast?.("✅ Contact and approach points added");
  };

  return (
    <div className="rounded-xl border border-white/10 bg-white/[.03] p-3">
      <div className="mb-2 text-xs font-bold text-bone/80">🔎 Find contact <span className="font-normal text-mist/70">· never pitch in the Airbnb inbox, reach the host here</span></div>
      {props.api && (
        <div className="mb-3">
          <button type="button" data-testid="ai-contact" onClick={search} disabled={busy || !canSearch || props.ai === false}
            className="rounded-lg bg-pool px-3 py-2 text-xs font-bold text-night transition hover:bg-pool-hi disabled:cursor-not-allowed disabled:opacity-50">
            {busy ? "🤖 Searching the internet… (20-60 sec)" : "🤖 Find contact with AI"}
          </button>
          <span className="ml-2 text-xs text-mist/70">{props.ai === false ? "AI isn't connected yet" : canSearch ? "searches Google for website, Facebook, Instagram, LinkedIn, company" : "scan the listing or enter the host name first"}</span>
          {busy && <div className="mt-2 h-1 overflow-hidden rounded bg-white/10"><div className="scout-scanline h-full w-1/3 bg-pool" /></div>}
          {err && <p className="mt-2 text-xs text-red-300">{err}</p>}
          {res && (
            <div data-testid="ai-contact-result" className="mt-3 space-y-3 rounded-lg border border-pool/30 bg-pool/[.06] p-3 text-sm">
              {res.summary && <p className="text-bone">{res.summary}</p>}
              {res.owner_name && <p className="text-xs text-mist">Owner / company: <b className="text-bone">{res.owner_name}</b></p>}
              {res.found.length > 0 ? (
                <ul className="space-y-1.5">
                  {res.found.map(f => (
                    <li key={f.value} className="flex flex-wrap items-center gap-2 text-xs">
                      <span>{KIND_ICON[f.kind] ?? "🔗"}</span>
                      <a href={hrefOf(f.value)} target="_blank" rel="noreferrer" className="break-all font-semibold text-pool-hi hover:underline">{f.value}</a>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${CONF[f.confidence] ?? CONF.low}`}>{f.confidence}</span>
                      <span className="text-mist/80">{f.why}</span>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-xs text-door-hi">No public page found yet. Follow the next steps below.</p>}
              {res.best_channel && <p className="text-xs"><b className="text-door-hi">⭐ Best way to reach:</b> <span className="text-bone">{res.best_channel}</span></p>}
              {res.approach_points.length > 0 && <div><p className="text-xs font-bold text-bone/80">💬 How to approach</p><ul className="ml-4 list-disc text-xs text-mist">{res.approach_points.map(x => <li key={x}>{x}</li>)}</ul></div>}
              {res.next_steps.length > 0 && <div><p className="text-xs font-bold text-bone/80">👣 Next steps</p><ol className="ml-4 list-decimal text-xs text-mist">{res.next_steps.map(x => <li key={x}>{x}</li>)}</ol></div>}
              {props.onUse && <button type="button" onClick={use} className="rounded-lg bg-door px-3 py-1.5 text-xs font-bold text-night hover:bg-door-hi">➕ Add to Contact and Notes</button>}
            </div>
          )}
        </div>
      )}
      {!props.host && <p className="mb-2 text-xs text-mist/70">Enter the host name to get more search buttons.</p>}
      <div className="flex flex-wrap gap-1.5">
        {links.map(l => <a key={l.label} href={l.url} target="_blank" rel="noreferrer" title={l.hint} className="rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold text-bone transition hover:bg-door/25 hover:text-door-hi">{l.label} ↗</a>)}
      </div>
    </div>
  );
}
