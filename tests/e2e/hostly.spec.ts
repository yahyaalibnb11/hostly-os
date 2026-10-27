import { expect, test, type Page } from "@playwright/test";
/* eslint-disable @typescript-eslint/no-explicit-any */

// The Hostly OS command center, with the server answers stubbed: it signs in to Hostly OS's own Supabase
// project and reads everything from /api/hostly/*.

const SESSION = { access_token: "tok", refresh_token: "r", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: "u1", email: "owner@hostly.pk", aud: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-10-01T00:00:00Z" } };

const OVERVIEW = {
  user: { email: "owner@hostly.pk", role: "owner" },
  connections: { database: true, ai: true, whatsapp: true, email: false, pms: false, pricing_engine: false },
  ready: true,
  kpis: [{ code: "KIS-01", available_nights: 30, booked_nights: 18 }, { code: "KIS-02", available_nights: 30, booked_nights: 12 }],
  approvals: [
    { id: "a1", agent: "concierge", action: "send_guest_reply", level: "L1", title: "Reply to guest at KIS-01: Wifi password", payload: { body: "Hi! The wifi details are on the card by the TV." }, evidence: { guest_message: "what's the wifi?" }, requested_at: "2026-10-27T10:00:00Z" },
    { id: "a2", agent: "revenue", action: "apply_price", level: "L3", title: "KIS-01: nightly price USD 200 → 184 for the next 14 days", payload: { from: 200, to: 184 }, evidence: { rationale: "Next 14 days are 21% booked vs 64% over the last 28 days." }, requested_at: "2026-10-27T06:00:00Z" },
  ],
  runs: [{ id: "r1", agent: "field_ops", level: "L2", status: "success", summary: "KIS-01 airbnb HM1 inserted; turnover scheduled", started_at: "2026-10-27T09:00:00Z" }],
  incidents: [{ id: "i1", severity: "high", category: "calendar_conflict", summary: "Double booking at KIS-02", status: "open", respond_by: "2026-10-27T09:15:00Z" }],
  tasks: [{ id: "t1", kind: "cleaning", title: "Turnover clean · KIS-01 · checkout 2026-11-05", priority: "normal", status: "open", due_at: "2026-11-05T20:00:00Z" }],
  failed_events: [],
  autonomy: [
    { agent: "concierge", action: "send_guest_reply", level: 1, max_level: 3, description: "Send a routine reply to a guest" },
    { agent: "concierge", action: "sensitive_reply", level: 1, max_level: 1, description: "Refunds and complaints (human only)" },
  ],
  quality: [{ agent: "concierge", action: "send_guest_reply", accuracy: 0.96, decided: 50 }],
  pipeline: { new: 4, qualified: 2, contacted: 1 },
};

async function open(page: Page, overview: unknown = OVERVIEW) {
  const posts: { url: string; body: unknown }[] = [];
  await page.route("**/api/config", r => r.fulfill({ json: { cloud: true, supabaseUrl: "https://test.supabase.co", supabaseAnonKey: "anon" } }));
  await page.route("**/api/hostly/overview", r => r.fulfill({ json: overview }));
  await page.route("**/api/hostly/approvals", async r => { posts.push({ url: r.request().url(), body: r.request().postDataJSON() }); await r.fulfill({ json: { status: "executed" } }); });
  await page.route("https://test.supabase.co/**", r => r.fulfill({ json: {} }));
  await page.addInitScript(s => localStorage.setItem("sb-test-auth-token", s), JSON.stringify(SESSION));
  await page.goto("/");
  return posts;
}

test("command center shows the queue, incidents, work and the agent workforce", async ({ page }) => {
  await open(page);
  await expect(page.getByText("Waiting for your OK (2)")).toBeVisible();
  await expect(page.getByText("Nights booked, next 30 days").locator("..")).toContainText("50%");
  await expect(page.getByText("Double booking at KIS-02")).toBeVisible();
  await expect(page.getByText("Turnover clean · KIS-01")).toBeVisible();
  await expect(page.getByText("96% of 50")).toBeVisible();
  if (process.env.HOSTLY_SHOT) await page.screenshot({ path: process.env.HOSTLY_SHOT, fullPage: true });
  // Human-only actions can't be raised above "write a draft".
  await expect(page.locator("tr", { hasText: "Refunds and complaints" }).locator("option")).toHaveText(["Only watch and tell me", "Write a draft, I approve"]);
});

test("approving an edited draft sends the edited text", async ({ page }) => {
  const posts = await open(page);
  const card = page.locator("div.rounded-lg", { hasText: "Wifi password" });
  await card.locator("textarea").fill("Hi! Wifi: HostlyGuest / password on the TV card.");
  await card.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText("Approved and sent.")).toBeVisible();
  expect(posts[0].body).toMatchObject({ id: "a1", decision: "approve", payload: { body: "Hi! Wifi: HostlyGuest / password on the TV card." } });
});

test("signed out, it shows the Hostly OS sign-in", async ({ page }) => {
  await page.route("**/api/config", r => r.fulfill({ json: { cloud: true, supabaseUrl: "https://test.supabase.co", supabaseAnonKey: "anon" } }));
  await page.route("https://test.supabase.co/**", r => r.fulfill({ status: 400, json: { error: "invalid_grant", error_description: "Invalid login credentials" } }));
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  await page.getByPlaceholder("Email").fill("someone@hostly.pk");
  await page.getByPlaceholder("Password").fill("wrong");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Invalid login credentials")).toBeVisible();
});

test("without database keys it says so", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("The database isn't connected")).toBeVisible();
});

test("adding a listing sends its prices and Airbnb calendar link", async ({ page }) => {
  await open(page);
  const saved: unknown[] = [];
  let list: unknown[] = [];
  await page.route("**/api/hostly/properties", async r => {
    if (r.request().method() === "POST") {
      saved.push(r.request().postDataJSON());
      list = [{ id: "p1", code: "LAKE-NONA", name: "Lake Nona Villa", market: "US-FL", city: "Orlando", status: "onboarding", base_price: 180, min_price: 120, max_price: 350, calendar_urls: { airbnb: "https://www.airbnb.com/calendar/ical/1.ics" } }];
      return r.fulfill({ json: { property: list[0] } });
    }
    return r.fulfill({ json: { properties: list } });
  });
  await page.getByRole("button", { name: "Listings" }).click();
  await expect(page.getByText("No listings yet")).toBeVisible();
  await page.getByRole("button", { name: "+ Add listing" }).click();
  await page.getByLabel("Name").fill("Lake Nona Villa");
  await page.getByLabel("Normal").fill("180");
  await page.getByLabel("Lowest").fill("120");
  await page.getByLabel("Highest").fill("350");
  await page.getByLabel("Airbnb calendar link").fill("https://www.airbnb.com/calendar/ical/1.ics");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Listing added.")).toBeVisible();
  await expect(page.getByText("Lake Nona Villa")).toBeVisible();
  expect(saved[0]).toMatchObject({ name: "Lake Nona Villa", base_price: "180", min_price: "120", max_price: "350", calendar_urls: { airbnb: "https://www.airbnb.com/calendar/ical/1.ics" } });
});

test("inbox: paste a guest message, get the helper's reply and mark it sent", async ({ page }) => {
  await open(page);
  const posts: any[] = [];
  let messages: any[] = [];
  await page.route("**/api/hostly/inbox", async r => {
    if (r.request().method() === "POST") {
      const b = r.request().postDataJSON();
      posts.push(b);
      messages = b.action === "new"
        ? [{ id: "m1", property_id: "p1", channel: "airbnb", direction: "in", sender: "Sarah", body: b.body, risk: "routine", draft_reply: "Hi Sarah! Check-in is at 4pm.", status: "awaiting_approval", created_at: "2026-10-27T10:00:00Z" }]
        : [{ ...messages[0], status: "sent" }];
      return r.fulfill({ json: { ok: true } });
    }
    return r.fulfill({ json: { messages, properties: [{ id: "p1", code: "LAKE", name: "Lake Nona Villa" }], open_statuses: ["new", "drafted", "awaiting_approval", "escalated"] } });
  });
  await page.getByRole("button", { name: "Inbox", exact: true }).click();
  await expect(page.getByText("Nothing waiting")).toBeVisible();
  await page.getByLabel("Listing").selectOption("LAKE");
  await page.getByLabel("Guest name").fill("Sarah");
  await page.getByLabel("Guest's message").fill("What time is check-in?");
  await page.getByRole("button", { name: "Get a reply" }).click();
  const reply = page.locator("textarea").first();
  await expect(reply).toHaveValue("Hi Sarah! Check-in is at 4pm.");
  await reply.fill("Hi Sarah! Check-in is at 4pm, see you soon.");
  await page.getByRole("button", { name: "Mark as sent" }).click();
  await expect(page.getByText("Marked as sent.")).toBeVisible();
  expect(posts[0]).toMatchObject({ action: "new", property_code: "LAKE", channel: "airbnb", from: "Sarah", body: "What time is check-in?" });
  expect(posts[1]).toMatchObject({ action: "done", id: "m1", reply: "Hi Sarah! Check-in is at 4pm, see you soon." });
});
