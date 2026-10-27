import { createHmac } from "crypto";
import { adminClient, HttpError, requireTeamUser, safeEqual, type TeamUser } from "@/lib/server/auth";
import { env, hostlyReady } from "@/lib/server/env";
import { supabaseStore } from "./supabase-store";

// Shared plumbing for the /api/hostly routes.

export function hostlyStore() {
  if (!hostlyReady()) throw new HttpError(503, "Hostly OS needs its Supabase keys (including SUPABASE_SERVICE_ROLE_KEY) on the server");
  return supabaseStore(adminClient());
}

// Webhooks from a PMS or channel sign the raw body: header x-hostly-signature: sha256=<hex HMAC>.
export function signatureOk(rawBody: string, header: string | null) {
  if (!env.hostlyWebhookSecret || !header) return false;
  const want = "sha256=" + createHmac("sha256", env.hostlyWebhookSecret).update(rawBody).digest("hex");
  return safeEqual(want, header.trim());
}

export function cronOk(req: Request) {
  const got = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  return Boolean(env.cronSecret && got && safeEqual(got, env.cronSecret));
}

export async function requireAdmin(req: Request): Promise<TeamUser> {
  const u = await requireTeamUser(req);
  if (u.role !== "owner" && u.role !== "admin") throw new HttpError(403, "Only an owner or admin can do this");
  return u;
}
