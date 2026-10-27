# Hostly OS: architecture and setup (phase 1)

This is built from the *Hostly OS A-to-Z Blueprint* and the *Hostly OS 2.0 AI-Native Blueprint*. It provides:

- an event-driven core
- an orchestrator with five AI agents
- the L0–L4 autonomy ladder
- an approval queue
- an append-only audit log

Hostly OS is a **standalone app with its own Supabase project**. It shares no code, tables or login with
Ember OS. Connecting the two is a separate, later step, and happens only when the owner asks for it.

## 1. What phase 1 contains

```
PMS / channels / forms ──► POST /api/hostly/events ──► hostly_events (once per source+external_id)
scheduler (cron) ────────► GET  /api/hostly/cron        │
                                                        ▼
                                  orchestrator (src/lib/hostly/engine.ts)
                    sense → gather → decide (rules + Claude) → CHECK (code) → act or ask
                                                        │
             ┌──────────────┬──────────────┬────────────┴──┬──────────────┐
          Field Ops      Outreach       Concierge        Revenue      Exec Copilot
       reservations →   lead score +   guest message   daily price    morning brief
       turnover clean,  first email    triage, drafts  inside owner   (EN + Roman Urdu)
       pre-arrival,     draft          replies,        guardrails
       double-booking                  escalates
             │                                 │
             ▼                                 ▼
   hostly_tasks / incidents          hostly_approvals ──► /hostly command center ──► WhatsApp (Hostly number)
                    every step ──► hostly_automation_runs + hostly_audit_log
```

### Autonomy ladder (blueprint 2.0 §1.3), enforced in code (`policy.ts → gate`)

| Level | Meaning | Starts at |
|---|---|---|
| L0 | Observe: classify, summarise, alert | Exec Copilot brief |
| L1 | Draft: a person approves | Outreach email, guest reply, price change |
| L2 | Act with review | Field Ops tasks |
| L3 | Act within guardrails (min/max price, discount, max step) | — (earned) |
| L4 | Human only | Refunds, complaints, damage, access, contracts, emergencies |

- Owners/admins raise a level in the command center, never above the action's ceiling (`hostly_autonomy.max_level`; human-only actions are capped at L1). Every change is audited.
- `hostly_agent_quality` shows, per agent action over 28 days, how many drafts were approved unchanged, edited or rejected. Raise an action only at ≥ 200 decisions and ≥ 97% unchanged (blueprint §14.5).
- Emergencies are caught by keyword rules **before** any AI call, and the AI can only raise a risk, never lower it.
- An action runs automatically only when two things are true: its level allows it, **and** its integration is connected. For now the only connected integration is WhatsApp guest replies, sent inside Meta's 24-hour window. Outreach emails and price changes are carried out by a person until an email sender and a pricing engine/PMS are connected.

### Reliability
- Same webhook twice → one event (`unique(source, external_id)`); same reservation → one turnover task (`dedupe_key`).
- Out-of-order updates are ignored using the channel's `source_updated_at`.
- Confirmed stays can't overlap on a property (Postgres exclusion constraint); a clash opens a high-severity incident.
- Failed events retry with backoff (30 s → 1 h), then move to dead letters after 6 tries; malformed events go there at once.

## 2. Setup

1. **Supabase:** create a Supabase project just for Hostly OS. Never use the Ember OS project. Run `supabase/migrations/0001_hostly_core.sql` in its SQL editor. Undo with `supabase/rollback/0001_hostly_core_down.sql`.
2. **Vercel:** import this repo as a new project and set the variables in `.env.example`.
3. **Sign in:** open the app and sign in. The first person to sign in becomes the owner, and adds teammates after that.
4. **Schedule:** `vercel.json` runs the daily jobs at 10:00 UTC: a pricing review for each live property, plus the morning brief. To retry failed events every 5 minutes, add this in the Hostly OS Supabase SQL editor:
   ```sql
   select cron.schedule('hostly-agents', '*/5 * * * *', $$
     select net.http_get(url := 'https://<hostly-os-domain>/api/hostly/cron',
       headers := jsonb_build_object('authorization', 'Bearer <CRON_SECRET>'))
   $$);
   ```

## 3. Event contract

`POST /api/hostly/events` — signed with header `x-hostly-signature: sha256=<HMAC-SHA256(body, HOSTLY_WEBHOOK_SECRET)>`, or by a signed-in teammate. One event or `{"events": [...]}` (max 100).

| type | payload |
|---|---|
| `reservation.upsert` | `property_code, channel, external_ref, status (confirmed/cancelled/inquiry/blocked), check_in, check_out, guest_name, guest_count, currency, gross_amount, fees_amount, payout_amount, source_updated_at` |
| `guest.message` | `channel, from, body, property_code?, reservation_ref?, property_facts?` |
| `lead.created` | `lead_id` (use `POST /api/hostly/leads` to create and score a lead in one call) |
| `pricing.review` | `property_code, current_price?` (queued daily by the scheduler) |
| `brief.daily` | `{}` (queued daily by the scheduler) |

## 4. Tests

- `npx playwright test --project=unit` — 14 tests of the agents and the autonomy gate on an in-memory store (no network, no AI).
- `npx playwright test --project=e2e`: the command center and sign-in, with stubbed server answers.
- `scripts/test-db.sh` — applies the migration twice to a throwaway Postgres, checks double booking, idempotent events, retries/dead letters, audit log immutability, autonomy ceilings, KPIs and owner/staff row-level security, then rolls back and re-applies.

## 5. Known limits / next phases

- There is no PMS, pricing engine, email sender, cleaning app or e-signature connected yet, so those actions stop at approval. Next step: pick a PMS (Hostaway, Hospitable or Guesty) and map its webhooks to `reservation.upsert`.
- Inbound WhatsApp needs a webhook on Hostly's own number that turns each message into a `guest.message` event.
- Joining with Ember OS is not built, and is only done when the owner asks for it.
- Owner portal and finance ledger are designed in the schema (client users, RLS) but have no screens yet.
- Agent evals are the approval outcomes for now; a golden test set per agent comes with real traffic.
