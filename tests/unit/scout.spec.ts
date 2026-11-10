import { expect, test } from "@playwright/test";
import { autoProblems, buildPitch, hasRealContact, leadReadiness, linkKey, scoreListing, solutionsText } from "@/lib/scout/catalog";
import { hashPin, isLocked, pinMatches, visibleTo } from "@/lib/scout/server";
import { CHECKS, marketFromPlace, pricesFromQuotes, problemsFromScan, parseJsonReply, SCAN_SCHEMA, schemaRefused } from "@/lib/scan/listing";
import { contactLinks, pickFrames } from "@/app/scout/scanner";
import { cleanFound, cleanPlatforms, CONTACT_SCHEMA, contactBrief } from "@/lib/scan/contact";

test.describe("scout", () => {
  test("the same listing gives the same key whatever the domain or tracking junk", () => {
    expect(linkKey("https://www.airbnb.co.uk/rooms/12345678?adults=2&check_in=2026-12-01")).toBe("airbnb:12345678");
    expect(linkKey("airbnb.es/rooms/12345678")).toBe("airbnb:12345678");
    expect(linkKey("https://www.airbnb.com/rooms/plus/998877")).toBe("airbnb:998877");
    expect(linkKey("https://www.vrbo.com/1234567?unitId=1")).toBe("vrbo:1234567");
    expect(linkKey("https://www.vrbo.com/1234567ha")).toBe("vrbo:1234567");
    expect(linkKey("https://www.booking.com/hotel/es/sea-view-flat.en-gb.html?aid=1")).toBe("booking:es/sea-view-flat");
    expect(linkKey("https://www.airbnb.com/s/Manchester/homes")).toBeNull();
    expect(linkKey("not a link")).toBeNull();
  });

  test("numbers raise problems on their own, and the score grows with problems", () => {
    const l = { rating: 4.5, reviews: 6, photos: 12, response_rate: 80, weekday_price: 100, weekend_price: 100, min_nights: 3, host_listings: 1, managed_by: "self" };
    expect(autoProblems(l).sort()).toEqual(["few_photos", "few_reviews", "flat_pricing", "high_min_nights", "low_rating", "self_managed", "slow_response", "small_host"].sort());
    const s = scoreListing(l, ["bad_photos", "empty_calendar"], 1);
    expect(s.count).toBe(11);
    expect(s.grade).toBe("hot");
    expect(scoreListing({ rating: 4.95, reviews: 200, photos: 40, response_rate: 100, weekday_price: 100, weekend_price: 140 }, []).score).toBe(0);
    expect(scoreListing({}, ["bad_photos"]).grade).toBe("cold");
    expect(scoreListing({}, ["not_a_problem"]).count).toBe(0);
  });

  test("solutions and the pitch are built from the problems found", () => {
    expect(solutionsText(["few_photos"], "No parking info")).toContain("• Fix: No parking info");
    const p = buildPitch({ host_name: "Sarah Jones", title: "Sea view flat", market: "es-costa-del-sol", problems: ["few_photos", "flat_pricing", "self_managed"], sender: "Aon, Hostly" });
    expect(p.body).toMatch(/^Hi Sarah,/);
    expect(p.body).toContain("Costa del Sol");
    expect(p.body).toContain("1. The listing only shows a few photos");
    expect(p.body).not.toContain("3.");
    expect(p.body.trim().endsWith("Aon, Hostly")).toBe(true);
  });

  test("PINs are stored hashed and checked exactly", () => {
    const h = hashPin("123456");
    expect(h).not.toContain("123456");
    expect(pinMatches("123456", h)).toBe(true);
    expect(pinMatches("123457", h)).toBe(false);
    expect(pinMatches("123456", null)).toBe(false);
  });

  test("the screenshot scanner asks for every field it describes", () => {
    expect([...SCAN_SCHEMA.required].sort()).toEqual(Object.keys(SCAN_SCHEMA.properties).sort());
    expect(SCAN_SCHEMA.properties.problems.items.type).toBe("string");
  });

  test("the scanner falls back to plain JSON when the strict schema is refused", () => {
    expect(schemaRefused("Schema is too complex for compilation.")).toBe(true);
    expect(schemaRefused("messages: image too large")).toBe(false);
    expect(parseJsonReply('{"a":1}')).toEqual({ a: 1 });
    expect(parseJsonReply('Here it is:\n```json\n{"a":{"b":2}}\n```')).toEqual({ a: { b: 2 } });
    expect(() => parseJsonReply("no json")).toThrow();
  });

  test("the scanner judges every non-number problem and turns verdicts into ticks", () => {
    expect(Object.keys(SCAN_SCHEMA.properties.checks.properties).sort()).toEqual(Object.keys(CHECKS).sort());
    for (const id of ["empty_calendar", "price_off", "high_cleaning_fee", "no_instant_book", "far_owner", "weak_company", "no_licence", "bad_photos", "weak_cover", "boring_title", "weak_description"]) expect(CHECKS[id]).toBeTruthy();
    const v = (verdict: string) => ({ verdict, why: "" });
    const r = problemsFromScan({ problems: ["bad_photos"], checks: { boring_title: v("yes"), bad_photos: v("no"), far_owner: v("not_visible") }, open_nights_next_30: 22, cleaning_fee: 60, weekday_price: 100, instant_book: "off", market: "uk-manchester", licence_number: "" });
    expect(r.sort()).toEqual(["boring_title", "empty_calendar", "high_cleaning_fee", "no_instant_book"]);
    expect(problemsFromScan({ checks: { no_licence: v("yes") }, market: "uk-manchester" })).toEqual([]);
    expect(problemsFromScan({ checks: { no_licence: v("yes") }, market: "es-alicante" })).toEqual(["no_licence"]);
    expect(problemsFromScan({ checks: { no_licence: v("yes") }, market: "es-alicante", licence_number: "VUT-1" })).toEqual([]);
    expect(problemsFromScan({ open_nights_next_30: 5, cleaning_fee: 20, weekday_price: 100, instant_book: "on", checks: { no_instant_book: v("yes") } })).toEqual([]);
  });

  test("contact search links use the host, city and market", () => {
    const uk = contactLinks({ host: "Sarah", market: "uk-manchester", title: "Cosy 2BR", licence: "" });
    expect(uk.map(l => l.label)).toEqual(expect.arrayContaining(["Google: host + city", "Facebook", "Companies House", "Title on Google", "Google Lens"]));
    expect(decodeURIComponent(uk[0].url)).toContain('"Sarah" Manchester');
    const es = contactLinks({ host: "Ana", market: "es-costa-del-sol", licence: "VUT/MA/12345" });
    expect(es.some(l => l.label === "Companies House")).toBe(false);
    expect(es.some(l => decodeURIComponent(l.url).includes('"VUT/MA/12345"'))).toBe(true);
    expect(contactLinks({}).map(l => l.label)).toEqual(["Google Lens"]);
  });

  test("video frames: repeats are dropped and the rest thinned to the limit", () => {
    const f = (v: number) => ({ sig: new Uint8Array(576).fill(v), v });
    const frames = [f(10), f(11), f(12), f(100), f(101), f(200), f(30), f(30)];
    expect(pickFrames(frames, 20).map(x => x.v)).toEqual([10, 100, 200, 30]);
    const many = Array.from({ length: 40 }, (_, i) => f((i * 37) % 256));
    expect(pickFrames(many, 20)).toHaveLength(20);
  });

  test("weekday and weekend prices come from the real calendar dates", () => {
    // 12 Nov 2026 is a Thursday, 13 a Friday, 14 a Saturday.
    expect(pricesFromQuotes([{ check_in: "2026-11-10", check_out: "2026-11-11", nights: 1, total: 70 }, { check_in: "2026-11-13", check_out: "2026-11-15", nights: 2, total: 190 }]))
      .toEqual({ weekday: 70, weekend: 95, mixed: null });
    expect(pricesFromQuotes([{ check_in: "2026-11-12", check_out: "2026-11-14", nights: 2, total: 146 }])).toEqual({ weekday: null, weekend: null, mixed: 73 });
    expect(pricesFromQuotes([{ check_in: "", check_out: "", nights: 2, total: 146 }]).mixed).toBe(73);
  });

  test("the market is found from the city when the AI leaves it empty", () => {
    expect(marketFromPlace("Room in Manchester, United Kingdom")).toBe("uk-manchester");
    expect(marketFromPlace("Marbella, Andalusia")).toBe("es-costa-del-sol");
    expect(marketFromPlace("Mayrhofen, Zillertal")).toBe("at-tyrol");
    expect(marketFromPlace("Somewhere else")).toBe("");
  });

  test("contact finder keeps only real links, emails and phones, and never the Airbnb listing", () => {
    expect(CONTACT_SCHEMA.required).toEqual(expect.arrayContaining(["found", "approach_points", "next_steps"]));
    const f = cleanFound([
      { kind: "website", value: "https://priyastays.co.uk", confidence: "high", why: "" },
      { kind: "website", value: "https://priyastays.co.uk", confidence: "high", why: "dupe" },
      { kind: "email", value: "hello@priyastays.co.uk", confidence: "medium", why: "" },
      { kind: "phone", value: "+44 161 555 0100", confidence: "low", why: "" },
      { kind: "other", value: "https://www.airbnb.co.uk/rooms/123", confidence: "high", why: "" },
      { kind: "other", value: "javascript:alert(1)", confidence: "high", why: "" },
      { kind: "other", value: "not a link", confidence: "high", why: "" },
    ]);
    expect(f.map(x => x.value)).toEqual(["https://priyastays.co.uk", "hello@priyastays.co.uk", "+44 161 555 0100"]);
    const brief = contactBrief({ host: "Priya", city: "Manchester", title: "", insights: ["Lives in Leeds", ""] });
    expect(brief).toBe("Host name: Priya\nCity / area: Manchester\nAbout the host: Lives in Leeds");
    expect(contactBrief({ title: "Loft", clues: ["Brand: Casa Sol"], description: "Book  direct\n at casasol.es" })).toBe("Listing title: Loft\nClues seen on the listing: Brand: Casa Sol\nListing description: Book direct at casasol.es");
    expect(CONTACT_SCHEMA.required).toEqual(expect.arrayContaining(["key_points", "tried"]));
    const pl = cleanPlatforms([{ platform: "booking", status: "listed", url: "https://booking.com/x" }, { platform: "myspace", status: "listed", url: "" }, { platform: "vrbo", status: "maybe", url: "javascript:x" }]);
    expect(pl.map(p => p.platform)).toEqual(["airbnb", "vrbo", "booking", "expedia", "tripadvisor", "google_vacation_rentals", "direct_site"]);
    expect(pl[2]).toEqual({ platform: "booking", status: "listed", url: "https://booking.com/x" });
    expect(pl[1]).toEqual({ platform: "vrbo", status: "unsure", url: "" });
    expect(SCAN_SCHEMA.required).toEqual(expect.arrayContaining(["description_text", "contact_clues", "business_details", "host_other_listings", "findability"]));
    expect(contactBrief({ host: "Ana", business: "Casa Sol SL, B12345678", other_listings: ["Loft · Málaga"] })).toBe("Host name: Ana\nBusiness details on the listing: Casa Sol SL, B12345678\nHost's other listings: Loft · Málaga");
  });
});

test("a lead is ready only with a real contact, host name, problems and a pitch", () => {
  expect(hasRealContact("sam@stays.co.uk")).toBe(true);
  expect(hasRealContact("+44 7700 900123")).toBe(true);
  expect(hasRealContact("samstays.com")).toBe(true);
  expect(hasRealContact("not found")).toBe(false);
  expect(hasRealContact("")).toBe(false);
  const full = { contact: "https://facebook.com/samstays", host_name: "Sam", problem_count: 3, pitch: "Hi Sam" };
  expect(leadReadiness(full)).toEqual({ complete: true, missing: [] });
  expect(leadReadiness({ ...full, contact: "none yet", pitch: "" }).missing).toEqual(["Contact", "Pitch"]);
});

test("students only get the score fields of teammates' listings", () => {
  const row = { id: "l1", added_by: "m2", market: "uk-manchester", score: 70, grade: "hot", status: "new", problem_count: 5, created_at: "x", link: "https://airbnb.com/rooms/1", contact: "a@b.com", host_name: "Sam", title: "Flat", pitch: "Hi" };
  const student = { id: "m1", name: "Aon", is_admin: false, daily_goal: 10 };
  const shared = visibleTo(student, row);
  expect(shared).not.toHaveProperty("contact");
  expect(shared).not.toHaveProperty("link");
  expect(shared).not.toHaveProperty("title");
  expect(shared).toMatchObject({ score: 70, added_by: "m2" });
  expect(shared).toHaveProperty("ready", true);
  expect(visibleTo({ ...student, is_admin: true }, row)).toHaveProperty("contact", "a@b.com");
});

test("a complete lead is locked for the student who found it, open for the assigned member", () => {
  const row = { id: "l1", added_by: "m2", assigned_to: null as string | null, contact: "a@b.com", host_name: "Sam", problem_count: 3, pitch: "Hi", notes: "Owner: Sam" };
  const owner = { id: "m2", name: "Eassa", is_admin: false, daily_goal: 10 };
  const locked = visibleTo(owner, row);
  expect(locked).toMatchObject({ locked: true, contact: "🔒 Handed to Yahya", notes: "" });
  expect(isLocked(row)).toBe(true);
  expect(visibleTo(owner, { ...row, contact: "" })).toMatchObject({ contact: "", ready: false });
  expect(visibleTo(owner, { ...row, contact: "" })).not.toHaveProperty("locked");
  expect(visibleTo({ ...owner, id: "m3" }, { ...row, assigned_to: "m3" })).toHaveProperty("contact", "a@b.com");
});
