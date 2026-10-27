import { cloudReady, env } from "@/lib/server/env";

export const dynamic = "force-dynamic";

// Tells the browser which Supabase project to sign in to. The anon key is public by design;
// row level security protects the data.
export function GET() {
  return Response.json(cloudReady() ? { cloud: true, supabaseUrl: env.supabaseUrl, supabaseAnonKey: env.supabaseAnonKey } : { cloud: false }, { headers: { "cache-control": "no-store" } });
}
