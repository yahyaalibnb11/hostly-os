import { adminClient, errorResponse, HttpError } from "@/lib/server/auth";
import { linkKey } from "@/lib/scout/catalog";
import { requireScout } from "@/lib/scout/server";

export const dynamic = "force-dynamic";

// Is this listing link already in the sheet? Answers while the student is still typing.
export async function GET(req: Request) {
  try {
    const me = await requireScout(req);
    const link = new URL(req.url).searchParams.get("link") || "";
    const key = linkKey(link);
    if (!key) return Response.json({ key: null, duplicate: null });
    const { data, error } = await adminClient().from("scout_listings").select("id, title, created_at, added_by, scout_members(name)").eq("link_key", key).is("deleted_at", null).maybeSingle();
    if (error) throw new HttpError(500, error.message);
    const by = (data?.scout_members as unknown as { name?: string } | null)?.name ?? "";
    return Response.json({ key, duplicate: data ? { id: data.id, title: me.is_admin || data.added_by === me.id ? data.title : "", at: data.created_at, by } : null });
  } catch (e) {
    return errorResponse(e);
  }
}
