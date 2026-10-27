import type { SupabaseClient } from "@supabase/supabase-js";
import { calendarUrlOk, parseIcs, planCalendarSync } from "./ical";
import type { HostlyStore } from "./store";

// Server side of the iCal sync: fetch each listing's channel calendars and queue reservation.upsert
// events. The Field Ops agent then saves the stays, books turnover cleans and catches double bookings.

const MAX_BYTES = 2_000_000;

async function fetchIcs(url: string) {
  const res = await fetch(url, { signal: AbortSignal.timeout(15000), redirect: "follow", headers: { accept: "text/calendar" } });
  if (!res.ok) throw new Error(`calendar link answered ${res.status}`);
  const text = await res.text();
  if (text.length > MAX_BYTES) throw new Error("calendar is too large");
  if (!text.includes("BEGIN:VCALENDAR")) throw new Error("this link is not a calendar (.ics) link");
  return text;
}

export async function syncCalendars(db: SupabaseClient, store: HostlyStore, today = new Date().toISOString().slice(0, 10)) {
  const { data: props, error } = await db.from("hostly_properties").select("id, code, calendar_urls").neq("status", "offboarded");
  if (error) throw new Error(`listings: ${error.message}`);
  const report: { property: string; channel: string; queued: number; error?: string }[] = [];
  for (const p of props ?? []) {
    const urls = (p.calendar_urls ?? {}) as Record<string, string>;
    const errors: string[] = [];
    for (const [channel, url] of Object.entries(urls)) {
      if (!url) continue;
      try {
        if (!calendarUrlOk(url)) throw new Error("only Airbnb, Vrbo, Booking.com and similar calendar links are allowed");
        const feed = parseIcs(await fetchIcs(url));
        const { data: known, error: kErr } = await db.from("hostly_reservations").select("external_ref, status, check_in, check_out")
          .eq("property_id", p.id).eq("channel", channel).gte("check_out", today);
        if (kErr) throw new Error(kErr.message);
        let queued = 0;
        for (const ev of planCalendarSync({ propertyCode: p.code, channel, feed, known: known ?? [], today })) {
          const r = await store.insertEvent(ev);
          if (!r.duplicate) queued++;
        }
        report.push({ property: p.code, channel, queued });
      } catch (e) {
        const msg = (e as Error).message;
        errors.push(`${channel}: ${msg}`);
        report.push({ property: p.code, channel, queued: 0, error: msg });
      }
    }
    if (Object.keys(urls).length) {
      await db.from("hostly_properties").update({ calendar_synced_at: new Date().toISOString(), calendar_error: errors.join("; ") || null }).eq("id", p.id);
    }
  }
  return report;
}
