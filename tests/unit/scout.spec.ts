import { expect, test } from "@playwright/test";
import { autoProblems, buildPitch, linkKey, scoreListing, solutionsText } from "@/lib/scout/catalog";
import { hashPin, pinMatches } from "@/lib/scout/server";

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
});
