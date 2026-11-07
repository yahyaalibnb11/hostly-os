// Hostly Scout: the shared rules for listing research. Used by both the browser and the server,
// so the score a student sees while typing is the same score the server saves.

export type Market = { id: string; country: string; flag: string; name: string; areas: string; currency: string; licence: string; note: string };

export const MARKETS: Market[] = [
  { id: "uk-manchester", country: "UK", flag: "🇬🇧", name: "Manchester", areas: "City centre, Salford, Old Trafford", currency: "GBP", licence: "England: no licence yet (registration expected from March 2027)", note: "Football, concerts, business trips. Hostly already works here." },
  { id: "uk-liverpool", country: "UK", flag: "🇬🇧", name: "Liverpool", areas: "City centre, Baltic Triangle, Anfield", currency: "GBP", licence: "England: no licence yet", note: "Events and cheaper properties, good returns for owners." },
  { id: "uk-luton", country: "UK", flag: "🇬🇧", name: "Luton", areas: "Near the airport, town centre", currency: "GBP", licence: "England: no licence yet", note: "Airport travellers and contractors. Hostly already works here." },
  { id: "uk-leeds", country: "UK", flag: "🇬🇧", name: "Leeds", areas: "City centre, Headingley", currency: "GBP", licence: "England: no licence yet", note: "Universities, events, contractor stays." },
  { id: "es-costa-del-sol", country: "Spain", flag: "🇪🇸", name: "Costa del Sol", areas: "Marbella, Fuengirola, Benalmádena, Estepona", currency: "EUR", licence: "Andalusia: VFT number must be on the listing", note: "Sun all year, many licensed flats, many UK owners." },
  { id: "es-alicante", country: "Spain", flag: "🇪🇸", name: "Alicante coast", areas: "Benidorm, Torrevieja, Altea", currency: "EUR", licence: "Valencia region: VUT number must be on the listing", note: "Busy all year. Owners often live far away, so they need a co-host." },
  { id: "es-canary", country: "Spain", flag: "🇪🇸", name: "Canary Islands", areas: "Tenerife south, Gran Canaria", currency: "EUR", licence: "Canary: VV number; new flats are hard, target already licensed ones", note: "Winter peak, demand all year." },
  { id: "es-madrid", country: "Spain", flag: "🇪🇸", name: "Madrid", areas: "Outside the strict centre, mid-term stays", currency: "EUR", licence: "Madrid: VUT number; new tourist flats in the centre are very hard", note: "Big demand. Mid-term (1-11 months) is a large market here." },
  { id: "at-tyrol", country: "Austria", flag: "🇦🇹", name: "Tyrol ski", areas: "Zillertal, Ötztal, St. Anton, Kitzbühel", currency: "EUR", licence: "Register with the province; check building rules", note: "Full from December to April, summer hiking too. Owners often live in Germany or Vienna." },
  { id: "at-vienna", country: "Austria", flag: "🇦🇹", name: "Vienna", areas: "Non-residential zones only", currency: "EUR", licence: "Residential zones are banned without a permit; max 90 nights a year elsewhere", note: "Tourists all year; mix with mid-term (expats, UN staff, students)." },
  { id: "at-salzburg", country: "Austria", flag: "🇦🇹", name: "Salzburg", areas: "Zell am See, the lakes, the city", currency: "EUR", licence: "Register with the province", note: "Busy in both summer and winter." },
  { id: "pt-algarve", country: "Europe", flag: "🇵🇹", name: "Algarve (Portugal)", areas: "Albufeira, Lagos, Vilamoura", currency: "EUR", licence: "Portugal: AL number must be on the listing", note: "Tourists all year." },
  { id: "pt-madeira", country: "Europe", flag: "🇵🇹", name: "Madeira (Portugal)", areas: "Funchal, Calheta", currency: "EUR", licence: "Portugal: AL number must be on the listing", note: "Mild weather all year." },
  { id: "hr-coast", country: "Europe", flag: "🇭🇷", name: "Croatia coast", areas: "Split, Dubrovnik, Istria, Zadar", currency: "EUR", licence: "Local registration and tourist tax", note: "Huge demand, season of 5-6 months." },
  { id: "gr-islands", country: "Europe", flag: "🇬🇷", name: "Greek islands", areas: "Crete, Santorini, Rhodes, Corfu", currency: "EUR", licence: "Greece: AMA registration number on the listing", note: "Strong summer demand." },
  { id: "pl-krakow", country: "Europe", flag: "🇵🇱", name: "Kraków", areas: "Old Town, Kazimierz", currency: "PLN", licence: "Rules are getting stricter; check the building", note: "Good tourism all year." },
  { id: "cz-prague", country: "Europe", flag: "🇨🇿", name: "Prague", areas: "Old Town, Vinohrady, Žižkov", currency: "CZK", licence: "Rules are getting stricter; check registration", note: "Good tourism all year." },
  { id: "other", country: "Other", flag: "🌍", name: "Other place", areas: "Write the city in the notes", currency: "EUR", licence: "Check local rules", note: "" },
];
export const marketById = (id: string) => MARKETS.find(m => m.id === id);
export const COUNTRIES = ["UK", "Spain", "Austria", "Europe", "Other"];

export const PROPERTY_TYPES = ["Apartment", "Studio", "1 BHK", "2 BHK", "3 BHK", "4+ BHK", "Home", "Villa", "Cabin", "Chalet", "Resort", "Other"];
export const MANAGED_BY = [
  { id: "self", label: "Host khud (self-managed)" },
  { id: "cohost", label: "Co-host ke saath" },
  { id: "company", label: "Management company" },
  { id: "unknown", label: "Pata nahi" },
];
export const STATUSES = [
  { id: "new", label: "Naya", color: "bg-stone-600" },
  { id: "drafted", label: "Draft tayyar", color: "bg-sky-700" },
  { id: "contacted", label: "Message bheja", color: "bg-indigo-600" },
  { id: "replied", label: "Jawab aaya", color: "bg-amber-600" },
  { id: "call", label: "Call booked", color: "bg-orange-600" },
  { id: "won", label: "Deal ho gayi 🎉", color: "bg-emerald-600" },
  { id: "lost", label: "Interest nahi", color: "bg-red-800" },
];

export type ListingInput = {
  rating?: number | null; reviews?: number | null; photos?: number | null; response_rate?: number | null;
  weekday_price?: number | null; weekend_price?: number | null; min_nights?: number | null;
  host_listings?: number | null; managed_by?: string | null; market?: string | null; licence_number?: string | null;
};

export type Problem = {
  id: string; group: "photos" | "reviews" | "pricing" | "host" | "rules";
  label: string; hint: string; points: number; solution: string; pitch: string;
  auto?: (l: ListingInput) => boolean;
};

const num = (v: unknown) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

// Each problem: what the student sees (Roman Urdu), how many points, the fix, and one English line for the pitch.
export const PROBLEMS: Problem[] = [
  { id: "few_photos", group: "photos", label: "20 se kam photos", hint: "Photos ginti karo", points: 2, solution: "Professional shoot with 25-35 photos covering every room and the best features.", pitch: "the listing only shows a few photos, so guests can't picture the stay", auto: l => { const p = num(l.photos); return p !== null && p < 20; } },
  { id: "bad_photos", group: "photos", label: "Photos andheri / dhundli / phone wali", hint: "Guest ki nazar se dekho", points: 3, solution: "Bright, wide-angle professional photos taken in daylight.", pitch: "the photos are dark and don't do the place justice" },
  { id: "weak_cover", group: "photos", label: "Cover photo kamzor", hint: "Pehli photo mein best hissa nahi", points: 1, solution: "Lead with the strongest image (pool, view, living room) to lift clicks.", pitch: "the first photo isn't the strongest one, which costs clicks in search" },
  { id: "boring_title", group: "photos", label: "Title boring / generic", hint: "Koi selling point nahi", points: 1, solution: "Rewrite the title with the top selling points (location, view, sleeps X).", pitch: "the title doesn't say what makes the place special" },
  { id: "weak_description", group: "photos", label: "Description adhoori", hint: "Amenities, parking, check-in info missing", points: 1, solution: "Full description: highlights first, then rooms, amenities, parking and check-in.", pitch: "the description leaves out details guests look for" },
  { id: "low_rating", group: "reviews", label: "Rating 4.7 se kam", hint: "Auto: rating dalo", points: 2, solution: "Fix the repeated issues, improve cleaning and guest communication to lift the rating.", pitch: "the rating is below 4.7, which pushes the listing down in search", auto: l => { const r = num(l.rating); return r !== null && r > 0 && r < 4.7; } },
  { id: "few_reviews", group: "reviews", label: "10 se kam reviews", hint: "Auto: reviews dalo", points: 1, solution: "Launch pricing and a review follow-up routine to build social proof fast.", pitch: "there are only a few reviews, so new guests hesitate to book", auto: l => { const r = num(l.reviews); return r !== null && r < 10; } },
  { id: "repeat_complaint", group: "reviews", label: "Reviews mein ek hi shikayat bar bar", hint: "Safai, check-in, reply late", points: 2, solution: "Fix the root cause (cleaning checklist, self check-in, clear guide) and reply to every review.", pitch: "a few reviews mention the same issue, which is easy to fix" },
  { id: "slow_response", group: "reviews", label: "Response rate 90% se kam", hint: "Auto: response rate dalo", points: 1, solution: "Replies within 1 hour, 24/7, with saved replies and a guest guide.", pitch: "the response rate is low, and Airbnb ranks slow hosts lower", auto: l => { const r = num(l.response_rate); return r !== null && r < 90; } },
  { id: "no_badge", group: "reviews", label: "Superhost / Guest Favourite nahi", hint: "Badge check karo", points: 1, solution: "Hit Superhost targets: 4.8+ rating, 90%+ response, no cancellations.", pitch: "the listing doesn't have a Superhost or Guest Favourite badge yet" },
  { id: "flat_pricing", group: "pricing", label: "Weekend aur weekday price same", hint: "Auto: dono price dalo", points: 2, solution: "Dynamic pricing with higher weekend and event rates.", pitch: "weekend and weekday prices are the same, so weekend money is left on the table", auto: l => { const a = num(l.weekday_price), b = num(l.weekend_price); return a !== null && b !== null && a > 0 && b <= a; } },
  { id: "empty_calendar", group: "pricing", label: "Agle 30 din aadhe se zyada khaali", hint: "Calendar check karo", points: 3, solution: "Re-price against comps and fill gaps with smart discounts.", pitch: "the next 30 days look mostly empty while similar homes nearby are booked" },
  { id: "price_off", group: "pricing", label: "Price comps se bohat upar / neeche", hint: "5-10 milti julti listings se compare", points: 2, solution: "Set prices from 5-10 comparable listings and review weekly.", pitch: "the nightly price is far from similar homes nearby" },
  { id: "high_min_nights", group: "pricing", label: "Minimum nights 3 ya zyada", hint: "Auto: min nights dalo", points: 1, solution: "Shorter minimum stays on weekdays and for gap nights.", pitch: "the minimum stay is long, which blocks many short bookings", auto: l => { const n = num(l.min_nights); return n !== null && n >= 3; } },
  { id: "high_cleaning_fee", group: "pricing", label: "Cleaning fee zyada", hint: "Total price mehngi lagti hai", points: 1, solution: "Balance the cleaning fee and nightly rate so the total looks competitive.", pitch: "the cleaning fee makes the total price look high" },
  { id: "no_instant_book", group: "pricing", label: "Instant Book band", hint: "Listing pe check karo", points: 1, solution: "Turn on Instant Book with sensible guest requirements.", pitch: "Instant Book is off, and many guests filter for it" },
  { id: "self_managed", group: "host", label: "Host khud manage kar raha hai", hint: "Auto: managed by = self", points: 2, solution: "Full co-hosting: guest messages, cleaning, pricing and reviews handled for them.", pitch: "", auto: l => l.managed_by === "self" },
  { id: "small_host", group: "host", label: "Host ki sirf 1-3 listings", hint: "Auto: number of properties dalo", points: 1, solution: "Hands-off service so a busy owner gets time back.", pitch: "", auto: l => { const n = num(l.host_listings); return n !== null && n >= 1 && n <= 3; } },
  { id: "weak_company", group: "host", label: "Kamzor company ke paas", hint: "Company ki baaqi listings ke reviews bure", points: 2, solution: "Show a clear plan and better numbers than the current manager.", pitch: "" },
  { id: "far_owner", group: "host", label: "Owner door rehta hai", hint: "Doosra sheher / mulk", points: 2, solution: "Local on-the-ground team for check-ins, cleaning and repairs.", pitch: "" },
  { id: "no_licence", group: "rules", label: "Licence number listing pe nahi", hint: "Spain/Portugal/Greece mein zaroori", points: 1, solution: "Help with licence display and guest registration paperwork.", pitch: "the licence number isn't shown on the listing, which platforms now require" },
];
export const problemById = (id: string) => PROBLEMS.find(p => p.id === id);
export const PROBLEM_GROUPS: { id: Problem["group"]; label: string }[] = [
  { id: "photos", label: "📸 Photos aur listing" },
  { id: "reviews", label: "⭐ Reviews aur guests" },
  { id: "pricing", label: "💰 Price aur calendar" },
  { id: "host", label: "👤 Host ki situation" },
  { id: "rules", label: "📜 Rules" },
];

const MAX_POINTS = 20; // a listing with ~20 points of problems is as good a lead as it gets

// Which problems the numbers already prove, without the student ticking anything.
export const autoProblems = (l: ListingInput) => PROBLEMS.filter(p => p.auto?.(l)).map(p => p.id);

export function scoreListing(l: ListingInput, picked: string[], customCount = 0) {
  const ids = Array.from(new Set([...picked.filter(id => problemById(id)), ...autoProblems(l)]));
  const points = ids.reduce((a, id) => a + (problemById(id)?.points ?? 0), 0) + customCount;
  const score = Math.min(100, Math.round((points / MAX_POINTS) * 100));
  const grade = score >= 60 ? "hot" : score >= 35 ? "warm" : "cold";
  return { ids, count: ids.length + customCount, points, score, grade } as const;
}

export const GRADE = {
  hot: { label: "🔥 Garam lead", text: "Aaj hi message karo", ring: "#f97316" },
  warm: { label: "☀️ Achha lead", text: "Personal message bhejo", ring: "#eab308" },
  cold: { label: "❄️ Thanda lead", text: "Short message, zyada time nahi", ring: "#64748b" },
};

export const solutionsText = (ids: string[], custom: string) =>
  [...ids.map(id => problemById(id)?.solution).filter(Boolean).map(s => `• ${s}`), ...custom.split("\n").map(s => s.trim()).filter(Boolean).map(s => `• Fix: ${s}`)].join("\n");

// One link = one listing. Turns any Airbnb/Vrbo/Booking link into a short key, so the same listing
// can't be added twice even with a different country domain or tracking junk.
export function linkKey(raw: string): string | null {
  let u: URL;
  try { u = new URL(raw.trim().startsWith("http") ? raw.trim() : `https://${raw.trim()}`); } catch { return null; }
  const host = u.hostname.toLowerCase().replace(/^(www|m)\./, "");
  const path = u.pathname.replace(/\/+$/, "").toLowerCase();
  if (/(^|\.)airbnb\./.test(host)) {
    const m = path.match(/\/rooms\/(?:plus\/|luxury\/)?(\d+)/) || path.match(/\/h\/([a-z0-9-]+)/);
    return m ? `airbnb:${m[1]}` : null;
  }
  if (/(^|\.)(vrbo|homeaway|abritel|fewo-direkt|stayz|bookabach)\./.test(host)) {
    const m = path.match(/\/(\d+)(?:ha)?(?:$|\/)/) || path.match(/\/p(\d+)/);
    return m ? `vrbo:${m[1]}` : null;
  }
  if (/(^|\.)booking\./.test(host)) {
    const m = path.match(/\/hotel\/([a-z]{2})\/([^/.]+)/);
    return m ? `booking:${m[1]}/${m[2]}` : null;
  }
  if (!host.includes(".")) return null;
  return `${host}${path}`;
}

export type PitchInput = {
  host_name?: string; title?: string; market?: string; problems: string[]; custom_problems?: string;
  sender?: string; offer?: string;
};

export const OFFERS = [
  "a free listing review with 5 quick fixes",
  "a free Listing Makeover plan (photos, title and pricing)",
  "a free pricing check against similar homes nearby",
];

// A first message in plain English, built only from what the student found. They edit it before sending.
export function buildPitch(p: PitchInput) {
  const first = (p.host_name || "").trim().split(/\s+/)[0] || "there";
  const m = marketById(p.market || "");
  const place = m && m.id !== "other" ? m.name.replace(/ \(.*\)$/, "") : "your area";
  const lines = p.problems.map(id => problemById(id)?.pitch).filter((s): s is string => Boolean(s));
  const custom = (p.custom_problems || "").split("\n").map(s => s.trim()).filter(Boolean);
  const points = [...lines, ...custom].slice(0, 3);
  const listing = (p.title || "").trim() ? `"${p.title!.trim()}"` : "your place";
  const body = [
    `Hi ${first},`,
    "",
    `I came across ${listing} in ${place} and really like it. I run a short-term rental co-hosting team (Hostly), so a few quick things stood out to me:`,
    "",
    ...(points.length ? points.map((s, i) => `${i + 1}. ${s.charAt(0).toUpperCase()}${s.slice(1)}.`) : ["1. [write the biggest problem you found]"]),
    "",
    `These are all fixable, and similar homes in ${place} are earning more because of exactly these details.`,
    "",
    `I'd be happy to send you ${p.offer || OFFERS[0]}, no strings attached. Would that be useful?`,
    "",
    "Best,",
    p.sender || "[Your name], Hostly",
  ].join("\n");
  return { subject: `Quick ideas for ${listing === "your place" ? "your listing" : listing}`.slice(0, 80), body };
}

export const DAILY_GOAL_DEFAULT = 10;
