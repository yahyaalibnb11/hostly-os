import { adminClient, errorResponse, HttpError, requireTeamUser } from "@/lib/server/auth";
import { syncCalendars } from "@/lib/hostly/calendar-sync";
import { processBatch } from "@/lib/hostly/engine";
import { serverExecutors } from "@/lib/hostly/executors";
import { hostlyStore, requireAdmin } from "@/lib/hostly/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// The next 6 weeks of stays and blocks for every listing, plus cleaning tasks.
export async function GET(req: Request) {
  try {
    await requireTeamUser(req);
    const db = adminClient();
    const from = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const to = new Date(Date.now() + 42 * 86400000).toISOString().slice(0, 10);
    const [props, stays, tasks] = await Promise.all([
      db.from("hostly_properties").select("id, code, name, calendar_urls, calendar_synced_at, calendar_error").neq("status", "offboarded").order("name"),
      db.from("hostly_reservations").select("id, property_id, channel, status, guest_name, check_in, check_out").in("status", ["confirmed", "blocked"]).lt("check_in", to).gt("check_out", from),
      db.from("hostly_tasks").select("id, property_id, kind, title, due_at, status").in("status", ["open", "in_progress"]).lt("due_at", `${to}T23:59:59Z`).order("due_at").limit(200),
    ]);
    const err = [props, stays, tasks].find(r => r.error)?.error;
    if (err) throw new HttpError(500, err.message);
    return Response.json({ from, to, properties: props.data, stays: stays.data, tasks: tasks.data }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}

// "Sync now": pull every listing's channel calendars and let Field Ops process the changes.
export async function POST(req: Request) {
  try {
    await requireAdmin(req);
    const store = hostlyStore();
    const sync = await syncCalendars(adminClient(), store);
    const report = await processBatch(store, { limit: 100, executors: serverExecutors() });
    return Response.json({ sync, report });
  } catch (e) {
    return errorResponse(e);
  }
}
