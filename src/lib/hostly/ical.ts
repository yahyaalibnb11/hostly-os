// Calendar sync from Airbnb / Vrbo / Booking.com iCal links. Channels only share dates and a uid in
// these feeds (no guest name or price), which is enough to keep the calendar, the turnover cleans and
// double-booking checks right until a PMS or channel API is connected.

export type IcsEvent = { uid: string; start: string; end: string; summary: string };

// Hosts we fetch calendars from. Anything else is refused, so the server never fetches arbitrary URLs.
const CALENDAR_HOSTS = [/(^|\.)airbnb\.(com|ca|co\.uk|com\.au|de|fr|es|it|ie|nl|pt|ch|at|be|ae|co\.in|com\.mx|com\.br|co\.nz)$/, /(^|\.)vrbo\.com$/, /(^|\.)homeaway\.com$/, /(^|\.)booking\.com$/,
  /(^|\.)calendar\.google\.com$/, /(^|\.)hospitable\.com$/, /(^|\.)hostaway\.com$/, /(^|\.)guesty\.com$/,
  /(^|\.)ownerrez\.com$/, /(^|\.)lodgify\.com$/, /(^|\.)smoobu\.com$/];

export function calendarUrlOk(raw: string) {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && CALENDAR_HOSTS.some(re => re.test(u.hostname));
  } catch {
    return false;
  }
}

// YYYYMMDD or YYYYMMDDTHHMMSS(Z) → YYYY-MM-DD.
const icsDate = (v: string) => (/^\d{8}/.test(v) ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}` : "");

export function parseIcs(text: string): IcsEvent[] {
  // Unfold continuation lines (RFC 5545: a line starting with a space or tab continues the previous one).
  const lines = text.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "").split(/\r?\n/);
  const out: IcsEvent[] = [];
  let cur: Partial<IcsEvent> | null = null;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") cur = {};
    else if (line === "END:VEVENT") {
      if (cur?.uid && cur.start && cur.end && cur.end > cur.start) out.push({ uid: cur.uid, start: cur.start, end: cur.end, summary: cur.summary ?? "" });
      cur = null;
    } else if (cur) {
      const i = line.indexOf(":");
      if (i < 0) continue;
      const name = line.slice(0, i).split(";")[0].toUpperCase();
      const value = line.slice(i + 1).trim();
      if (name === "UID") cur.uid = value.slice(0, 180);
      else if (name === "DTSTART") cur.start = icsDate(value);
      else if (name === "DTEND") cur.end = icsDate(value);
      else if (name === "SUMMARY") cur.summary = value.replace(/\\([,;\\])/g, "$1").slice(0, 200);
    }
  }
  return out;
}

// Airbnb marks owner blocks "Airbnb (Not available)"; Vrbo uses "Blocked"; Booking.com "CLOSED - Not available".
export const isBlock = (summary: string) => /not available|blocked|closed|unavailable/i.test(summary);

export type SyncEvent = { source: string; external_id: string; type: "reservation.upsert"; payload: Record<string, unknown> };

// Turns one feed into reservation.upsert events. A stay that disappeared from the feed (and hasn't ended)
// was cancelled on the channel, so it's sent as cancelled. The external ids carry the dates and status,
// so an unchanged feed queues nothing new and a changed stay is processed once.
export function planCalendarSync(opts: {
  propertyCode: string; channel: string; feed: IcsEvent[];
  known: { external_ref: string; status: string; check_in: string; check_out: string }[]; today: string;
}): SyncEvent[] {
  const { propertyCode, channel, feed, known, today } = opts;
  const events: SyncEvent[] = [];
  const seen = new Set<string>();
  for (const e of feed) {
    if (e.end < today) continue;
    seen.add(e.uid);
    const status = isBlock(e.summary) ? "blocked" : "confirmed";
    events.push({
      source: "ical", type: "reservation.upsert",
      external_id: `${propertyCode}:${channel}:${e.uid}:${e.start}:${e.end}:${status}`.slice(0, 200),
      payload: { property_code: propertyCode, channel, external_ref: e.uid, status, check_in: e.start, check_out: e.end },
    });
  }
  for (const k of known) {
    if (seen.has(k.external_ref) || k.check_out < today || (k.status !== "confirmed" && k.status !== "blocked")) continue;
    events.push({
      source: "ical", type: "reservation.upsert",
      external_id: `${propertyCode}:${channel}:${k.external_ref}:${k.check_in}:${k.check_out}:cancelled`.slice(0, 200),
      payload: { property_code: propertyCode, channel, external_ref: k.external_ref, status: "cancelled", check_in: k.check_in, check_out: k.check_out },
    });
  }
  return events;
}
