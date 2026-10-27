import { adminClient } from "@/lib/server/auth";
import { env, whatsappReady } from "@/lib/server/env";
import type { Executors } from "./engine";

// The integrations that carry out approved (or auto-approved) agent actions. Each reports "not ready"
// until its keys are set; the action then stays with a person. Nothing here runs without the autonomy
// gate or a human approval.

async function graphPost(path: string, body: unknown) {
  const res = await fetch(`https://graph.facebook.com/${env.metaGraphVersion}/${path}`, {
    method: "POST", headers: { authorization: `Bearer ${env.whatsappToken}`, "content-type": "application/json" }, body: JSON.stringify(body),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j?.error?.message || `WhatsApp error ${res.status}`);
  return j;
}

export const serverExecutors = (): Executors => ({
  // Guest replies on Hostly's own WhatsApp number, only inside Meta's 24-hour customer-service window.
  send_guest_reply: {
    ready: whatsappReady,
    async run(p) {
      if (p.channel !== "whatsapp") throw new Error(`Replies on ${String(p.channel || "this channel")} are sent by a person for now`);
      const to = String(p.to || "").replace(/\D/g, ""), text = String(p.body || "").trim();
      if (!to || !text) throw new Error("Missing recipient or text");
      const db = adminClient();
      const since = new Date(Date.now() - 24 * 3600e3).toISOString();
      const { count } = await db.from("hostly_messages").select("id", { count: "exact", head: true })
        .eq("channel", "whatsapp").eq("direction", "in").eq("sender", to).gte("created_at", since);
      if (!count) throw new Error("The 24-hour WhatsApp window is closed");
      const r = await graphPost(`${env.whatsappPhoneId}/messages`, { messaging_product: "whatsapp", to, type: "text", text: { body: text, preview_url: false } });
      const id = r.messages?.[0]?.id;
      if (!id) throw new Error("Meta didn't return a message id");
      await db.from("hostly_messages").insert({ channel: "whatsapp", direction: "out", sender: to, body: text, status: "sent", reservation_id: null });
      if (p.message_id) await db.from("hostly_messages").update({ status: "sent" }).eq("id", p.message_id);
      return { sent: true, whatsapp_message_id: id };
    },
  },
  // Not connected yet: Hostly's own email sender (for outreach) and a PMS/pricing engine (for prices).
  // Until then, approved items are carried out by a person.
  send_outreach: { ready: () => false, run: async () => ({}) },
  apply_price: { ready: () => false, run: async () => ({}) },
});
