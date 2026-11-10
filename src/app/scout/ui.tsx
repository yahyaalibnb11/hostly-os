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

export function Ring({ value, max = 100, size = 120, stroke = 10, color = "#FFB347", children }: { value: number; max?: number; size?: number; stroke?: number; color?: string; children?: React.ReactNode }) {
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
    const colors = ["#FFB347", "#FFDDA0", "#E8892B", "#E9E4DA", "#46C2B4", "#FFE6B8"];
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
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
};

export const startOfDay = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };
export const startOfWeek = () => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.getTime(); };

export const AVATAR_COLORS = ["from-door-deep to-door", "from-pool-deep to-pool", "from-slate-500 to-slate-300", "from-[#C76B4A] to-[#F2A27E]", "from-[#5A6B8C] to-[#9AA3B2]"];
export function Avatar({ name, i, size = 36 }: { name: string; i: number; size?: number }) {
  return (
    <div className={`flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br font-black text-night ${AVATAR_COLORS[i % AVATAR_COLORS.length]}`} style={{ width: size, height: size, fontSize: size * .42 }}>
      {name.charAt(0).toUpperCase()}
    </div>
  );
}

// Hostly "Open Door" mark: an H that is also a house, with warm light in the door.
export function Logo({ size = 40, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" className={className} role="img" aria-label="Hostly">
      <defs>
        <linearGradient id="scout-door" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FFE6B8" /><stop offset=".55" stopColor="#FFB347" /><stop offset="1" stopColor="#E8892B" />
        </linearGradient>
      </defs>
      <path d="M12 45 L50 14 L88 45" fill="none" stroke="#E9E4DA" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="19" y="47" width="13" height="43" rx="2.5" fill="#E9E4DA" />
      <rect x="68" y="47" width="13" height="43" rx="2.5" fill="#E9E4DA" />
      <rect x="32" y="58" width="36" height="9" fill="#E9E4DA" />
      <rect x="39" y="71" width="22" height="19" rx="2" fill="url(#scout-door)" />
      <rect x="45" y="38" width="10" height="10" rx="1.5" fill="url(#scout-door)" />
    </svg>
  );
}
