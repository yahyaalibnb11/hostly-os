import { expect, test, type Page } from "@playwright/test";

// Hostly Scout in a browser, with the server answers stubbed.

const ME = { id: "m1", name: "Aon", is_admin: false, daily_goal: 10 };
const MEMBERS = [{ id: "m0", name: "Yahya", is_admin: true, daily_goal: 10, has_pin: true }, { ...ME, has_pin: true }, { id: "m2", name: "Eassa", is_admin: false, daily_goal: 10, has_pin: true }, { id: "m3", name: "Shahzaib", is_admin: false, daily_goal: 10, has_pin: true }];
const now = new Date().toISOString();
const L = (o: Record<string, unknown>) => ({ link: "https://www.airbnb.com/rooms/1", link_key: "airbnb:1", market: "uk-manchester", currency: "GBP", status: "drafted", problems: [], problem_count: 4, score: 40, grade: "warm", created_at: now, pitch: "Hi Sam,\n\nQuick ideas…", pitch_subject: "Quick ideas", ...o });
const LISTINGS = [
  L({ id: "l1", title: "Cosy 2BR near Old Trafford", host_name: "Sam", added_by: "m2", score: 75, grade: "hot", problem_count: 9 }),
  L({ id: "l2", link: "https://www.airbnb.com/rooms/2", link_key: "airbnb:2", title: "Marbella sea view flat", market: "es-costa-del-sol", currency: "EUR", added_by: "m1" }),
  L({ id: "l3", link: "https://www.airbnb.com/rooms/3", link_key: "airbnb:3", title: "Zillertal chalet", market: "at-tyrol", currency: "EUR", added_by: "m3", score: 20, grade: "cold", status: "new", pitch: "" }),
];

async function open(page: Page) {
  const saved: Record<string, unknown>[] = [];
  await page.route("**/api/scout/data", r => r.fulfill({ json: { me: ME, members: MEMBERS, listings: LISTINGS, ai: false } }));
  await page.route("**/api/scout/check?*", r => {
    const link = new URL(r.request().url()).searchParams.get("link") || "";
    return r.fulfill({ json: link.includes("/rooms/1") ? { key: "airbnb:1", duplicate: { id: "l1", by: "Eassa", at: now, title: "Cosy 2BR near Old Trafford" } } : { key: "airbnb:9", duplicate: null } });
  });
  await page.route("**/api/scout/listings", async r => {
    const b = r.request().postDataJSON();
    saved.push(b);
    await r.fulfill({ json: { listing: { ...b, id: "new1", link_key: "airbnb:9", added_by: "m1", created_at: now, score: 80, grade: "hot", problem_count: 10 } } });
  });
  await page.addInitScript(() => localStorage.setItem("hostly-scout-pass", "test.pass"));
  await page.goto("/scout");
  return saved;
}

test("sign-in shows the team names and a PIN box", async ({ page }) => {
  await page.route("**/api/scout/members", r => r.fulfill({ json: { names: ["Yahya", "Aon", "Eassa", "Shahzaib"] } }));
  await page.route("**/api/scout/login", r => r.fulfill({ status: 401, json: { error: "Wrong name or PIN" } }));
  await page.goto("/scout");
  await page.getByRole("button", { name: "Shahzaib" }).click();
  await page.getByPlaceholder("• • • • • •").fill("111111");
  await expect(page.getByText("Wrong name or PIN")).toBeVisible();
  if (process.env.SCOUT_SHOTS) await page.screenshot({ path: `${process.env.SCOUT_SHOTS}/signin.png` });
});

test("dashboard shows the leaderboard and the hottest leads", async ({ page }) => {
  await open(page);
  await expect(page.getByText("Welcome back")).toBeVisible();
  await expect(page.getByText("Team leaderboard")).toBeVisible();
  await expect(page.getByRole("button", { name: /Cosy 2BR near Old Trafford/ })).toBeVisible();
  if (process.env.SCOUT_SHOTS) { await page.waitForTimeout(1200); await page.screenshot({ path: `${process.env.SCOUT_SHOTS}/dashboard.png`, fullPage: true }); }
});

test("a link already in the sheet is blocked", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: /Add a new listing/ }).click();
  await page.getByPlaceholder("https://www.airbnb.com/rooms/12345678").fill("https://www.airbnb.co.uk/rooms/1?adults=2");
  await expect(page.getByText(/Eassa.*already added this listing/)).toBeVisible();
  await expect(page.getByRole("button", { name: /Save listing/ })).toBeDisabled();
});

test("numbers and ticks build the score, solutions and pitch, then save", async ({ page }) => {
  const saved = await open(page);
  await page.getByRole("button", { name: /Add a new listing/ }).click();
  await page.getByPlaceholder("https://www.airbnb.com/rooms/12345678").fill("https://www.airbnb.com/rooms/9");
  await expect(page.getByText("New listing, carry on")).toBeVisible();
  await page.locator("select").first().selectOption("es-costa-del-sol");
  await page.getByPlaceholder("Sarah").fill("Maria Lopez");
  await page.getByPlaceholder("4.62").fill("4.5");
  await page.getByRole("button", { name: /Dark \/ blurry/ }).click();
  await page.getByRole("button", { name: /Next 30 days mostly empty/ }).click();
  await expect(page.getByRole("button", { name: /⚡ Rating below 4.7/ })).toBeVisible();
  await expect(page.locator("textarea").nth(2)).toHaveValue(/^Hi Maria,/);
  if (process.env.SCOUT_SHOTS) await page.screenshot({ path: `${process.env.SCOUT_SHOTS}/add.png`, fullPage: true });
  await page.getByRole("button", { name: /Save listing/ }).click();
  await expect(page.getByText(/Hot lead! Score 80/)).toBeVisible();
  expect(saved[0]).toMatchObject({ link: "https://www.airbnb.com/rooms/9", market: "es-costa-del-sol", host_name: "Maria Lopez", rating: "4.5", status: "drafted" });
  expect(saved[0].problems).toEqual(["bad_photos", "empty_calendar"]);
});

test("students see only their own listings and can't download", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: /Sheet/ }).first().click();
  await expect(page.getByText("My listings")).toBeVisible();
  await expect(page.getByRole("table").getByText("Marbella sea view flat")).toBeVisible();
  await expect(page.getByRole("table").getByText("Zillertal chalet")).toHaveCount(0);
  await expect(page.getByText("Only Yahya can download")).toBeVisible();
  await expect(page.getByRole("button", { name: /Download Excel/ })).toHaveCount(0);
  await expect(page.getByRole("table").getByTestId("missing")).toContainText("Contact");
  await expect(page.getByTestId("watermark")).toBeAttached();
  await expect(page.getByRole("button", { name: /Leads/ })).toHaveCount(0);
});

test("Yahya sees ready and incomplete leads and downloads them", async ({ page }) => {
  const admin = MEMBERS[0];
  const rows = [{ ...LISTINGS[0], contact: "sam@samstays.co.uk" }, LISTINGS[1], LISTINGS[2]];
  await page.route("**/api/scout/data", r => r.fulfill({ json: { me: admin, members: MEMBERS, listings: rows, ai: false } }));
  await page.addInitScript(() => localStorage.setItem("hostly-scout-pass", "test.pass"));
  await page.goto("/scout");
  await expect(page.getByTestId("watermark")).toHaveCount(0);
  await page.getByRole("button", { name: /Leads/ }).first().click();
  const box = page.getByTestId("admin-leads");
  await expect(box.getByText("sam@samstays.co.uk")).toBeVisible();
  await expect(box.getByText("Marbella sea view flat")).toHaveCount(0);
  const dl = page.waitForEvent("download");
  await page.getByTestId("admin-download").click();
  expect((await dl).suggestedFilename()).toMatch(/^hostly-ready-leads-.*\.csv$/);
  await box.getByRole("button", { name: /Incomplete/ }).first().click();
  await expect(box.getByText("Marbella sea view flat")).toBeVisible();
  await expect(box.getByText(/Missing: Contact/).first()).toBeVisible();
  await page.getByRole("button", { name: /Sheet/ }).first().click();
  await expect(page.getByRole("button", { name: /Download Excel \(3\)/ })).toBeVisible();
});

test("Yahya hands a complete lead to a member and sees the activity log", async ({ page }) => {
  const admin = MEMBERS[0];
  const ready = { ...LISTINGS[0], contact: "sam@samstays.co.uk", assigned_to: null };
  const posted: Record<string, unknown>[] = [];
  await page.route("**/api/scout/data", r => r.fulfill({ json: { me: admin, members: MEMBERS, listings: [ready, LISTINGS[1]], ai: false } }));
  await page.route("**/api/scout/activity", r => r.request().method() === "GET"
    ? r.fulfill({ json: { activity: [{ id: 1, member_id: "m2", action: "open", detail: "", at: now, scout_listings: { title: "Cosy 2BR near Old Trafford" } }, { id: 2, member_id: "m1", action: "sign_in", detail: "", at: now }] } })
    : r.fulfill({ json: { ok: true } }));
  await page.route("**/api/scout/listings", async r => { const b = r.request().postDataJSON(); posted.push(b); await r.fulfill({ json: { listing: { ...ready, assigned_to: b.assigned_to } } }); });
  await page.addInitScript(() => localStorage.setItem("hostly-scout-pass", "test.pass"));
  await page.goto("/scout");
  await page.getByRole("button", { name: /Leads/ }).first().click();
  await expect(page.getByTestId("activity")).toContainText("Eassa");
  await expect(page.getByTestId("activity")).toContainText("opened Cosy 2BR near Old Trafford");
  await page.getByTestId("assign").selectOption("m3");
  await expect(page.getByText("Handed to Shahzaib")).toBeVisible();
  expect(posted[0]).toEqual({ id: "l1", assigned_to: "m3" });
});

test("a student's complete lead shows as locked and can't be removed", async ({ page }) => {
  const mine = { ...LISTINGS[1], contact: "🔒 Handed to Yahya", host_name: "Ana", ready: true, locked: true };
  await page.route("**/api/scout/data", r => r.fulfill({ json: { me: ME, members: MEMBERS, listings: [LISTINGS[0], mine], ai: false } }));
  await page.route("**/api/scout/activity", r => r.fulfill({ json: { ok: true } }));
  await page.addInitScript(() => localStorage.setItem("hostly-scout-pass", "test.pass"));
  await page.goto("/scout");
  await expect(page.getByText("Ranked by complete leads this week")).toBeVisible();
  await page.getByRole("button", { name: /Sheet/ }).first().click();
  await expect(page.getByRole("table").getByTestId("locked")).toBeVisible();
  await expect(page.getByRole("table").getByTitle("Remove")).toHaveCount(0);
});

test("screenshots fill the form with AI", async ({ page }) => {
  await page.route("**/api/scout/scan", async r => {
    const b = r.request().postDataJSON();
    expect(b.images).toHaveLength(2);
    expect(b.images[0].type).toBe("image/jpeg");
    await r.fulfill({ json: { result: {
      platform: "airbnb", listing_id: "55443322", title: "Bright 2BR by the Etihad", host_name: "Priya", host_listings: 2, property_type: "2 BHK", city_or_area: "Manchester",
      market: "uk-manchester", rating: 4.61, reviews: 23, currency: "GBP", weekday_price: 89, weekend_price: 89, min_nights: 3, photos: 14, response_rate: 80,
      managed_by: "self", licence_number: "", description_text: "Run by Priya Stays. Book direct on our site.", business_details: "Priya Stays Ltd, 1 King St, Manchester, Company no. 01234567", host_other_listings: ["Loft · Salford"], findability: { level: "high", reason: "Business details shown" }, contact_clues: ["Brand: Priya Stays", "Mentions own booking site"], problems: ["weak_cover", "boring_title"], other_problems: ["No parking info"], review_praise: ["Clean"], review_complaints: ["Noisy street"],
      photo_quality: "Dark living room photos", summary: "Photos are dark and pricing is flat.", not_visible: ["licence"],
    } } });
  });
  await open(page);
  await page.unroute("**/api/scout/data");
  await page.route("**/api/scout/data", r => r.fulfill({ json: { me: ME, members: MEMBERS, listings: LISTINGS, ai: true } }));
  await page.reload();
  await page.getByRole("button", { name: /Add a new listing/ }).click();
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  await page.getByTestId("scan-files").setInputFiles([{ name: "a.png", mimeType: "image/png", buffer: png }, { name: "b.png", mimeType: "image/png", buffer: png }]);
  await page.getByRole("button", { name: /Scan 2 images/ }).click();
  await expect(page.getByText("Photos are dark")).toBeVisible();
  await expect(page.getByPlaceholder("https://www.airbnb.com/rooms/12345678")).toHaveValue("https://www.airbnb.com/rooms/55443322");
  await expect(page.getByPlaceholder("Sarah")).toHaveValue("Priya");
  await expect(page.getByPlaceholder("Sea view 2BR with pool, 5 min to beach")).toHaveValue("Bright 2BR by the Etihad");
  await expect(page.getByRole("button", { name: /✓ Weak cover photo/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Companies House/ })).toBeVisible();
  await expect(page.getByAltText("Screenshot 1")).toHaveCount(0); // scanner empties after the scan
  await page.route("**/api/scout/contact", async r => {
    const b = r.request().postDataJSON();
    expect(b.host).toBe("Priya");
    expect(b.city).toBe("Manchester");
    expect(b.description).toContain("Priya Stays");
    expect(b.clues).toContain("Brand: Priya Stays");
    expect(b.business).toContain("01234567");
    expect(b.other_listings).toEqual(["Loft · Salford"]);
    expect(b.mode).toBe("quick");
    await r.fulfill({ json: { result: {
      platforms: [{ platform: "airbnb", status: "listed", url: "" }, { platform: "booking", status: "not_found", url: "" }], channel_opportunity: "Only on Airbnb: missing Booking.com guests.",
      key_points: ["Brand name Priya Stays in the description"], tried: [{ method: "Brand name + city", result: "found", detail: "priyastays.co.uk" }, { method: "Licence number", result: "nothing", detail: "No licence shown" }],
      found: [{ kind: "website", value: "https://priyastays.co.uk", confidence: "high", why: "Same photos and title" }, { kind: "instagram", value: "https://instagram.com/priyastays", confidence: "medium", why: "Linked from the website" }],
      owner_name: "Priya Stays Ltd", best_channel: "Email from the website contact page", approach_points: ["Mention her dark living room photos"], next_steps: ["Check Companies House for the director"], summary: "Found her own website.",
    } } });
  });
  await expect(page.getByText("Clues from the scan:")).toBeVisible();
  await expect(page.getByTestId("findability").first()).toContainText("Easy to find");
  await page.getByTestId("ai-contact").click();
  await expect(page.getByTestId("ai-contact-result").getByText("Found her own website.")).toBeVisible();
  await expect(page.getByRole("link", { name: "https://priyastays.co.uk" })).toBeVisible();
  await expect(page.getByText("What the AI tried (2 methods)")).toBeVisible();
  await expect(page.getByTestId("ai-platforms")).toContainText("❌ Booking.com");
  await expect(page.getByText("Only on Airbnb: missing Booking.com guests.")).toBeVisible();
  await page.getByRole("button", { name: /Add to Contact and Notes/ }).click();
  await expect(page.getByPlaceholder("facebook.com/… or email")).toHaveValue("https://priyastays.co.uk , https://instagram.com/priyastays");
  await page.getByRole("button", { name: /Save listing/ }).click();
  await expect(page.getByText("Photos are dark")).toHaveCount(0); // and resets fully after saving
  await expect(page.getByTestId("ai-contact-result")).toHaveCount(0);
  if (process.env.SCOUT_SHOTS) await page.screenshot({ path: `${process.env.SCOUT_SHOTS}/scan.png`, fullPage: true });
});

test("a short recording becomes a few distinct frames for the scan", async ({ page }) => {
  let sent = 0;
  await page.route("**/api/scout/scan", async r => {
    sent = r.request().postDataJSON().images.length;
    await r.fulfill({ json: { result: { title: "Video listing", host_name: "Alain", problems: [], other_problems: [], review_praise: [], review_complaints: [], not_visible: [], summary: "Read from the video." } } });
  });
  await open(page);
  await page.unroute("**/api/scout/data");
  await page.route("**/api/scout/data", r => r.fulfill({ json: { me: ME, members: MEMBERS, listings: LISTINGS, ai: true } }));
  await page.reload();
  await page.getByRole("button", { name: /Add a new listing/ }).click();
  await page.getByTestId("scan-video").setInputFiles("tests/fixtures/scroll.webm");
  await expect(page.getByText(/frames taken from the video/)).toBeVisible({ timeout: 20000 });
  await page.getByRole("button", { name: /Scan \d+ images/ }).click();
  await expect(page.getByText("Read from the video.")).toBeVisible();
  expect(sent).toBeGreaterThanOrEqual(3);
  expect(sent).toBeLessThanOrEqual(5);
  await expect(page.getByPlaceholder("Sarah")).toHaveValue("Alain");
});


test("screenshots upload one by one to storage, then the scan gets only their names", async ({ page }) => {
  const puts: string[] = [];
  let scanBody: Record<string, unknown> = {};
  await page.route("**/api/scout/scan/upload", r => r.fulfill({ json: { uploads: [0, 1].map(i => ({ path: `m1/b/${i}.jpg`, url: `https://store.example/upload/${i}?token=t` })) } }));
  await page.route("https://store.example/**", r => { puts.push(`${r.request().method()} ${r.request().url()}`); return r.fulfill({ json: { Key: "ok" } }); });
  await page.route("**/api/scout/scan", r => { scanBody = r.request().postDataJSON(); return r.fulfill({ json: { result: { title: "Uploaded flat", summary: "Fine.", problems: [], checks: {} } } }); });
  await open(page);
  await page.unroute("**/api/scout/data");
  await page.route("**/api/scout/data", r => r.fulfill({ json: { me: ME, members: MEMBERS, listings: LISTINGS, ai: true } }));
  await page.reload();
  await page.getByRole("button", { name: /Add a new listing/ }).click();
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  await page.getByTestId("scan-files").setInputFiles([{ name: "a.png", mimeType: "image/png", buffer: png }, { name: "b.png", mimeType: "image/png", buffer: png }]);
  await page.getByRole("button", { name: /Scan 2 images/ }).click();
  await expect(page.getByText("Form filled")).toBeVisible();
  expect(puts.sort()).toEqual(["PUT https://store.example/upload/0?token=t", "PUT https://store.example/upload/1?token=t"]);
  expect(scanBody).toEqual({ paths: ["m1/b/0.jpg", "m1/b/1.jpg"] });
});
