import { adminClient, errorResponse, HttpError } from "@/lib/server/auth";
import { hostlyReady } from "@/lib/server/env";

export const dynamic = "force-dynamic";

// Names only, for the sign-in screen.
export async function GET() {
  try {
    if (!hostlyReady()) throw new HttpError(503, "Database connect nahi hai");
    const { data, error } = await adminClient().from("scout_members").select("name").order("created_at");
    if (error) throw new HttpError(500, error.message);
    return Response.json({ names: (data ?? []).map(r => r.name) }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}
