import { adminClient, errorResponse, HttpError, requireTeamUser } from "@/lib/server/auth";
import { requireAdmin } from "@/lib/hostly/server";

export const dynamic = "force-dynamic";

// The staff list: everyone on it can sign in to Hostly OS. Owners/admins add and remove teammates;
// the owner seat can't be changed here.
export async function GET(req: Request) {
  try {
    await requireTeamUser(req);
    const { data, error } = await adminClient().from("hostly_staff").select("email, role, added_by, added_at").order("added_at");
    if (error) throw error;
    return Response.json({ staff: data });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireAdmin(req);
    const b = (await req.json().catch(() => ({}))) as { email?: string; role?: string; remove?: boolean };
    const email = String(b.email || "").trim().toLowerCase();
    if (!/^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/.test(email)) throw new HttpError(400, "Enter a valid email");
    const db = adminClient();
    const { data: row } = await db.from("hostly_staff").select("role").eq("email", email).maybeSingle();
    if (row?.role === "owner") throw new HttpError(403, "The owner seat can't be changed here");
    if (b.remove) {
      const { error } = await db.from("hostly_staff").delete().eq("email", email);
      if (error) throw error;
      return Response.json({ ok: true, removed: email });
    }
    const role = b.role === "admin" ? "admin" : "member";
    if (role === "admin" && user.role !== "owner") throw new HttpError(403, "Only the owner can add admins");
    const { error } = await db.from("hostly_staff").upsert({ email, role, added_by: user.email });
    if (error) throw error;
    return Response.json({ ok: true, email, role });
  } catch (e) {
    return errorResponse(e);
  }
}
