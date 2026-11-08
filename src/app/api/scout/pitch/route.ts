import { errorResponse, HttpError } from "@/lib/server/auth";
import { askClaude } from "@/lib/hostly/ai";
import { marketById, problemById } from "@/lib/scout/catalog";
import { requireScout } from "@/lib/scout/server";

export const dynamic = "force-dynamic";

const SCHEMA = {
  type: "object",
  properties: {
    subject: { type: "string", description: "Email subject under 60 characters, no clickbait" },
    body: { type: "string", description: "First message to the host in plain, warm English, under 150 words" },
  },
  required: ["subject", "body"],
  additionalProperties: false,
};

// Optional: Claude rewrites the pitch from what the student found. Without an AI key the template pitch is used.
export async function POST(req: Request) {
  try {
    const me = await requireScout(req);
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const s = (k: string, max = 300) => (typeof b[k] === "string" ? (b[k] as string).slice(0, max) : "");
    const problems = (Array.isArray(b.problems) ? b.problems : []).map(id => problemById(String(id))).filter(Boolean).map(p => ({ problem: p!.pitch || p!.label, fix: p!.solution }));
    const r = await askClaude<{ subject: string; body: string }>({
      copilot: "Outreach pitch writer",
      instructions: "Write a first co-hosting outreach message to a short-term rental host, from a member of the Hostly team. Mention at most 3 of the problems found, kindly and specifically, as easy wins rather than criticism. Offer the free offer given. Do not claim results, revenue numbers, or a portfolio size that is not in the input. Do not mention Airbnb messaging. End with the sender's name.",
      input: { host_first_name: s("host_name").split(" ")[0], listing_title: s("title"), market: marketById(s("market", 40))?.name, property_type: s("property_type"), problems, custom_problems: s("custom_problems", 1500), offer: s("offer"), sender: `${me.name}, Hostly` },
      schema: SCHEMA,
      maxTokens: 1500,
    });
    if (!r) throw new HttpError(503, "AI isn't connected yet. Use the template draft.");
    return Response.json(r.data);
  } catch (e) {
    return errorResponse(e);
  }
}
