---
name: iris-de-mer-fork-design
created: 2026-05-29
status: awaiting-review
---

# Iris de Mer (Aire de Mer) — Backend Fork Design

This spec describes the in-place fork of the current `/Uncommon/` repo into the new client's
deployment, using Convrse (`/whole/convrse/`) as a backend architecture reference. The
feature set is the existing Uncommon AI guest agent **minus** Turno integration, **plus**
the cleaning checklist feature discussed in the 2026-05-28 Google Meet.

The work is in-place on this repo — there is no remaining live deployment for the previous
client that this would disrupt.

## 1. Infrastructure pointers (already set)

| Resource | Old | New |
|---|---|---|
| Supabase project ref | rhlgykevbgwvuqhxbdda | bxjdrbktiycmdrozjpgw |
| Trigger.dev project ref | proj_ddpyopnnzmjfxgbpwqnt | proj_ofggmqipbwsuiltgqlej |
| Webhook ingress | Modal `webhook.py` (Python) | Supabase Edge Function `hospitable-webhook` (TypeScript) — Modal is fully eliminated |

All three env-var and MCP changes are already applied. The Trigger.dev `trigger.config.ts`
points at the new project ref. The Supabase MCP launcher and `.env` files (root + dashboard)
all point at the new project. The three secrets (`SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `VITE_SUPABASE_ANON_KEY`) still need to be pulled from the new
Supabase project and pasted into `.env` files — these come from the project dashboard
Settings → API page.

### 1a. SMS provider

The existing Uncommon code uses **SMSAPI** (`SMSAPI_TOKEN`, `SMSAPI_SENDER_NAME`). The
meeting transcript casually referenced "Twilio" but the chosen approval flow is
**link-based** (cleaner/host clicks a URL, not replies to the SMS), so we don't need
two-way SMS — outbound-only SMSAPI continues to work. The spec keeps SMSAPI. If the
client specifically requires Twilio, switching is a one-file change in
`backend/trigger/helpers/sms.ts`.

### 1b. Webhook ingress — Supabase Edge Function (replaces Modal)

**Modal is eliminated.** The Python `webhook.py` is replaced by a new Supabase Edge
Function `hospitable-webhook` at
`https://bxjdrbktiycmdrozjpgw.supabase.co/functions/v1/hospitable-webhook`.

The edge function is deployed with `verify_jwt = false` in `supabase/config.toml` so
Hospitable can POST without authentication. It:

1. Reads the JSON body.
2. Routes by `data.action`:
   - `message.created` → POST to Trigger.dev task `main-agent-workflow`
   - `reservation.created` → POST to Trigger.dev task `reservation-webhook`
   - anything else → return `{ status: "ignored" }` with 200 OK so Hospitable doesn't retry.
3. Forwards the payload to Trigger.dev via the REST API, using `TRIGGER_SECRET_KEY` from
   Supabase secrets.
4. Returns `{ status: "ok", trigger_run_id }` on success or `{ status: "error", detail }`
   on failure.

Signature verification (Hospitable's `X-Hospitable-Signature` header) is not implemented in
the first cut — the security model is URL secrecy plus payload-shape validation. If
Hospitable docs confirm the signature format, signature check is a follow-up that
re-uses the same `_shared/tokens.ts` helper.

Removed files: `webhook.py`. Removed dependency: Modal account, `modal` python package.
Removed env var: none (TRIGGER_SECRET_KEY now lives in Supabase function secrets).

## 2. Backend reorganization

Move `/src/` to `/backend/` and split along Convrse lines:

```
backend/
  trigger/
    flows/
      reservation-webhook.ts          [NEW]
    messaging/
      main-agent.ts                   [MOVED from src/trigger/main-agent.ts]
    helpers/
      hospitable.ts                   [MOVED from src/lib/]
      sms.ts                          [MOVED from src/lib/]
      supabase.ts                     [MOVED from src/lib/]
      similarity.ts                   [MOVED from src/lib/]
      tokens.ts                       [NEW — signed-token gen/verify for public pages]
    property-sync.ts                  [MOVED from src/trigger/]
    keep-alive.ts                     [MOVED from src/trigger/]
    task-ids.ts                       [NEW — constants registry]
  supabase/
    migrations/
      20260529000000_baseline.sql     [NEW — formalize existing schema]
      20260529000100_checklist.sql    [NEW — checklist tables]
      20260529000200_reservations.sql [NEW — reservations cache]
      20260529000300_sms_extras.sql   [NEW — extras-approval token table]
      20260529000400_sms_recipients_extras.sql [NEW — adds receives_extras column]
    functions/
      _shared/
        cors.ts
        supabase.ts
        tokens.ts                     [signed-token verify]
        html.ts                       [HTML response helpers]
      hospitable-webhook/index.ts     [public POST — routes to Trigger.dev, replaces Modal]
      checklist-resolve/index.ts      [public POST — load checklist by token]
      checklist-mark-item/index.ts    [public POST — toggle item]
      extras-resolve/index.ts         [public POST — load extra request by token]
      extras-respond/index.ts         [public POST — record yes/no, fire callback]
```

The old `/src/lib/turno.ts` is deleted (no Turno integration in this client). The old
`scripts/populate-kb.ts` stays where it is.

The dashboard at `/dashboard/` stays where it is; we add pages, no restructure.

## 3. Database schema

### 3a. Tables to formalize as migrations (existing UI expects these fields)

The baseline migration `20260529000000_baseline.sql` re-creates the existing schema from
scratch in the new Supabase project. Every column listed below is read or written by the
existing dashboard pages, so the baseline must include them all.

| Table | Columns required by current UI | Read by |
|---|---|---|
| `properties` | `id, name, hospitable_property_uuid, is_active` | `PropertiesKB.tsx` |
| `knowledge_bases` | `id, property_id, title, content, category, video_url, image_url` | `PropertiesKB.tsx`, agent KB lookup |
| `kb_gap_log` | `id, property_id, guest_question, reservation_uuid, created_at` | `PropertiesKB.tsx` health stats |
| `cooldowns` | `id, property_id, activated_at, expires_at, reason, is_active, reservation_uuid` | `PropertiesKB.tsx` per-property cooldown widget |
| `maintenance_tickets` | `id, property_id, description, urgency, status, guest_context, reservation_uuid, created_at` | `Tickets.tsx` |
| `extra_requests` | `id, property_id, reservation_uuid, item_requested, status, created_at` | `AgentConfig.tsx` declined list |
| `sms_recipients` | `id, name, phone, receives_maintenance_low, receives_maintenance_medium, receives_maintenance_high, receives_kb_gaps, receives_checkin_checkout, is_active` | `SmsRecipients.tsx` |
| `urgency_categories` | `id, level, description, examples, response_time` | `AgentConfig.tsx` urgency tab, agent classifier |
| `allowed_extras` | `id, item_name, is_active` | `AgentConfig.tsx` extras tab, agent matcher |
| `agent_activity_log` | `id, property_id, reservation_uuid, action_type, created_at` | `Overview.tsx` activity dashboard |
| `profiles` (auth extension) | `id, email, role, can_view_kb, can_view_maintenance` | `Layout.tsx` auth gate, `Users.tsx` |

Turno-specific columns (`properties.turno_property_id`, `properties.turno_alias`,
`extra_requests.turno_project_id`) are **dropped** from the schema. The dashboard
`Property` interface in `PropertiesKB.tsx` is edited to remove these fields and the
display of "Turno alias" in the property header.

### 3b. New tables — cleaning checklist

```sql
-- 20260529000100_checklist.sql
create table checklist_templates (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id) on delete cascade,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (property_id)  -- one template per property
);

create table checklist_template_items (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references checklist_templates(id) on delete cascade,
  body text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index on checklist_template_items (template_id, sort_order);

create table checklist_instances (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id) on delete cascade,
  reservation_uuid text not null,         -- Hospitable reservation uuid
  template_id uuid references checklist_templates(id) on delete set null,
  status text not null default 'pending', -- pending | in_progress | completed
  link_token text not null unique,        -- signed token for public URL
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index on checklist_instances (property_id, created_at desc);
create index on checklist_instances (reservation_uuid);

create table checklist_instance_items (
  id uuid primary key default gen_random_uuid(),
  instance_id uuid not null references checklist_instances(id) on delete cascade,
  body text not null,
  sort_order integer not null,
  is_checked boolean not null default false,
  checked_at timestamptz
);

create index on checklist_instance_items (instance_id, sort_order);
```

### 3c. New table — reservations cache

```sql
-- 20260529000200_reservations.sql
create table reservations (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id) on delete cascade,
  hospitable_reservation_uuid text not null unique,
  guest_name text,
  guest_email text,
  guest_phone text,
  platform text,                          -- airbnb | booking | vrbo | direct
  check_in date,
  check_out date,
  status text,                            -- accepted | cancelled | etc.
  raw jsonb,                              -- full webhook payload for debugging
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index on reservations (property_id, check_in desc);
```

### 3d. New table — extras approval tokens

```sql
-- 20260529000300_sms_extras.sql
create table extras_approval_tokens (
  id uuid primary key default gen_random_uuid(),
  extra_request_id uuid not null references extra_requests(id) on delete cascade,
  token text not null unique,
  recipient_phone text not null,
  status text not null default 'pending', -- pending | approved | declined
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

-- Add a column to extra_requests to record final state once approval comes back
alter table extra_requests
  add column if not exists approval_status text default 'pending',
  add column if not exists approved_by_phone text;
```

### 3e. New columns — sms_recipients routing for new SMS types

```sql
-- 20260529000400_sms_recipients_extras_and_checklist.sql
alter table sms_recipients
  add column if not exists receives_extras boolean not null default false,
  add column if not exists receives_reservation_checklist boolean not null default false;
```

`receives_extras` routes the new "guest requested an extra — approve/decline" SMS to the
property manager / host. `receives_reservation_checklist` routes the new
"new reservation — please complete checklist" SMS to the cleaner. These are distinct
because a host and a cleaner are usually different humans with different opt-ins. The
`SmsRecipients.tsx` page is extended to show both new toggles as additional columns in the
recipients table.

## 4. Trigger.dev workflows

### Existing (kept, just moved)

- **`main-agent-workflow`** (`backend/trigger/messaging/main-agent.ts`) — receives
  `message.created` webhook payload from Modal, runs the agent loop.
- **`property-sync`** (`backend/trigger/property-sync.ts`) — manual trigger, pulls
  properties from Hospitable into Supabase. **Turno-sync code removed.**
- **`supabase-keepalive`** (`backend/trigger/keep-alive.ts`) — daily scheduled.

### Modified

**`main-agent-workflow`** — Sub-Workflow C (`process_extra_request`) is rewritten. Today it
calls Turno API directly. After the rewrite:

1. AI matches the requested item against `allowed_extras`.
2. If declined: same as today — record `status='declined'`, send SMS to extras-routing
   recipients, decline message to guest.
3. If allowed: generate a signed token, insert `extras_approval_tokens` row (15min TTL),
   send SMS to each recipient with `receives_extras=true`. SMS body includes the approval
   URL pointing at the dashboard public route: `https://<dashboard-host>/r/<token>`. The
   reply to the guest is *not* sent yet — we wait for human confirmation. The workflow ends
   here.
4. When the recipient opens the URL, the React page calls `extras-resolve` to load the
   request and renders Approve/Decline buttons. Clicking either calls `extras-respond`,
   which updates the DB and then fires a second `main-agent-workflow` trigger with a
   synthetic payload representing the human's decision. The agent then replies to the
   guest with the appropriate message.

This adds two new tool branches in the agent: nothing changes from the agent's perspective
since the second invocation is a normal message.

### New

**`reservation-webhook`** (`backend/trigger/flows/reservation-webhook.ts`) — receives
`reservation.created` webhook payload from Modal:

1. Filter — ignore non-`reservation.created` events.
2. Look up property by Hospitable property UUID. If not synced, log and exit.
3. Upsert into `reservations`.
4. Load the property's `checklist_templates` row + items.
5. Insert `checklist_instances` row with a fresh signed token and per-item rows from the
   template.
6. Fetch SMS recipients with `receives_reservation_checklist=true` (the new column —
   intended for cleaners). Send SMS with the cleaner-checklist URL pointing at the
   dashboard public route: `https://<dashboard-host>/c/<token>`. Body includes property
   name, check-in date, and the link.

If the property has no checklist template, skip the instance creation but still send a
"new reservation" SMS for awareness.

### Task ID registry

```ts
// backend/trigger/task-ids.ts
export const TASK_IDS = {
  MESSAGING: {
    MAIN_AGENT: "main-agent-workflow",
  },
  FLOWS: {
    RESERVATION_WEBHOOK: "reservation-webhook",
  },
  SYNC: {
    PROPERTY_SYNC: "property-sync",
    KEEP_ALIVE: "supabase-keepalive",
  },
} as const;
```

## 5. Public mobile pages — React routes in the dashboard

Public-facing pages (cleaner checklist, extras approval) live in the React dashboard at
`/dashboard/src/pages/public/`, not in Edge Functions. They reach the data via Supabase
Edge Functions exposed as a small JSON API. This keeps the look-and-feel consistent with
the rest of the dashboard and lets us use the same React components for design.

Signed tokens are HMAC-SHA256 over `{kind, row_id, exp}` signed with a new
`PUBLIC_LINK_SIGNING_SECRET` env var (kept server-side in the edge functions and in
Trigger.dev). Tokens are also stored in the DB alongside their row so revocation is one
update.

### Dashboard routing

```
/                    — Overview (auth required)
/properties          — PropertiesKB (auth required)
/tickets             — Tickets (auth required)
/reservations        — Reservations (auth required) [NEW]
/agent-config        — AgentConfig (admin)
/users               — Users (admin)
/sms-recipients      — SmsRecipients (admin)
/login               — Login

/c/:token            — Public cleaner checklist page (no auth) [NEW]
/r/:token            — Public extras-approval page (no auth) [NEW]
```

The auth guard in `Layout.tsx` already redirects to `/login` for unauthenticated users.
Public routes (`/c/*`, `/r/*`) get a separate top-level branch in `App.tsx` that bypasses
the `Layout` wrapper entirely — they render outside the sidebar shell, fetch data with the
anon Supabase client, and gate access by token.

### Public page: `/c/:token` — Cleaner Checklist

Mobile-first React page. On mount, calls Edge Function `checklist-resolve` with the token
to get the property name, reservation dates, item list. Renders large tappable checkboxes.
Each toggle POSTs to `checklist-mark-item` (optimistic UI). Shows progress bar. Header
displays Sonic-themed branding and property name. No nav, no sidebar.

### Public page: `/r/:token` — Extras Approval

Mobile-first React page. Shows property name, guest name, requested item, and two large
buttons: "Approve" / "Decline". On click, POSTs to `extras-respond`, then shows a
confirmation screen. Token expires in 15 minutes; expired/missing token shows a
"link no longer valid" state with a "contact host" CTA.

## 5b. Supabase Edge Functions (JSON API for the public pages)

Four edge functions act as the data API for the public pages. All accept JSON and return
JSON. No HTML.

### `checklist-resolve` (POST)

`{ token }` → resolves the token, returns `{ property_name, check_in, check_out, items:
[{id, body, is_checked, sort_order}], progress }`. Validates token, checks expiry, returns
401 on bad token.

### `checklist-mark-item` (POST)

`{ token, item_id, is_checked }` → updates `checklist_instance_items.is_checked` and
`checked_at`. Updates parent `checklist_instances.status` to `in_progress` on first check,
`completed` when all items are checked. Returns the updated progress.

### `extras-resolve` (POST)

`{ token }` → resolves the token, returns `{ property_name, guest_name, item_requested,
status }`. 401 on bad/expired token; 410 if already responded.

### `extras-respond` (POST)

`{ token, decision: "approved" | "declined" }` → updates `extras_approval_tokens.status`,
updates `extra_requests.approval_status`, then triggers the `main-agent-workflow` with a
synthetic message so the agent can compose and send the guest reply.

### `_shared/` library

- `cors.ts` — standard CORS response helper (must allow the Render dashboard origin).
- `supabase.ts` — service-role client (edge functions only).
- `tokens.ts` — HMAC token generate + verify.
- `trigger-fire.ts` — POST to Trigger.dev REST endpoint for `main-agent` re-invocation.

## 6. Dashboard additions

Three new pages and one minor edit:

| Page / change | Purpose |
|---|---|
| `dashboard/src/pages/Reservations.tsx` [NEW] | List view of `reservations` joined with `checklist_instances.status`. Click into a row to see checklist completion details. |
| `dashboard/src/pages/PropertiesKB.tsx` — extend [EDIT] | Add a "Cleaning checklist" tab on each property's detail panel. Editor for `checklist_templates` items (add / reorder / delete). |
| `dashboard/src/pages/SmsRecipients.tsx` — extend [EDIT] | Add a `receives_extras` toggle column. |
| `dashboard/src/components/Layout.tsx` — extend [EDIT] | Add Reservations nav item. Replace logo with new Sonic-themed asset. |

Sonic branding: a new `/dashboard/public/logo.png` generated via Gemini (Sonic-styled
mascot, on-brand colors). No color palette swap beyond the logo.

## 7. Out of scope

- Multi-tenant hierarchy (partner / organization layer from Convrse)
- Sessions / session_messages tables — we continue to fetch conversation history from
  Hospitable API at request time
- Telemetry tables (`telemetry_events`, `telemetry_alert_state`)
- Multi-PMS support — only Hospitable
- Voice agent / Telnyx / LiveKit integration
- Billing / credits / Stripe
- Public marketing pages, property import flow, call flow, payment flow (per user
  instruction)

## 8. Open items before implementation

1. Three Supabase API keys need to be pulled into the local `.env` files (root + dashboard)
   once the new Supabase project's Settings → API page is accessible.
2. The new Modal webhook needs to be deployed and its URL registered in the new client's
   Hospitable account for **two** event types: `message.created` and `reservation.created`.
3. The previous client's Turno code is being removed entirely — confirm there's no
   regression concern (i.e., previous client is fully off this code path).

## 9. Deployment order

Once the spec is approved:

1. Write all migration SQL.
2. Apply migrations via the Supabase MCP to project `bxjdrbktiycmdrozjpgw`.
3. Restructure `/src/` → `/backend/` (move files, update imports).
4. Implement new trigger flows + modify `main-agent.ts` extras branch.
5. Implement edge functions + `_shared/` library.
6. Deploy edge functions via Supabase CLI.
7. Update test reservation filter in `main-agent.ts` — remove old hardcoded UUIDs from
   the previous client, replace with the new test reservation UUID provided by the new
   client (`ALLOWED_RESERVATION_UUIDS`). Remove the filter entirely before going live.
8. Deploy trigger workflows: `npx trigger.dev@latest deploy` against
   `proj_ofggmqipbwsuiltgqlej`.
9. Deploy `hospitable-webhook` edge function (replaces Modal). Delete `webhook.py`.
10. Register the Supabase Edge Function URL
    (`https://bxjdrbktiycmdrozjpgw.supabase.co/functions/v1/hospitable-webhook`) in the
    new client's Hospitable account for `message.created` AND `reservation.created` events.
11. Add dashboard pages, rebuild and redeploy frontend on Render. Capture the public
    dashboard URL — it must be used in the SMS body URL templates.
12. Generate Sonic logo via Gemini, swap in dashboard.
13. End-to-end test: POST to `https://api.hospitable.com/v1/webhooks-next/8870253e-d55a-43f4-83d6-67482cf6ba12/test`
    for both event types, observe the agent reply land in the Hospitable inbox and a
    checklist instance get created.
