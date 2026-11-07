"use client";

import { useEffect, useRef, useState } from "react";

// Small animated building blocks for Hostly Scout.

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Api = (path: string, opts?: { body?: unknown; method?: string }) => Promise<any>;
export type Member = { id: string; name: string; is_admin: boolean; daily_goal: number; has_pin?: boolean };
export type Listing = Record<string, any> & { id: string; link: string; market: string; score: number; grade: "hot" | "warm" | "cold"; status: string; added_by: string; created_at: string };

const reduced = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export function CountUp({ value, duration = 900 }: { value: number; duration?: number }) {
  const [shown, setShown] = useState(reduced() ? value : 0);
  const from = useRef(0);
  useEffect(() => {
    if (reduced()) { setShown(value); return; }
    const start = performance.now(), a = from.current;
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / duration);
      const v = Math.round(a + (value - a) * (1 - Math.pow(1 - p, 3)));
      setShown(v);
      if (p < 1) raf = requestAnimationFrame(tick); else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return <>{shown.toLocaleString()}</>;
}

export function Ring({ value, max = 100, size = 120, stroke = 10, color = "#f97316", children }: { value: number; max?: number; size?: number; stroke?: number; color?: string; children?: React.ReactNode }) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, max ? value / max : 0));
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(255,255,255,.08)" strokeWidth={stroke} fill="none" />
        <circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={stroke} fill="none" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - pct)} style={{ transition: "stroke-dashoffset 1s cubic-bezier(.2,.8,.2,1), stroke .4s" }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">{children}</div>
    </div>
  );
}

// A burst of confetti when a listing is saved or a deal is won.
export function useConfetti() {
  return (big = false) => {
    if (reduced() || typeof document === "undefined") return;
    const cv = document.createElement("canvas");
    cv.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:60";
    cv.width = innerWidth; cv.height = innerHeight;
    document.body.appendChild(cv);
    const ctx = cv.getContext("2d")!;
    const colors = ["#f97316", "#fde68a", "#e29a64", "#34d399", "#818cf8", "#f472b6"];
    const parts = Array.from({ length: big ? 220 : 110 }, () => ({
      x: innerWidth / 2 + (Math.random() - .5) * 200, y: innerHeight * .55,
      vx: (Math.random() - .5) * 16, vy: -Math.random() * 18 - 6, s: Math.random() * 7 + 4,
      r: Math.random() * 6, vr: (Math.random() - .5) * .4, c: colors[Math.floor(Math.random() * colors.length)],
    }));
    let frame = 0;
    const draw = () => {
      ctx.clearRect(0, 0, cv.width, cv.height);
      for (const p of parts) {
        p.vy += .5; p.x += p.vx; p.y += p.vy; p.r += p.vr; p.vx *= .99;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c; ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); ctx.restore();
      }
      if (++frame < 140) requestAnimationFrame(draw); else cv.remove();
    };
    draw();
  };
}

export function Toast({ msg, kind, onDone }: { msg: string; kind: "ok" | "err"; onDone: () => void }) {
  useEffect(() => { const t = setTimeout(onDone, kind === "err" ? 6000 : 3500); return () => clearTimeout(t); }, [msg, kind, onDone]);
  return (
    <div role="status" className={`scout-toast fixed bottom-6 left-1/2 z-50 max-w-[92vw] rounded-2xl px-5 py-3 text-sm font-semibold shadow-2xl ${kind === "ok" ? "bg-emerald-500 text-emerald-950" : "bg-red-500 text-white"}`}>
      {msg}
    </div>
  );
}

export function Card({ children, className = "", delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  return <section className={`scout-card scout-rise p-4 md:p-5 ${className}`} style={{ animationDelay: `${delay}ms` }}>{children}</section>;
}

export const H = ({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) => (
  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
    <h2 className="text-base font-extrabold tracking-tight">{children}</h2>
    {right}
  </div>
);

export const ago = (s: string) => {
  const m = Math.round((Date.now() - new Date(s).getTime()) / 60000);
  if (m < 1) return "abhi";
  if (m < 60) return `${m} min pehle`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} ghante pehle`;
  const d = Math.round(h / 24);
  return d === 1 ? "kal" : `${d} din pehle`;
};

export const startOfDay = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };
export const startOfWeek = () => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.getTime(); };

export const AVATAR_COLORS = ["from-orange-500 to-amber-400", "from-indigo-500 to-sky-400", "from-emerald-500 to-teal-400", "from-pink-500 to-rose-400", "from-violet-500 to-fuchsia-400"];
export function Avatar({ name, i, size = 36 }: { name: string; i: number; size?: number }) {
  return (
    <div className={`flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br font-black text-white ${AVATAR_COLORS[i % AVATAR_COLORS.length]}`} style={{ width: size, height: size, fontSize: size * .42 }}>
      {name.charAt(0).toUpperCase()}
    </div>
  );
}
