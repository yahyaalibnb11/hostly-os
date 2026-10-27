import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { timingSafeEqual } from "crypto";
import { env } from "./env";

let admin: SupabaseClient | null = null;
// Service-role client: bypasses row level security. Server code only.
export function adminClient(): SupabaseClient {
  if (!admin) admin = createClient(env.supabaseUrl, env.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  return admin;
}

let anon: SupabaseClient | null = null;
function publicClient(): SupabaseClient {
  if (!anon) anon = createClient(env.supabaseUrl, env.supabaseAnonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  return anon;
}

export type TeamUser = { email: string; role: "owner" | "admin" | "member" };

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

// Checks the caller's Supabase session (Bearer token) and that their email is on the Hostly staff list.
export async function requireTeamUser(req: Request): Promise<TeamUser> {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) throw new HttpError(401, "Sign in first");
  // Check the session with the public key, so a wrong server key can't look like an expired sign-in.
  const { data, error } = await publicClient().auth.getUser(token);
  const email = data?.user?.email?.toLowerCase();
  if (error || !email) throw new HttpError(401, "Your sign-in expired. Sign in again.");
  const { data: row, error: staffError } = await adminClient().from("hostly_staff").select("role").eq("email", email).maybeSingle();
  if (staffError) throw new HttpError(500, "The server key is wrong. In Vercel, set SUPABASE_SERVICE_ROLE_KEY to the service_role key of the Hostly OS Supabase project, then redeploy.");
  if (!row) throw new HttpError(403, "Your email isn't on the Hostly OS staff list");
  return { email, role: row.role };
}

export function errorResponse(e: unknown) {
  if (e instanceof HttpError) return Response.json({ error: e.message }, { status: e.status });
  console.error(e);
  return Response.json({ error: "Something went wrong on the server" }, { status: 500 });
}
