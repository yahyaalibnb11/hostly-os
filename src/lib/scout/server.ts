import { createHmac, randomBytes, scryptSync } from "crypto";
import { adminClient, HttpError, safeEqual } from "@/lib/server/auth";
import { env, hostlyReady } from "@/lib/server/env";

// Hostly Scout sign-in: each team member picks their name and types a 6-digit PIN.
// The server checks the PIN against a scrypt hash and hands back a signed pass (valid 30 days).
// Scout members are separate from Hostly OS staff, so they never see the listings or guests in Hostly OS.

export type ScoutMember = { id: string; name: string; is_admin: boolean; daily_goal: number };

export const LISTING_COLS = "id, link, link_key, market, host_name, host_listings, property_type, title, rating, reviews, currency, weekday_price, weekend_price, min_nights, photos, response_rate, managed_by, licence_number, problems, custom_problems, problem_count, solutions, score, grade, pitch_subject, pitch, status, contact, notes, added_by, created_at, updated_at";

const DAY = 86_400_000;
const PASS_DAYS = 30;
const MAX_TRIES = 5;
const LOCK_MINUTES = 15;

function secret() {
  if (!hostlyReady()) throw new HttpError(503, "Scout needs the Supabase keys on the server");
  return createHmac("sha256", env.serviceRoleKey).update("hostly-scout-pass-v1").digest();
}

export function hashPin(pin: string) {
  const salt = randomBytes(16).toString("hex");
  return `scrypt$${salt}$${scryptSync(pin, salt, 32).toString("hex")}`;
}

export function pinMatches(pin: string, stored: string | null) {
  if (!stored) return false;
  const [kind, salt, hash] = stored.split("$");
  if (kind !== "scrypt" || !salt || !hash) return false;
  return safeEqual(scryptSync(pin, salt, 32).toString("hex"), hash);
}

export const pinOk = (pin: unknown): pin is string => typeof pin === "string" && /^\d{6}$/.test(pin);

export function makePass(memberId: string) {
  const body = Buffer.from(JSON.stringify({ m: memberId, e: Date.now() + PASS_DAYS * DAY })).toString("base64url");
  return `${body}.${createHmac("sha256", secret()).update(body).digest("base64url")}`;
}

export async function requireScout(req: Request): Promise<ScoutMember> {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const [body, sig] = token.split(".");
  if (!body || !sig || !safeEqual(createHmac("sha256", secret()).update(body).digest("base64url"), sig)) throw new HttpError(401, "Please sign in");
  let p: { m?: string; e?: number };
  try { p = JSON.parse(Buffer.from(body, "base64url").toString()); } catch { throw new HttpError(401, "Please sign in"); }
  if (!p.m || !p.e || p.e < Date.now()) throw new HttpError(401, "Your sign-in expired. Please sign in again");
  const { data, error } = await adminClient().from("scout_members").select("id, name, is_admin, daily_goal").eq("id", p.m).maybeSingle();
  if (error) throw new HttpError(500, error.message);
  if (!data) throw new HttpError(401, "This member is no longer on the team");
  return data as ScoutMember;
}

export async function signIn(name: string, pin: string) {
  const db = adminClient();
  const { data: m, error } = await db.from("scout_members").select("id, pin_hash, failed_attempts, locked_until").eq("name", name).maybeSingle();
  if (error) throw new HttpError(500, error.message);
  if (!m) throw new HttpError(401, "Wrong name or PIN");
  if (m.locked_until && new Date(m.locked_until).getTime() > Date.now()) throw new HttpError(429, `Too many wrong PINs. Try again in ${LOCK_MINUTES} minutes.`);
  if (!m.pin_hash) throw new HttpError(403, "Your PIN isn't set yet. Ask Yahya for one.");
  if (!pinMatches(pin, m.pin_hash)) {
    const tries = (m.failed_attempts ?? 0) + 1;
    await db.from("scout_members").update(tries >= MAX_TRIES ? { failed_attempts: 0, locked_until: new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString() } : { failed_attempts: tries }).eq("id", m.id);
    throw new HttpError(401, "Wrong name or PIN");
  }
  await db.from("scout_members").update({ failed_attempts: 0, locked_until: null }).eq("id", m.id);
  return makePass(m.id);
}
