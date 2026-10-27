# Hostly OS

The AI-native operating system for Hostly's short-term rental co-hosting business. It is based on the
*Hostly OS A-to-Z Blueprint* and the *Hostly OS 2.0 AI-Native Blueprint*.

- **Event bus:** PMS, channel and form events arrive at `/api/hostly/events`. Each event is stored once, retried with backoff, and dead-lettered if it keeps failing.
- **Five AI agents (Claude):**
  - **Field Ops:** turnover cleans, pre-arrival checks and double-booking alerts.
  - **Outreach:** lead scoring and first-email drafts.
  - **Concierge:** guest message triage and reply drafts, with emergencies escalated before any AI call.
  - **Revenue:** price suggestions kept inside the owner's guardrails.
  - **Exec Copilot:** a morning brief in English and Roman Urdu.
- **Autonomy ladder L0–L4:** every outbound action starts as a draft that a person approves. An action is raised to automatic only after it earns it (≥ 97% approved unchanged over 200 decisions). Refunds, complaints, damage, access and emergencies always stay with a person.
- **Command center** at `/`: approval queue, incidents, due work, agent workforce and quality, leads and agent activity.
- **Postgres safety:** no double bookings, no duplicate events or tasks, an append-only audit log, and row-level security (staff see everything, owners see only their own properties).

Hostly OS is standalone. It has its own repo, its own Supabase project and its own login, and shares nothing with Ember OS.

## Run

```bash
npm ci
cp .env.example .env.local   # fill in the Hostly OS Supabase project and keys
npm run dev
```

## Check

```bash
npm run check                                           # lint, types, build, unit + browser tests
PGHOST=... PGPORT=... PGUSER=... npm run test:db        # migration against a throwaway Postgres
```

Setup, event contract and roadmap: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
