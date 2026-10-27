// Server settings, read from environment variables (Vercel → Project → Settings → Environment Variables).
// Hostly OS has its own Supabase project; there are no built-in defaults, so it can't point at another app's data.
export const env = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "",
  serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
  anthropicKey: process.env.ANTHROPIC_API_KEY || "",
  anthropicModel: process.env.ANTHROPIC_MODEL || "claude-opus-5-5",
  hostlyWebhookSecret: process.env.HOSTLY_WEBHOOK_SECRET || "",
  cronSecret: process.env.CRON_SECRET || "",
  whatsappToken: process.env.WHATSAPP_TOKEN || "",
  whatsappPhoneId: process.env.WHATSAPP_PHONE_NUMBER_ID || "",
  metaGraphVersion: process.env.META_GRAPH_VERSION || "v23.0",
};

export const cloudReady = () => Boolean(env.supabaseUrl && env.supabaseAnonKey);
export const hostlyReady = () => Boolean(cloudReady() && env.serviceRoleKey);
export const aiReady = () => Boolean(env.anthropicKey);
export const whatsappReady = () => Boolean(hostlyReady() && env.whatsappToken && env.whatsappPhoneId);
