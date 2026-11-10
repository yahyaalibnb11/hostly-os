import { errorResponse, HttpError } from "@/lib/server/auth";
import { pinOk, signIn } from "@/lib/scout/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const b = (await req.json().catch(() => ({}))) as { name?: unknown; pin?: unknown };
    if (typeof b.name !== "string" || !b.name.trim()) throw new HttpError(400, "Pick your name");
    if (!pinOk(b.pin)) throw new HttpError(400, "Your PIN has 6 digits");
    return Response.json({ token: await signIn(b.name.trim(), b.pin) });
  } catch (e) {
    return errorResponse(e);
  }
}
