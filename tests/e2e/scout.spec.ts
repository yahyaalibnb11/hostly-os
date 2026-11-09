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

test("the sheet filters and downloads", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: /Sheet/ }).first().click();
  await expect(page.getByRole("table").getByText("Zillertal chalet")).toBeVisible();
  await page.locator("select").first().selectOption("Spain");
  await expect(page.getByRole("table").getByText("Zillertal chalet")).toHaveCount(0);
  const dl = page.waitForEvent("download");
  await page.getByRole("button", { name: /Download Excel \(1\)/ }).click();
  expect((await dl).suggestedFilename()).toMatch(/^hostly-scout-.*\.csv$/);
});

test("screenshots fill the form with AI", async ({ page }) => {
  await page.route("**/api/scout/scan", async r => {
    const b = r.request().postDataJSON();
    expect(b.images).toHaveLength(2);
    expect(b.images[0].type).toBe("image/jpeg");
    await r.fulfill({ json: { result: {
      platform: "airbnb", listing_id: "55443322", title: "Bright 2BR by the Etihad", host_name: "Priya", host_listings: 2, property_type: "2 BHK", city_or_area: "Manchester",
      market: "uk-manchester", rating: 4.61, reviews: 23, currency: "GBP", weekday_price: 89, weekend_price: 89, min_nights: 3, photos: 14, response_rate: 80,
      managed_by: "self", licence_number: "", problems: ["weak_cover", "boring_title"], other_problems: ["No parking info"], review_praise: ["Clean"], review_complaints: ["Noisy street"],
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
    await r.fulfill({ json: { result: {
      found: [{ kind: "website", value: "https://priyastays.co.uk", confidence: "high", why: "Same photos and title" }, { kind: "instagram", value: "https://instagram.com/priyastays", confidence: "medium", why: "Linked from the website" }],
      owner_name: "Priya Stays Ltd", best_channel: "Email from the website contact page", approach_points: ["Mention her dark living room photos"], next_steps: ["Check Companies House for the director"], summary: "Found her own website.",
    } } });
  });
  await page.getByTestId("ai-contact").click();
  await expect(page.getByTestId("ai-contact-result").getByText("Found her own website.")).toBeVisible();
  await expect(page.getByRole("link", { name: "https://priyastays.co.uk" })).toBeVisible();
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

