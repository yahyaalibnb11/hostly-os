import { errorResponse, HttpError } from "@/lib/server/auth";
import { pinOk, signIn } from "@/lib/scout/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const b = (await req.json().catch(() => ({}))) as { name?: unknown; pin?: unknown };
    if (typeof b.name !== "string" || !b.name.trim()) throw new HttpError(400, "Apna naam chuno");
    if (!pinOk(b.pin)) throw new HttpError(400, "PIN 6 digits ka hai");
    return Response.json({ token: await signIn(b.name.trim(), b.pin) });
  } catch (e) {
    return errorResponse(e);
  }
}
