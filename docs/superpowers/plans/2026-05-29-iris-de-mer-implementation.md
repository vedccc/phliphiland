# Iris de Mer Fork — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In-place fork of the existing Uncommon AI guest agent into a new Supabase + Trigger.dev deployment for the new client (Iris de Mer / Aire de Mer), with cleaning checklist feature added and Turno replaced by SMS-with-approval-link.

**Architecture:** Backend reorganized along Convrse-style folder layout (`/backend/trigger/{flows,messaging,helpers}/`, `/backend/supabase/{migrations,functions}/`). Modal eliminated in favor of a Supabase Edge Function that forwards Hospitable webhooks to Trigger.dev. Public mobile pages (cleaner checklist, extras approval) are React routes in the dashboard backed by JSON-API edge functions.

**Tech Stack:** Trigger.dev v4 SDK (TypeScript), Supabase Edge Functions (Deno + TypeScript), Anthropic Claude Sonnet 4.6, React + Vite + Tailwind (dashboard), SMSAPI for outbound SMS.

**Reference spec:** [docs/superpowers/specs/2026-05-29-iris-de-mer-fork-design.md](../specs/2026-05-29-iris-de-mer-fork-design.md)

---

## Phase 0: Setup & Secrets

### Task 0.1: Verify Supabase keys are in `.env`

**Files:**
- Modify: `/Users/vedantchellani/Desktop/Uncommon/.env`
- Modify: `/Users/vedantchellani/Desktop/Uncommon/dashboard/.env`

- [ ] **Step 1: Confirm `SUPABASE_URL` already points to the new project**

```bash
grep "^SUPABASE_URL=" /Users/vedantchellani/Desktop/Uncommon/.env
```

Expected: `SUPABASE_URL=https://bxjdrbktiycmdrozjpgw.supabase.co`

- [ ] **Step 2: Pull the three API keys from Supabase project Settings → API**

The user provides:
- `SUPABASE_ANON_KEY` — public anon key, starts with `eyJ...`
- `SUPABASE_SERVICE_ROLE_KEY` — service role key (sensitive), starts with `eyJ...`
- `PUBLIC_LINK_SIGNING_SECRET` — generate locally: `openssl rand -hex 32`

- [ ] **Step 3: Update root `.env`**

```bash
sed -i '' "s|^SUPABASE_ANON_KEY=.*|SUPABASE_ANON_KEY=<NEW_ANON_KEY>|" /Users/vedantchellani/Desktop/Uncommon/.env
sed -i '' "s|^SUPABASE_SERVICE_ROLE_KEY=.*|SUPABASE_SERVICE_ROLE_KEY=<NEW_SERVICE_KEY>|" /Users/vedantchellani/Desktop/Uncommon/.env
echo "PUBLIC_LINK_SIGNING_SECRET=$(openssl rand -hex 32)" >> /Users/vedantchellani/Desktop/Uncommon/.env
```

- [ ] **Step 4: Update dashboard `.env`**

```bash
sed -i '' "s|^VITE_SUPABASE_ANON_KEY=.*|VITE_SUPABASE_ANON_KEY=<NEW_ANON_KEY>|" /Users/vedantchellani/Desktop/Uncommon/dashboard/.env
```

- [ ] **Step 5: Verify Supabase MCP can talk to new project**

Call `mcp__supabase__list_tables` with no args. Expected: empty list (new project).

- [ ] **Step 6: Commit `.env.example` changes (NOT the .env itself)**

```bash
cd /Users/vedantchellani/Desktop/Uncommon
git add -- :!.env :!dashboard/.env
git commit -m "chore: switch project refs to Iris de Mer (Supabase bxjdrbktiycmdrozjpgw, Trigger proj_ofggmqipbwsuiltgqlej)"
```

---

## Phase 1: Database Schema

### Task 1.1: Write baseline migration formalizing the existing Uncommon schema

**Files:**
- Create: `backend/supabase/migrations/20260529000000_baseline.sql`

- [ ] **Step 1: Create the migrations directory**

```bash
mkdir -p /Users/vedantchellani/Desktop/Uncommon/backend/supabase/migrations
mkdir -p /Users/vedantchellani/Desktop/Uncommon/backend/supabase/functions/_shared
```

- [ ] **Step 2: Write the baseline migration**

Create `backend/supabase/migrations/20260529000000_baseline.sql`:

```sql
-- Baseline schema for Iris de Mer.
-- Mirrors the current Uncommon Supabase schema, with Turno columns removed.

-- Extensions
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- profiles (extends auth.users)
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  role text not null default 'member',  -- super_admin | admin | member
  can_view_kb boolean not null default false,
  can_view_maintenance boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
create policy "profiles_authenticated_read" on public.profiles
  for select to authenticated using (true);
create policy "profiles_self_update" on public.profiles
  for update to authenticated using (auth.uid() = id);

-- properties
create table public.properties (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  hospitable_property_uuid text not null unique,
  is_active boolean not null default true,
  timezone text default 'America/New_York',
  created_at timestamptz not null default now()
);
alter table public.properties enable row level security;
create policy "properties_authenticated_all" on public.properties
  for all to authenticated using (true) with check (true);

-- knowledge_bases
create table public.knowledge_bases (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  title text not null,
  content text not null,
  category text,
  video_url text,
  image_url text,
  created_at timestamptz not null default now()
);
create index on public.knowledge_bases (property_id);
alter table public.knowledge_bases enable row level security;
create policy "kb_authenticated_all" on public.knowledge_bases
  for all to authenticated using (true) with check (true);

-- kb_gap_log
create table public.kb_gap_log (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  guest_question text not null,
  reservation_uuid text,
  created_at timestamptz not null default now()
);
create index on public.kb_gap_log (property_id, created_at desc);
alter table public.kb_gap_log enable row level security;
create policy "kb_gap_authenticated_all" on public.kb_gap_log
  for all to authenticated using (true) with check (true);

-- cooldowns
create table public.cooldowns (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  activated_at timestamptz not null default now(),
  expires_at timestamptz not null,
  reason text,
  is_active boolean not null default true,
  reservation_uuid text,
  created_at timestamptz not null default now()
);
create index on public.cooldowns (property_id, is_active);
alter table public.cooldowns enable row level security;
create policy "cooldowns_authenticated_all" on public.cooldowns
  for all to authenticated using (true) with check (true);

-- urgency_categories
create table public.urgency_categories (
  id uuid primary key default gen_random_uuid(),
  level text not null unique,
  description text,
  examples text,
  response_time text,
  created_at timestamptz not null default now()
);
alter table public.urgency_categories enable row level security;
create policy "urgency_authenticated_all" on public.urgency_categories
  for all to authenticated using (true) with check (true);
insert into public.urgency_categories (level, description, examples, response_time) values
  ('high',    'Significant issue affecting guest stay',           '',  'within 1 hour'),
  ('medium',  'Moderate issue, attention needed soon',            '',  'within 4 hours'),
  ('low',     'Minor issue, can wait',                            '',  'within 24 hours');

-- maintenance_tickets
create table public.maintenance_tickets (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  description text not null,
  urgency text not null,
  status text not null default 'open',  -- open | resolved
  guest_context text,
  reservation_uuid text,
  created_at timestamptz not null default now()
);
create index on public.maintenance_tickets (property_id, status);
alter table public.maintenance_tickets enable row level security;
create policy "tickets_authenticated_all" on public.maintenance_tickets
  for all to authenticated using (true) with check (true);

-- allowed_extras
create table public.allowed_extras (
  id uuid primary key default gen_random_uuid(),
  item_name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.allowed_extras enable row level security;
create policy "extras_authenticated_all" on public.allowed_extras
  for all to authenticated using (true) with check (true);

-- extra_requests
create table public.extra_requests (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  reservation_uuid text,
  item_requested text not null,
  status text not null default 'pending',  -- pending | approved | declined
  created_at timestamptz not null default now()
);
create index on public.extra_requests (property_id, status);
alter table public.extra_requests enable row level security;
create policy "extra_requests_authenticated_all" on public.extra_requests
  for all to authenticated using (true) with check (true);

-- sms_recipients
create table public.sms_recipients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text not null,
  receives_maintenance_low boolean not null default false,
  receives_maintenance_medium boolean not null default false,
  receives_maintenance_high boolean not null default false,
  receives_kb_gaps boolean not null default false,
  receives_checkin_checkout boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.sms_recipients enable row level security;
create policy "sms_recipients_authenticated_all" on public.sms_recipients
  for all to authenticated using (true) with check (true);

-- agent_activity_log
create table public.agent_activity_log (
  id uuid primary key default gen_random_uuid(),
  property_id uuid references public.properties(id) on delete set null,
  reservation_uuid text,
  action_type text not null,   -- kb_answer | maintenance | extra_request | checkin_checkout | escalation
  created_at timestamptz not null default now()
);
create index on public.agent_activity_log (property_id, created_at desc);
alter table public.agent_activity_log enable row level security;
create policy "agent_log_authenticated_all" on public.agent_activity_log
  for all to authenticated using (true) with check (true);

-- Auto-populate profiles on signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email);
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
```

- [ ] **Step 3: Apply migration via Supabase MCP**

Call `mcp__supabase__apply_migration` with:
- `name`: `baseline`
- `query`: contents of the SQL file above

- [ ] **Step 4: Verify tables exist**

Call `mcp__supabase__list_tables` with no args. Expected: 11 tables visible: `profiles`, `properties`, `knowledge_bases`, `kb_gap_log`, `cooldowns`, `urgency_categories`, `maintenance_tickets`, `allowed_extras`, `extra_requests`, `sms_recipients`, `agent_activity_log`.

### Task 1.2: Write checklist tables migration

**Files:**
- Create: `backend/supabase/migrations/20260529000100_checklist.sql`

- [ ] **Step 1: Write the migration**

Create `backend/supabase/migrations/20260529000100_checklist.sql`:

```sql
create table public.checklist_templates (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  name text not null default 'Cleaning Checklist',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (property_id)
);
alter table public.checklist_templates enable row level security;
create policy "checklist_templates_authenticated_all" on public.checklist_templates
  for all to authenticated using (true) with check (true);

create table public.checklist_template_items (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.checklist_templates(id) on delete cascade,
  body text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create index on public.checklist_template_items (template_id, sort_order);
alter table public.checklist_template_items enable row level security;
create policy "checklist_template_items_authenticated_all" on public.checklist_template_items
  for all to authenticated using (true) with check (true);

create table public.checklist_instances (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  reservation_uuid text not null,
  template_id uuid references public.checklist_templates(id) on delete set null,
  status text not null default 'pending',  -- pending | in_progress | completed
  link_token text not null unique,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index on public.checklist_instances (property_id, created_at desc);
create index on public.checklist_instances (reservation_uuid);
alter table public.checklist_instances enable row level security;
create policy "checklist_instances_authenticated_all" on public.checklist_instances
  for all to authenticated using (true) with check (true);
-- service role can write via edge functions; no separate anon policy needed.

create table public.checklist_instance_items (
  id uuid primary key default gen_random_uuid(),
  instance_id uuid not null references public.checklist_instances(id) on delete cascade,
  body text not null,
  sort_order integer not null,
  is_checked boolean not null default false,
  checked_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.checklist_instance_items (instance_id, sort_order);
alter table public.checklist_instance_items enable row level security;
create policy "checklist_instance_items_authenticated_all" on public.checklist_instance_items
  for all to authenticated using (true) with check (true);
```

- [ ] **Step 2: Apply via MCP**

Call `mcp__supabase__apply_migration` with `name=checklist`.

- [ ] **Step 3: Verify**

Call `mcp__supabase__list_tables`. Expected: 4 new tables visible.

### Task 1.3: Write reservations cache migration

**Files:**
- Create: `backend/supabase/migrations/20260529000200_reservations.sql`

- [ ] **Step 1: Write the migration**

```sql
create table public.reservations (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  hospitable_reservation_uuid text not null unique,
  guest_name text,
  guest_email text,
  guest_phone text,
  platform text,
  check_in date,
  check_out date,
  status text,
  raw jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.reservations (property_id, check_in desc);
alter table public.reservations enable row level security;
create policy "reservations_authenticated_all" on public.reservations
  for all to authenticated using (true) with check (true);
```

- [ ] **Step 2: Apply via MCP**

Call `mcp__supabase__apply_migration` with `name=reservations`.

### Task 1.4: Write extras approval tokens migration

**Files:**
- Create: `backend/supabase/migrations/20260529000300_sms_extras.sql`

- [ ] **Step 1: Write the migration**

```sql
create table public.extras_approval_tokens (
  id uuid primary key default gen_random_uuid(),
  extra_request_id uuid not null references public.extra_requests(id) on delete cascade,
  token text not null unique,
  recipient_phone text not null,
  status text not null default 'pending',  -- pending | approved | declined
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index on public.extras_approval_tokens (extra_request_id);
alter table public.extras_approval_tokens enable row level security;
create policy "extras_tokens_authenticated_all" on public.extras_approval_tokens
  for all to authenticated using (true) with check (true);

alter table public.extra_requests
  add column if not exists approval_status text default 'pending',
  add column if not exists approved_by_phone text;
```

- [ ] **Step 2: Apply via MCP**

Call `mcp__supabase__apply_migration` with `name=sms_extras`.

### Task 1.5: Write SMS recipients new columns migration

**Files:**
- Create: `backend/supabase/migrations/20260529000400_sms_recipients_routing.sql`

- [ ] **Step 1: Write the migration**

```sql
alter table public.sms_recipients
  add column if not exists receives_extras boolean not null default false,
  add column if not exists receives_reservation_checklist boolean not null default false;
```

- [ ] **Step 2: Apply via MCP**

Call `mcp__supabase__apply_migration` with `name=sms_recipients_routing`.

### Task 1.6: Verify full schema, run advisor, commit

- [ ] **Step 1: List final table set**

Call `mcp__supabase__list_tables`. Expected count: 17 public tables.

- [ ] **Step 2: Run security advisor**

Call `mcp__supabase__get_advisors` with `type=security`. Fix any errors flagged (likely none with the RLS policies in place).

- [ ] **Step 3: Commit migrations**

```bash
cd /Users/vedantchellani/Desktop/Uncommon
git add backend/supabase/migrations/
git commit -m "feat(schema): baseline + checklist + reservations + sms-routing migrations"
```

---

## Phase 2: Backend Restructure (Move `/src/` → `/backend/`)

### Task 2.1: Create new directory layout

- [ ] **Step 1: Make the directories**

```bash
cd /Users/vedantchellani/Desktop/Uncommon
mkdir -p backend/trigger/flows
mkdir -p backend/trigger/messaging
mkdir -p backend/trigger/helpers
mkdir -p backend/supabase/functions/_shared
```

### Task 2.2: Move trigger workflows

**Files:**
- Move: `src/trigger/main-agent.ts` → `backend/trigger/messaging/main-agent.ts`
- Move: `src/trigger/property-sync.ts` → `backend/trigger/property-sync.ts`
- Move: `src/trigger/keep-alive.ts` → `backend/trigger/keep-alive.ts`

- [ ] **Step 1: Move files**

```bash
cd /Users/vedantchellani/Desktop/Uncommon
git mv src/trigger/main-agent.ts backend/trigger/messaging/main-agent.ts
git mv src/trigger/property-sync.ts backend/trigger/property-sync.ts
git mv src/trigger/keep-alive.ts backend/trigger/keep-alive.ts
```

### Task 2.3: Move helpers (drop Turno)

**Files:**
- Move: `src/lib/hospitable.ts` → `backend/trigger/helpers/hospitable.ts`
- Move: `src/lib/sms.ts` → `backend/trigger/helpers/sms.ts`
- Move: `src/lib/supabase.ts` → `backend/trigger/helpers/supabase.ts`
- Move: `src/lib/similarity.ts` → `backend/trigger/helpers/similarity.ts`
- Delete: `src/lib/turno.ts`

- [ ] **Step 1: Move helpers, delete turno**

```bash
cd /Users/vedantchellani/Desktop/Uncommon
git mv src/lib/hospitable.ts backend/trigger/helpers/hospitable.ts
git mv src/lib/sms.ts backend/trigger/helpers/sms.ts
git mv src/lib/supabase.ts backend/trigger/helpers/supabase.ts
git mv src/lib/similarity.ts backend/trigger/helpers/similarity.ts
git rm src/lib/turno.ts
```

### Task 2.4: Update imports in moved files

**Files:**
- Modify: `backend/trigger/messaging/main-agent.ts` (lines 1-7 of original)
- Modify: `backend/trigger/property-sync.ts`
- Modify: `backend/trigger/keep-alive.ts`

- [ ] **Step 1: Fix import paths in main-agent.ts**

In `backend/trigger/messaging/main-agent.ts`, change:

```ts
// FROM:
import { getSupabaseClient } from "../lib/supabase.js";
import { getReservation, getReservationMessages, sendMessage } from "../lib/hospitable.js";
import { createProject, getLocalHour } from "../lib/turno.js";
import { sendSms } from "../lib/sms.js";

// TO:
import { getSupabaseClient } from "../helpers/supabase.js";
import { getReservation, getReservationMessages, sendMessage } from "../helpers/hospitable.js";
import { getLocalHour } from "../helpers/time.js";
import { sendSms } from "../helpers/sms.js";
```

(`getLocalHour` is moved out of turno into a new `time.ts` helper — see next task.)

- [ ] **Step 2: Fix import paths in property-sync.ts**

In `backend/trigger/property-sync.ts`, change all `../lib/` to `./helpers/`. Remove any Turno imports — the file currently references Turno for sync; that branch is deleted.

- [ ] **Step 3: Fix imports in keep-alive.ts**

Change `../lib/supabase.js` → `./helpers/supabase.js`.

### Task 2.5: Extract `getLocalHour` into a new time helper

**Files:**
- Create: `backend/trigger/helpers/time.ts`

- [ ] **Step 1: Write time helper**

```ts
// backend/trigger/helpers/time.ts
export function getLocalHour(timezone: string): { hour: number; year: number; month: number; day: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(new Date()).map((p) => [p.type, parseInt(p.value, 10)])
  );
  return { year: parts.year, month: parts.month, day: parts.day, hour: parts.hour === 24 ? 0 : parts.hour };
}
```

### Task 2.6: Remove Turno extras path from `main-agent.ts`

**Files:**
- Modify: `backend/trigger/messaging/main-agent.ts` (Sub-Workflow C, function `subWorkflowC`)

- [ ] **Step 1: Replace Sub-Workflow C entirely**

The current `subWorkflowC` (extras processing) calls Turno. Replace its body with the new SMS-approval flow. Below is the full replacement function. Locate `async function subWorkflowC(` in `main-agent.ts` and replace through its closing `}`:

```ts
async function subWorkflowC(
  itemRequested: string,
  ctx: AgentContext
): Promise<string> {
  const supabase = getSupabaseClient();

  // C1: Check allowed extras using AI matching (unchanged)
  const { data: allowedExtras } = await supabase
    .from("allowed_extras")
    .select("*")
    .eq("is_active", true);

  const allowedList = (allowedExtras || []).map((e) => e.item_name).join(", ");

  let isAllowed = false;
  if (allowedExtras && allowedExtras.length > 0) {
    const anthropic = new Anthropic();
    const matchResponse = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 10,
      system: `You decide whether a guest's request matches any item on an allowed extras list. The match does NOT need to be exact - use common sense. "More towels" matches "extra towels". "Can I get some soap" matches "toiletries". But "bicycle rental" does NOT match "extra towels".

Allowed extras for this property: ${allowedList}

Respond with ONLY "YES" or "NO". Nothing else.`,
      messages: [{ role: "user", content: `Guest requested: "${itemRequested}"` }],
    });
    const matchText = matchResponse.content.find((b) => b.type === "text");
    isAllowed = matchText ? matchText.text.trim().toUpperCase() === "YES" : false;
    logger.info("Extra request AI match result", { itemRequested, allowedList, isAllowed });
  }

  if (!isAllowed) {
    // Declined - record and notify
    await supabase.from("extra_requests").insert({
      property_id: ctx.propertyId,
      reservation_uuid: ctx.reservationUuid,
      item_requested: itemRequested,
      status: "declined",
    });
    return `Declined. "${itemRequested}" is not in the allowed extras list for this property. Tell the guest we cannot accommodate this request.`;
  }

  // Allowed - create extra_request record (pending), then create approval token, then SMS recipients
  const { data: extraRow, error: insertError } = await supabase
    .from("extra_requests")
    .insert({
      property_id: ctx.propertyId,
      reservation_uuid: ctx.reservationUuid,
      item_requested: itemRequested,
      status: "approved",
      approval_status: "pending",
    })
    .select()
    .single();

  if (insertError || !extraRow) {
    throw new Error(`extra_requests insert failed: ${insertError?.message}`);
  }

  // Fetch SMS recipients with receives_extras=true
  const { data: recipients } = await supabase
    .from("sms_recipients")
    .select("*")
    .eq("receives_extras", true)
    .eq("is_active", true);

  if (!recipients || recipients.length === 0) {
    logger.warn("No SMS recipients with receives_extras=true; auto-approving");
    return `Approved. "${itemRequested}" has been logged. Tell the guest we will arrange delivery shortly.`;
  }

  const dashboardHost = process.env.DASHBOARD_HOST || "https://iris-de-mer.onrender.com";
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  let smsSent = 0;
  for (const r of recipients) {
    const token = await signApprovalToken({ extra_request_id: extraRow.id });
    await supabase.from("extras_approval_tokens").insert({
      extra_request_id: extraRow.id,
      token,
      recipient_phone: r.phone,
      expires_at: expiresAt,
    });

    const url = `${dashboardHost}/r/${token}`;
    const body = `${ctx.propertyName}: guest requested "${itemRequested}". Approve or decline: ${url}`;
    try {
      await sendSms(r.phone, body);
      smsSent++;
    } catch (e) {
      logger.error("SMS send failed", { recipient: r.name, error: String(e) });
    }
  }

  // Return special marker so the agent doesn't reply to the guest yet
  return `__PENDING_APPROVAL__ Approval request sent to ${smsSent} recipient(s). Do NOT reply to the guest; the host's decision will trigger a follow-up message.`;
}
```

- [ ] **Step 2: Add the import for the token helper at the top of main-agent.ts**

```ts
import { signApprovalToken } from "../helpers/tokens.js";
```

- [ ] **Step 3: Handle the `__PENDING_APPROVAL__` marker in the agent loop**

Find the section that processes `tool_use` results in the agent loop (`case "process_extra_request":`). After receiving the toolResult, add a check:

```ts
case "process_extra_request": {
  toolResult = await subWorkflowC(toolInput.item_requested, agentCtx);
  await supabase.from("agent_activity_log").insert({
    property_id: agentCtx.propertyId,
    reservation_uuid: agentCtx.reservationUuid,
    action_type: "extra_request",
  });
  // If approval is pending, terminate without replying to guest
  if (toolResult.startsWith("__PENDING_APPROVAL__")) {
    logger.info("Extra request pending host approval - workflow ends silently");
    return { status: "pending_approval", reason: "awaiting host decision" };
  }
  break;
}
```

### Task 2.7: Write the token helper

**Files:**
- Create: `backend/trigger/helpers/tokens.ts`

- [ ] **Step 1: Write the helper**

```ts
// backend/trigger/helpers/tokens.ts
// HMAC-SHA256 signed tokens for public mobile pages.
// Token format: base64url(payload).base64url(signature)
// where payload = JSON({ kind, id, exp })

import crypto from "node:crypto";

function getSecret(): string {
  const s = process.env.PUBLIC_LINK_SIGNING_SECRET;
  if (!s) throw new Error("Missing PUBLIC_LINK_SIGNING_SECRET");
  return s;
}

function b64url(buf: Buffer | string): string {
  const b = typeof buf === "string" ? Buffer.from(buf) : buf;
  return b.toString("base64url");
}

function fromB64url(s: string): Buffer {
  return Buffer.from(s, "base64url");
}

function sign(payload: object): string {
  const json = JSON.stringify(payload);
  const sig = crypto.createHmac("sha256", getSecret()).update(json).digest();
  return `${b64url(json)}.${b64url(sig)}`;
}

export interface ApprovalTokenPayload {
  extra_request_id: string;
  exp?: number;
}

export async function signApprovalToken(payload: ApprovalTokenPayload): Promise<string> {
  return sign({
    kind: "extras",
    id: payload.extra_request_id,
    exp: payload.exp ?? Math.floor(Date.now() / 1000) + 15 * 60,
  });
}

export interface ChecklistTokenPayload {
  instance_id: string;
  exp?: number;
}

export async function signChecklistToken(payload: ChecklistTokenPayload): Promise<string> {
  return sign({
    kind: "checklist",
    id: payload.instance_id,
    // Checklists live until completed or 30 days max
    exp: payload.exp ?? Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
  });
}
```

### Task 2.8: Update `trigger.config.ts` to point at new dirs

**Files:**
- Modify: `trigger.config.ts:5`

- [ ] **Step 1: Change `dirs`**

```ts
// FROM:
dirs: ["./src/trigger"],
// TO:
dirs: ["./backend/trigger"],
```

### Task 2.9: Remove `/src/` and old `/webhook.py`

- [ ] **Step 1: Delete leftovers**

```bash
cd /Users/vedantchellani/Desktop/Uncommon
git rm -r src
git rm webhook.py
```

- [ ] **Step 2: Local trigger dev smoke test**

```bash
cd /Users/vedantchellani/Desktop/Uncommon
npx trigger.dev@4.4.4 dev --skip-update-check
```

Expected: starts dev mode, lists 3 tasks (`main-agent-workflow`, `property-sync`, `supabase-keepalive`). No import errors. Press Ctrl+C.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "refactor: move /src/ to /backend/, drop Turno, eliminate Modal webhook"
```

---

## Phase 3: Edge Function — Hospitable Webhook Ingress (Replaces Modal)

### Task 3.1: Write `_shared/cors.ts`

**Files:**
- Create: `backend/supabase/functions/_shared/cors.ts`

- [ ] **Step 1: Write the helper**

```ts
// backend/supabase/functions/_shared/cors.ts
export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function preflight(req: Request): Response | null {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  return null;
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
```

### Task 3.2: Write `_shared/supabase.ts` for edge functions

**Files:**
- Create: `backend/supabase/functions/_shared/supabase.ts`

- [ ] **Step 1: Write the helper**

```ts
// backend/supabase/functions/_shared/supabase.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export function getServiceClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Missing Supabase env in edge function");
  return createClient(url, key, { auth: { persistSession: false } });
}
```

### Task 3.3: Write `_shared/tokens.ts` for edge functions (Deno port)

**Files:**
- Create: `backend/supabase/functions/_shared/tokens.ts`

- [ ] **Step 1: Write the helper**

```ts
// backend/supabase/functions/_shared/tokens.ts
// Deno-compatible token verify. Mirrors backend/trigger/helpers/tokens.ts.

const enc = new TextEncoder();

function getSecret(): string {
  const s = Deno.env.get("PUBLIC_LINK_SIGNING_SECRET");
  if (!s) throw new Error("Missing PUBLIC_LINK_SIGNING_SECRET");
  return s;
}

function b64urlDecode(s: string): Uint8Array {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const b64 = (s + pad).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function b64urlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(getSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return new Uint8Array(sigBuf);
}

export interface TokenPayload {
  kind: "extras" | "checklist";
  id: string;
  exp: number;
}

export async function verifyToken(token: string): Promise<TokenPayload | null> {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payloadB64, sigB64] = parts;

  const payloadBytes = b64urlDecode(payloadB64);
  const payloadStr = new TextDecoder().decode(payloadBytes);
  const expectedSig = await hmac(payloadStr);
  const expectedB64 = b64urlEncode(expectedSig);

  // Constant-time compare
  if (expectedB64.length !== sigB64.length) return null;
  let diff = 0;
  for (let i = 0; i < expectedB64.length; i++) diff |= expectedB64.charCodeAt(i) ^ sigB64.charCodeAt(i);
  if (diff !== 0) return null;

  let payload: TokenPayload;
  try {
    payload = JSON.parse(payloadStr);
  } catch {
    return null;
  }
  if (!payload.kind || !payload.id || !payload.exp) return null;
  if (payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}
```

### Task 3.4: Write the `hospitable-webhook` edge function

**Files:**
- Create: `backend/supabase/functions/hospitable-webhook/index.ts`
- Create: `backend/supabase/functions/hospitable-webhook/deno.json`

- [ ] **Step 1: Write `deno.json`**

```json
{
  "imports": {}
}
```

- [ ] **Step 2: Write the function**

```ts
// backend/supabase/functions/hospitable-webhook/index.ts
// Receives Hospitable webhooks and forwards to Trigger.dev.
// Replaces the previous Modal webhook.py.

import { corsHeaders, json, preflight } from "../_shared/cors.ts";

const TASK_BY_ACTION: Record<string, string> = {
  "message.created":     "main-agent-workflow",
  "reservation.created": "reservation-webhook",
};

Deno.serve(async (req: Request) => {
  const pf = preflight(req);
  if (pf) return pf;
  if (req.method !== "POST") return json({ status: "method_not_allowed" }, 405);

  const triggerSecret = Deno.env.get("TRIGGER_SECRET_KEY");
  if (!triggerSecret) return json({ status: "error", detail: "Missing TRIGGER_SECRET_KEY" }, 500);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ status: "error", detail: "invalid_json" }, 400);
  }

  const action = body?.action || "";
  const taskId = TASK_BY_ACTION[action];
  if (!taskId) {
    console.log(`Ignoring action: ${action}`);
    return json({ status: "ignored", action }, 200);
  }

  const triggerUrl = `https://api.trigger.dev/api/v1/tasks/${taskId}/trigger`;
  const payload = {
    payload: {
      event: action,
      data: body,
      received_at: new Date().toISOString(),
    },
  };

  try {
    const resp = await fetch(triggerUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${triggerSecret}`,
      },
      body: JSON.stringify(payload),
    });
    const result = await resp.json();
    if (!resp.ok) {
      console.error(`Trigger.dev error ${resp.status}:`, result);
      return json({ status: "error", detail: result }, 502);
    }
    return json({ status: "ok", trigger_run_id: result.id });
  } catch (e) {
    console.error("Trigger.dev fetch failed", e);
    return json({ status: "error", detail: String(e) }, 502);
  }
});
```

### Task 3.5: Write `supabase/config.toml` to disable JWT verification on public functions

**Files:**
- Create: `backend/supabase/config.toml`

- [ ] **Step 1: Write config**

```toml
project_id = "iris-de-mer"

[functions.hospitable-webhook]
verify_jwt = false

[functions.checklist-resolve]
verify_jwt = false

[functions.checklist-mark-item]
verify_jwt = false

[functions.extras-resolve]
verify_jwt = false

[functions.extras-respond]
verify_jwt = false
```

### Task 3.6: Deploy the webhook edge function

- [ ] **Step 1: Set required secrets**

```bash
cd /Users/vedantchellani/Desktop/Uncommon/backend
npx supabase secrets set TRIGGER_SECRET_KEY="<value from .env>" --project-ref bxjdrbktiycmdrozjpgw
npx supabase secrets set PUBLIC_LINK_SIGNING_SECRET="<value from .env>" --project-ref bxjdrbktiycmdrozjpgw
```

- [ ] **Step 2: Deploy**

```bash
cd /Users/vedantchellani/Desktop/Uncommon/backend
npx supabase functions deploy hospitable-webhook --project-ref bxjdrbktiycmdrozjpgw --no-verify-jwt
```

Expected: deploys without errors, prints function URL.

- [ ] **Step 3: Smoke test with curl**

```bash
curl -X POST "https://bxjdrbktiycmdrozjpgw.supabase.co/functions/v1/hospitable-webhook" \
  -H "Content-Type: application/json" \
  -d '{"action":"unknown.event"}'
```

Expected: `{"status":"ignored","action":"unknown.event"}`

- [ ] **Step 4: Commit**

```bash
cd /Users/vedantchellani/Desktop/Uncommon
git add backend/supabase/
git commit -m "feat(webhook): hospitable-webhook edge function replaces Modal"
```

---

## Phase 4: Reservation Webhook Trigger Flow (NEW)

### Task 4.1: Write the reservation-webhook task

**Files:**
- Create: `backend/trigger/flows/reservation-webhook.ts`

- [ ] **Step 1: Write the flow**

```ts
// backend/trigger/flows/reservation-webhook.ts
import { task, logger } from "@trigger.dev/sdk";
import { getSupabaseClient } from "../helpers/supabase.js";
import { sendSms } from "../helpers/sms.js";
import { signChecklistToken } from "../helpers/tokens.js";

interface ReservationWebhookPayload {
  event: string;
  data: any;
  received_at: string;
}

export const reservationWebhook = task({
  id: "reservation-webhook",
  retry: { maxAttempts: 1 },
  run: async (payload: ReservationWebhookPayload) => {
    const webhookData = payload.data?.data || payload.data;
    const reservationUuid =
      webhookData?.id ||
      webhookData?.reservation_id ||
      webhookData?.uuid;

    if (!reservationUuid) {
      logger.error("No reservation_uuid in payload");
      return { status: "error", reason: "no_reservation_uuid" };
    }

    const propertyUuid = webhookData?.property?.id || webhookData?.property_uuid;
    if (!propertyUuid) {
      logger.error("No property_uuid in payload");
      return { status: "error", reason: "no_property_uuid" };
    }

    const supabase = getSupabaseClient();

    // Resolve property
    const { data: property } = await supabase
      .from("properties")
      .select("*")
      .eq("hospitable_property_uuid", propertyUuid)
      .single();

    if (!property) {
      logger.warn("Property not synced - run property-sync first", { propertyUuid });
      return { status: "skipped", reason: "property_not_synced" };
    }

    // Upsert reservation cache
    const guest = webhookData?.guest || {};
    await supabase.from("reservations").upsert(
      {
        property_id: property.id,
        hospitable_reservation_uuid: reservationUuid,
        guest_name: guest.full_name || guest.first_name || null,
        guest_email: guest.email || null,
        guest_phone: guest.phone || null,
        platform: webhookData?.platform || null,
        check_in: webhookData?.check_in || null,
        check_out: webhookData?.check_out || null,
        status: webhookData?.status || "confirmed",
        raw: webhookData,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "hospitable_reservation_uuid" }
    );

    // Load template for this property
    const { data: template } = await supabase
      .from("checklist_templates")
      .select("*")
      .eq("property_id", property.id)
      .eq("is_active", true)
      .single();

    let smsBody = `New reservation at ${property.name} (${webhookData?.check_in || "TBD"})`;
    let linkAdded = false;

    if (template) {
      const { data: items } = await supabase
        .from("checklist_template_items")
        .select("*")
        .eq("template_id", template.id)
        .order("sort_order");

      if (items && items.length > 0) {
        // Create instance + items
        const placeholderToken = crypto.randomUUID();  // tmp until we have the instance id
        const { data: instance, error: instErr } = await supabase
          .from("checklist_instances")
          .insert({
            property_id: property.id,
            reservation_uuid: reservationUuid,
            template_id: template.id,
            link_token: placeholderToken,
          })
          .select()
          .single();

        if (instErr || !instance) {
          logger.error("Failed to create checklist instance", { err: instErr?.message });
        } else {
          // Now sign a real token using the actual instance id
          const realToken = await signChecklistToken({ instance_id: instance.id });
          await supabase
            .from("checklist_instances")
            .update({ link_token: realToken })
            .eq("id", instance.id);

          await supabase.from("checklist_instance_items").insert(
            items.map((it) => ({
              instance_id: instance.id,
              body: it.body,
              sort_order: it.sort_order,
            }))
          );

          const dashboardHost = process.env.DASHBOARD_HOST || "https://iris-de-mer.onrender.com";
          smsBody = `${property.name}: new reservation ${webhookData?.check_in || ""}. Checklist: ${dashboardHost}/c/${realToken}`;
          linkAdded = true;
        }
      }
    }

    // Send SMS to recipients
    const { data: recipients } = await supabase
      .from("sms_recipients")
      .select("*")
      .eq("receives_reservation_checklist", true)
      .eq("is_active", true);

    let smsSent = 0;
    if (recipients) {
      for (const r of recipients) {
        try {
          await sendSms(r.phone, smsBody);
          smsSent++;
        } catch (e) {
          logger.error("SMS send failed", { recipient: r.name, error: String(e) });
        }
      }
    }

    return {
      status: "ok",
      reservation_uuid: reservationUuid,
      checklist_created: linkAdded,
      sms_sent: smsSent,
    };
  },
});
```

### Task 4.2: Smoke test in trigger dev mode

- [ ] **Step 1: Start trigger dev**

```bash
cd /Users/vedantchellani/Desktop/Uncommon
npx trigger.dev@4.4.4 dev --skip-update-check
```

Expected: lists `reservation-webhook` along with existing tasks.

- [ ] **Step 2: Test with a sample payload via dashboard**

In the Trigger.dev dashboard for the new project, go to the `reservation-webhook` task → Test → paste:

```json
{
  "event": "reservation.created",
  "data": {
    "action": "reservation.created",
    "data": {
      "id": "test-reservation-001",
      "property": { "id": "<HOSPITABLE_PROPERTY_UUID_OF_A_SYNCED_PROPERTY>" },
      "check_in": "2026-07-01",
      "check_out": "2026-07-05",
      "guest": { "full_name": "Test Guest", "email": "test@example.com" }
    }
  },
  "received_at": "2026-05-29T00:00:00Z"
}
```

Expected: run completes with `status: "ok"`. If no recipients with `receives_reservation_checklist=true`, `sms_sent: 0` (OK). Press Ctrl+C.

- [ ] **Step 3: Commit**

```bash
git add backend/trigger/flows/
git commit -m "feat(trigger): reservation-webhook flow creates checklist instance + SMS cleaner"
```

---

## Phase 5: Public-Page Edge Functions

### Task 5.1: Write `checklist-resolve` edge function

**Files:**
- Create: `backend/supabase/functions/checklist-resolve/index.ts`

- [ ] **Step 1: Write**

```ts
// backend/supabase/functions/checklist-resolve/index.ts
import { json, preflight } from "../_shared/cors.ts";
import { getServiceClient } from "../_shared/supabase.ts";
import { verifyToken } from "../_shared/tokens.ts";

Deno.serve(async (req: Request) => {
  const pf = preflight(req);
  if (pf) return pf;
  if (req.method !== "POST") return json({ status: "method_not_allowed" }, 405);

  const { token } = await req.json().catch(() => ({}));
  if (!token) return json({ status: "error", detail: "missing_token" }, 400);

  const payload = await verifyToken(token);
  if (!payload || payload.kind !== "checklist") {
    return json({ status: "error", detail: "invalid_token" }, 401);
  }

  const supabase = getServiceClient();
  const { data: instance } = await supabase
    .from("checklist_instances")
    .select("id, property_id, reservation_uuid, status, completed_at, properties(name)")
    .eq("id", payload.id)
    .single();

  if (!instance) return json({ status: "error", detail: "not_found" }, 404);

  const { data: items } = await supabase
    .from("checklist_instance_items")
    .select("id, body, sort_order, is_checked, checked_at")
    .eq("instance_id", instance.id)
    .order("sort_order");

  const { data: reservation } = await supabase
    .from("reservations")
    .select("check_in, check_out")
    .eq("hospitable_reservation_uuid", instance.reservation_uuid)
    .single();

  const total = items?.length ?? 0;
  const done = items?.filter((i) => i.is_checked).length ?? 0;

  return json({
    status: "ok",
    instance_id: instance.id,
    property_name: (instance as any).properties?.name ?? "Property",
    check_in: reservation?.check_in ?? null,
    check_out: reservation?.check_out ?? null,
    overall_status: instance.status,
    items: items ?? [],
    progress: { done, total },
  });
});
```

### Task 5.2: Write `checklist-mark-item` edge function

**Files:**
- Create: `backend/supabase/functions/checklist-mark-item/index.ts`

- [ ] **Step 1: Write**

```ts
// backend/supabase/functions/checklist-mark-item/index.ts
import { json, preflight } from "../_shared/cors.ts";
import { getServiceClient } from "../_shared/supabase.ts";
import { verifyToken } from "../_shared/tokens.ts";

Deno.serve(async (req: Request) => {
  const pf = preflight(req);
  if (pf) return pf;
  if (req.method !== "POST") return json({ status: "method_not_allowed" }, 405);

  const { token, item_id, is_checked } = await req.json().catch(() => ({}));
  if (!token || !item_id) return json({ status: "error", detail: "missing_fields" }, 400);

  const payload = await verifyToken(token);
  if (!payload || payload.kind !== "checklist") {
    return json({ status: "error", detail: "invalid_token" }, 401);
  }

  const supabase = getServiceClient();

  // Verify the item belongs to this instance
  const { data: item } = await supabase
    .from("checklist_instance_items")
    .select("instance_id")
    .eq("id", item_id)
    .single();
  if (!item || item.instance_id !== payload.id) {
    return json({ status: "error", detail: "forbidden" }, 403);
  }

  await supabase
    .from("checklist_instance_items")
    .update({ is_checked: !!is_checked, checked_at: is_checked ? new Date().toISOString() : null })
    .eq("id", item_id);

  // Recompute progress + status
  const { data: items } = await supabase
    .from("checklist_instance_items")
    .select("is_checked")
    .eq("instance_id", payload.id);
  const total = items?.length ?? 0;
  const done = items?.filter((i) => i.is_checked).length ?? 0;
  const newStatus = done === 0 ? "pending" : done === total ? "completed" : "in_progress";

  await supabase
    .from("checklist_instances")
    .update({
      status: newStatus,
      completed_at: newStatus === "completed" ? new Date().toISOString() : null,
    })
    .eq("id", payload.id);

  return json({ status: "ok", progress: { done, total }, overall_status: newStatus });
});
```

### Task 5.3: Write `extras-resolve` edge function

**Files:**
- Create: `backend/supabase/functions/extras-resolve/index.ts`

- [ ] **Step 1: Write**

```ts
// backend/supabase/functions/extras-resolve/index.ts
import { json, preflight } from "../_shared/cors.ts";
import { getServiceClient } from "../_shared/supabase.ts";
import { verifyToken } from "../_shared/tokens.ts";

Deno.serve(async (req: Request) => {
  const pf = preflight(req);
  if (pf) return pf;
  if (req.method !== "POST") return json({ status: "method_not_allowed" }, 405);

  const { token } = await req.json().catch(() => ({}));
  if (!token) return json({ status: "error", detail: "missing_token" }, 400);

  const payload = await verifyToken(token);
  if (!payload || payload.kind !== "extras") {
    return json({ status: "error", detail: "invalid_token" }, 401);
  }

  const supabase = getServiceClient();
  const { data: extra } = await supabase
    .from("extra_requests")
    .select("id, item_requested, reservation_uuid, approval_status, properties(name)")
    .eq("id", payload.id)
    .single();

  if (!extra) return json({ status: "error", detail: "not_found" }, 404);

  // Already responded?
  if (extra.approval_status === "approved" || extra.approval_status === "declined") {
    return json(
      {
        status: "already_responded",
        property_name: (extra as any).properties?.name,
        item_requested: extra.item_requested,
        decision: extra.approval_status,
      },
      200,
    );
  }

  // Fetch guest name from reservations cache for nicer display
  let guestName: string | null = null;
  if (extra.reservation_uuid) {
    const { data: res } = await supabase
      .from("reservations")
      .select("guest_name")
      .eq("hospitable_reservation_uuid", extra.reservation_uuid)
      .single();
    guestName = res?.guest_name ?? null;
  }

  return json({
    status: "ok",
    extra_id: extra.id,
    property_name: (extra as any).properties?.name ?? "Property",
    guest_name: guestName,
    item_requested: extra.item_requested,
  });
});
```

### Task 5.4: Write `extras-respond` edge function

**Files:**
- Create: `backend/supabase/functions/extras-respond/index.ts`

- [ ] **Step 1: Write**

```ts
// backend/supabase/functions/extras-respond/index.ts
import { json, preflight } from "../_shared/cors.ts";
import { getServiceClient } from "../_shared/supabase.ts";
import { verifyToken } from "../_shared/tokens.ts";

Deno.serve(async (req: Request) => {
  const pf = preflight(req);
  if (pf) return pf;
  if (req.method !== "POST") return json({ status: "method_not_allowed" }, 405);

  const { token, decision } = await req.json().catch(() => ({}));
  if (!token || !["approved", "declined"].includes(decision)) {
    return json({ status: "error", detail: "missing_or_invalid_fields" }, 400);
  }

  const payload = await verifyToken(token);
  if (!payload || payload.kind !== "extras") {
    return json({ status: "error", detail: "invalid_token" }, 401);
  }

  const supabase = getServiceClient();

  // Idempotent — only update if still pending
  const { data: tokenRow } = await supabase
    .from("extras_approval_tokens")
    .select("*")
    .eq("token", token)
    .single();
  if (!tokenRow) return json({ status: "error", detail: "token_not_recorded" }, 404);
  if (tokenRow.status !== "pending") {
    return json({ status: "already_responded", decision: tokenRow.status }, 200);
  }

  const now = new Date().toISOString();

  await supabase
    .from("extras_approval_tokens")
    .update({ status: decision, responded_at: now })
    .eq("token", token);

  await supabase
    .from("extra_requests")
    .update({ approval_status: decision, approved_by_phone: tokenRow.recipient_phone })
    .eq("id", payload.id);

  // Fire main-agent with a synthetic decision message
  const { data: extra } = await supabase
    .from("extra_requests")
    .select("reservation_uuid, item_requested, properties(hospitable_property_uuid)")
    .eq("id", payload.id)
    .single();

  if (extra) {
    const triggerSecret = Deno.env.get("TRIGGER_SECRET_KEY");
    const syntheticBody =
      decision === "approved"
        ? `[host-decision] Host approved extra request: "${extra.item_requested}". Reply to the guest that we will deliver this for them.`
        : `[host-decision] Host declined extra request: "${extra.item_requested}". Reply to the guest apologizing that this cannot be accommodated this time.`;

    const triggerPayload = {
      payload: {
        event: "host.extras_decision",
        data: {
          action: "message.created",
          data: {
            reservation_id: extra.reservation_uuid,
            sender_type: "system",
            body: syntheticBody,
            property: { id: (extra as any).properties?.hospitable_property_uuid },
            sender: { first_name: "host" },
          },
        },
        received_at: now,
      },
    };

    await fetch("https://api.trigger.dev/api/v1/tasks/main-agent-workflow/trigger", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${triggerSecret}`,
      },
      body: JSON.stringify(triggerPayload),
    });
  }

  return json({ status: "ok", decision });
});
```

### Task 5.5: Deploy all four public edge functions

- [ ] **Step 1: Deploy**

```bash
cd /Users/vedantchellani/Desktop/Uncommon/backend
npx supabase functions deploy checklist-resolve --project-ref bxjdrbktiycmdrozjpgw --no-verify-jwt
npx supabase functions deploy checklist-mark-item --project-ref bxjdrbktiycmdrozjpgw --no-verify-jwt
npx supabase functions deploy extras-resolve --project-ref bxjdrbktiycmdrozjpgw --no-verify-jwt
npx supabase functions deploy extras-respond --project-ref bxjdrbktiycmdrozjpgw --no-verify-jwt
```

Expected: each prints a function URL.

- [ ] **Step 2: Smoke test (invalid token rejects cleanly)**

```bash
curl -X POST "https://bxjdrbktiycmdrozjpgw.supabase.co/functions/v1/checklist-resolve" \
  -H "Content-Type: application/json" \
  -d '{"token":"invalid"}'
```

Expected: `{"status":"error","detail":"invalid_token"}` with HTTP 401.

- [ ] **Step 3: Commit**

```bash
cd /Users/vedantchellani/Desktop/Uncommon
git add backend/supabase/functions/
git commit -m "feat(edge): checklist + extras public API edge functions"
```

---

## Phase 6: Dashboard — Public Routes

### Task 6.1: Add public route branch to App.tsx

**Files:**
- Modify: `dashboard/src/App.tsx`

- [ ] **Step 1: Add public routes**

Replace `App.tsx` with:

```tsx
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "./lib/auth";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import Overview from "./pages/Overview";
import PropertiesKB from "./pages/PropertiesKB";
import Tickets from "./pages/Tickets";
import AgentConfig from "./pages/AgentConfig";
import Users from "./pages/Users";
import SmsRecipients from "./pages/SmsRecipients";
import Reservations from "./pages/Reservations";
import CleanerChecklist from "./pages/public/CleanerChecklist";
import ExtrasApproval from "./pages/public/ExtrasApproval";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Public, no auth */}
        <Route path="/c/:token" element={<CleanerChecklist />} />
        <Route path="/r/:token" element={<ExtrasApproval />} />

        {/* Auth-required */}
        <Route path="*" element={
          <AuthProvider>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route element={<Layout />}>
                <Route index element={<Overview />} />
                <Route path="properties" element={<PropertiesKB />} />
                <Route path="tickets" element={<Tickets />} />
                <Route path="reservations" element={<Reservations />} />
                <Route path="agent-config" element={<AgentConfig />} />
                <Route path="users" element={<Users />} />
                <Route path="sms-recipients" element={<SmsRecipients />} />
              </Route>
            </Routes>
          </AuthProvider>
        } />
      </Routes>
    </BrowserRouter>
  );
}
```

### Task 6.2: Add the Edge Function URL helper

**Files:**
- Create: `dashboard/src/lib/edge.ts`

- [ ] **Step 1: Write**

```ts
// dashboard/src/lib/edge.ts
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export async function callEdge<T = unknown>(
  fn: string,
  body: Record<string, unknown>,
): Promise<{ status: number; data: T | { status: string; detail?: string } }> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${fn}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ANON_KEY}`,
      apikey: ANON_KEY,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}
```

### Task 6.3: Build `CleanerChecklist` public page

**Files:**
- Create: `dashboard/src/pages/public/CleanerChecklist.tsx`

- [ ] **Step 1: Write**

```tsx
// dashboard/src/pages/public/CleanerChecklist.tsx
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { callEdge } from "../../lib/edge";
import { CheckCircle2, Circle } from "lucide-react";

interface ChecklistItem {
  id: string;
  body: string;
  sort_order: number;
  is_checked: boolean;
}
interface ChecklistData {
  property_name: string;
  check_in: string | null;
  check_out: string | null;
  overall_status: string;
  items: ChecklistItem[];
  progress: { done: number; total: number };
}

export default function CleanerChecklist() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<ChecklistData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    callEdge<ChecklistData>("checklist-resolve", { token }).then(({ status, data }) => {
      if (status !== 200) {
        setError((data as any).detail || "Could not load checklist.");
      } else {
        setData(data as ChecklistData);
      }
    });
  }, [token]);

  const toggle = async (item: ChecklistItem) => {
    if (!data || !token) return;
    const next = !item.is_checked;
    setData({
      ...data,
      items: data.items.map((i) => (i.id === item.id ? { ...i, is_checked: next } : i)),
    });
    await callEdge("checklist-mark-item", { token, item_id: item.id, is_checked: next });
  };

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="bg-white rounded-2xl p-8 max-w-sm shadow text-center">
          <h1 className="text-xl font-semibold text-gray-900 mb-2">Link not valid</h1>
          <p className="text-gray-500">{error}</p>
        </div>
      </div>
    );
  }
  if (!data) return <div className="min-h-screen flex items-center justify-center text-gray-400">Loading...</div>;

  const pct = data.progress.total === 0 ? 0 : Math.round((data.progress.done / data.progress.total) * 100);

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-5 py-4 sticky top-0 z-10">
        <div className="text-sm text-gray-400 uppercase tracking-wider">Cleaning Checklist</div>
        <h1 className="text-xl font-semibold text-gray-900 mt-0.5">{data.property_name}</h1>
        {(data.check_in || data.check_out) && (
          <div className="text-sm text-gray-500 mt-1">
            Check-in {data.check_in} {data.check_out && `→ Check-out ${data.check_out}`}
          </div>
        )}
        <div className="mt-3 h-2 bg-gray-100 rounded-full overflow-hidden">
          <div className="h-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
        </div>
        <div className="text-xs text-gray-400 mt-1.5">
          {data.progress.done} of {data.progress.total} complete
        </div>
      </header>

      <main className="p-5 space-y-3 pb-12">
        {data.items.map((item) => (
          <button
            key={item.id}
            onClick={() => toggle(item)}
            className={`w-full text-left p-4 rounded-xl border flex items-start gap-3 transition-colors ${
              item.is_checked ? "bg-emerald-50 border-emerald-200" : "bg-white border-gray-200"
            }`}
          >
            {item.is_checked ? (
              <CheckCircle2 size={26} className="text-emerald-500 shrink-0 mt-0.5" />
            ) : (
              <Circle size={26} className="text-gray-300 shrink-0 mt-0.5" />
            )}
            <span className={`text-base ${item.is_checked ? "text-emerald-900 line-through" : "text-gray-800"}`}>
              {item.body}
            </span>
          </button>
        ))}
      </main>
    </div>
  );
}
```

### Task 6.4: Build `ExtrasApproval` public page

**Files:**
- Create: `dashboard/src/pages/public/ExtrasApproval.tsx`

- [ ] **Step 1: Write**

```tsx
// dashboard/src/pages/public/ExtrasApproval.tsx
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { callEdge } from "../../lib/edge";
import { Check, X } from "lucide-react";

interface ExtrasData {
  property_name: string;
  guest_name: string | null;
  item_requested: string;
}

export default function ExtrasApproval() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<ExtrasData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<"approved" | "declined" | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) return;
    callEdge<ExtrasData | { status: string; decision?: string }>("extras-resolve", { token }).then(
      ({ status, data }) => {
        if (status === 200 && (data as any).status === "already_responded") {
          setResult(((data as any).decision as "approved" | "declined") ?? null);
        } else if (status !== 200) {
          setError((data as any).detail || "Could not load request.");
        } else {
          setData(data as ExtrasData);
        }
      },
    );
  }, [token]);

  const respond = async (decision: "approved" | "declined") => {
    if (!token) return;
    setSubmitting(true);
    const { status } = await callEdge("extras-respond", { token, decision });
    if (status === 200) setResult(decision);
    else setError("Could not record response. Try again.");
    setSubmitting(false);
  };

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="bg-white rounded-2xl p-8 max-w-sm shadow text-center">
          <h1 className="text-xl font-semibold text-gray-900 mb-2">Link not valid</h1>
          <p className="text-gray-500">{error}</p>
        </div>
      </div>
    );
  }

  if (result) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="bg-white rounded-2xl p-8 max-w-sm shadow text-center">
          {result === "approved" ? (
            <Check size={48} className="text-emerald-500 mx-auto mb-3" />
          ) : (
            <X size={48} className="text-red-500 mx-auto mb-3" />
          )}
          <h1 className="text-xl font-semibold text-gray-900">Recorded as {result}</h1>
          <p className="text-gray-500 mt-1">The guest will be updated automatically.</p>
        </div>
      </div>
    );
  }

  if (!data) return <div className="min-h-screen flex items-center justify-center text-gray-400">Loading...</div>;

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl p-7 max-w-sm w-full shadow">
        <div className="text-sm text-gray-400 uppercase tracking-wider">Guest Request</div>
        <h1 className="text-xl font-semibold text-gray-900 mt-1">{data.property_name}</h1>
        {data.guest_name && <div className="text-sm text-gray-500 mt-0.5">from {data.guest_name}</div>}

        <div className="mt-5 bg-amber-50 border border-amber-200 rounded-xl p-4">
          <div className="text-sm text-amber-700 mb-1">Requested item</div>
          <div className="text-lg text-gray-900 font-medium">{data.item_requested}</div>
        </div>

        <div className="grid grid-cols-2 gap-3 mt-6">
          <button
            disabled={submitting}
            onClick={() => respond("declined")}
            className="py-3 text-base font-medium bg-white border border-red-300 text-red-600 rounded-xl hover:bg-red-50 disabled:opacity-50"
          >
            Decline
          </button>
          <button
            disabled={submitting}
            onClick={() => respond("approved")}
            className="py-3 text-base font-medium bg-emerald-500 text-white rounded-xl hover:bg-emerald-600 disabled:opacity-50"
          >
            Approve
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Local dev test**

```bash
cd /Users/vedantchellani/Desktop/Uncommon/dashboard
npm run dev
```

Open `http://localhost:5173/c/invalid` — expected: "Link not valid" page. Same for `/r/invalid`. Press Ctrl+C.

- [ ] **Step 3: Commit**

```bash
cd /Users/vedantchellani/Desktop/Uncommon
git add dashboard/src/
git commit -m "feat(dashboard): public /c/:token and /r/:token mobile pages"
```

---

## Phase 7: Dashboard — Reservations Tab

### Task 7.1: Add nav entry + route

**Files:**
- Modify: `dashboard/src/components/Layout.tsx`

- [ ] **Step 1: Add to nav**

In `dashboard/src/components/Layout.tsx`, replace the `baseNav` array:

```tsx
import { Home, Building2, Wrench, Settings, Users, Bell, LogOut, Menu, X, Calendar } from "lucide-react";

const baseNav = [
  { to: "/", icon: Home, label: "Overview" },
  { to: "/reservations", icon: Calendar, label: "Reservations" },
];
```

### Task 7.2: Build Reservations page

**Files:**
- Create: `dashboard/src/pages/Reservations.tsx`

- [ ] **Step 1: Write**

```tsx
// dashboard/src/pages/Reservations.tsx
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { ChevronRight } from "lucide-react";

interface ReservationRow {
  id: string;
  hospitable_reservation_uuid: string;
  guest_name: string | null;
  platform: string | null;
  check_in: string | null;
  check_out: string | null;
  status: string | null;
  property_id: string;
  properties: { name: string } | null;
  checklist_instances: { id: string; status: string }[];
}

const statusColor: Record<string, string> = {
  pending: "bg-gray-100 text-gray-700",
  in_progress: "bg-amber-100 text-amber-700",
  completed: "bg-emerald-100 text-emerald-700",
};

export default function Reservations() {
  const [rows, setRows] = useState<ReservationRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from("reservations")
      .select(
        "id, hospitable_reservation_uuid, guest_name, platform, check_in, check_out, status, property_id, properties(name), checklist_instances(id, status)"
      )
      .order("check_in", { ascending: false })
      .limit(200)
      .then(({ data }) => {
        setRows((data as unknown as ReservationRow[]) ?? []);
        setLoading(false);
      });
  }, []);

  if (loading) return <div className="p-10 text-gray-400">Loading...</div>;

  return (
    <div className="max-w-6xl mx-auto px-8 py-10">
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">Reservations</h1>
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <table className="w-full text-base">
          <thead>
            <tr className="border-b border-gray-100 text-sm text-gray-400 uppercase tracking-wider">
              <th className="text-left px-5 py-4 font-medium">Guest</th>
              <th className="text-left px-5 py-4 font-medium">Property</th>
              <th className="text-left px-5 py-4 font-medium">Check-in</th>
              <th className="text-left px-5 py-4 font-medium">Check-out</th>
              <th className="text-left px-5 py-4 font-medium">Platform</th>
              <th className="text-left px-5 py-4 font-medium">Checklist</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const cl = r.checklist_instances?.[0];
              return (
                <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="px-5 py-4 text-gray-900">{r.guest_name ?? "—"}</td>
                  <td className="px-5 py-4 text-gray-700">{r.properties?.name ?? "—"}</td>
                  <td className="px-5 py-4 text-gray-700">{r.check_in ?? "—"}</td>
                  <td className="px-5 py-4 text-gray-700">{r.check_out ?? "—"}</td>
                  <td className="px-5 py-4 text-gray-400 capitalize">{r.platform ?? "—"}</td>
                  <td className="px-5 py-4">
                    {cl ? (
                      <span className={`text-xs px-2 py-1 rounded ${statusColor[cl.status] ?? "bg-gray-100 text-gray-600"}`}>
                        {cl.status}
                      </span>
                    ) : (
                      <span className="text-xs text-gray-400">no template</span>
                    )}
                  </td>
                  <td className="px-3 py-4 text-right">
                    <ChevronRight size={18} className="text-gray-300" />
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-5 py-16 text-center text-gray-400">No reservations yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add dashboard/src/
git commit -m "feat(dashboard): Reservations tab listing reservation cache with checklist status"
```

---

## Phase 8: Dashboard — Checklist Template Editor

### Task 8.1: Add Checklist Template panel inside PropertiesKB

**Files:**
- Create: `dashboard/src/components/ChecklistTemplateEditor.tsx`

- [ ] **Step 1: Write the editor component**

```tsx
// dashboard/src/components/ChecklistTemplateEditor.tsx
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { Plus, Trash2, GripVertical } from "lucide-react";

interface Item { id: string; body: string; sort_order: number; }

export default function ChecklistTemplateEditor({ propertyId }: { propertyId: string }) {
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [newBody, setNewBody] = useState("");
  const [loading, setLoading] = useState(true);

  const ensureTemplate = async () => {
    const { data: existing } = await supabase
      .from("checklist_templates")
      .select("id")
      .eq("property_id", propertyId)
      .single();
    if (existing) return existing.id;
    const { data: created } = await supabase
      .from("checklist_templates")
      .insert({ property_id: propertyId, name: "Cleaning Checklist" })
      .select("id")
      .single();
    return created?.id ?? null;
  };

  const load = async () => {
    setLoading(true);
    const tid = await ensureTemplate();
    setTemplateId(tid);
    if (tid) {
      const { data } = await supabase
        .from("checklist_template_items")
        .select("id, body, sort_order")
        .eq("template_id", tid)
        .order("sort_order");
      setItems(data ?? []);
    }
    setLoading(false);
  };
  useEffect(() => { load(); }, [propertyId]);

  const addItem = async () => {
    if (!templateId || !newBody.trim()) return;
    const next = items.length;
    await supabase
      .from("checklist_template_items")
      .insert({ template_id: templateId, body: newBody.trim(), sort_order: next });
    setNewBody("");
    load();
  };

  const removeItem = async (id: string) => {
    if (!confirm("Remove this item?")) return;
    await supabase.from("checklist_template_items").delete().eq("id", id);
    load();
  };

  if (loading) return <div className="text-gray-400 py-6">Loading template...</div>;

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-500">
        Items here are copied into a fresh checklist when a new reservation is created.
      </p>

      <div className="space-y-2">
        {items.map((it) => (
          <div key={it.id} className="flex items-center gap-3 bg-white border border-gray-200 rounded-lg px-3 py-2.5">
            <GripVertical size={18} className="text-gray-300" />
            <span className="flex-1 text-base text-gray-800">{it.body}</span>
            <button onClick={() => removeItem(it.id)} className="p-1 text-gray-300 hover:text-red-500">
              <Trash2 size={18} />
            </button>
          </div>
        ))}
        {items.length === 0 && <div className="text-sm text-gray-400 py-3">No items yet.</div>}
      </div>

      <div className="flex gap-2 pt-2">
        <input
          value={newBody}
          onChange={(e) => setNewBody(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addItem()}
          placeholder="e.g. Replace towels in the master bath"
          className="flex-1 px-3 py-2 text-base border border-gray-200 rounded-lg"
        />
        <button
          onClick={addItem}
          disabled={!newBody.trim()}
          className="flex items-center gap-1.5 px-4 py-2 text-base bg-gray-900 text-white rounded-lg disabled:opacity-40"
        >
          <Plus size={18} /> Add
        </button>
      </div>
    </div>
  );
}
```

### Task 8.2: Wire it into PropertiesKB.tsx property detail

**Files:**
- Modify: `dashboard/src/pages/PropertiesKB.tsx`

- [ ] **Step 1: Import the new component**

At the top of `PropertiesKB.tsx`, add:

```tsx
import ChecklistTemplateEditor from "../components/ChecklistTemplateEditor";
```

- [ ] **Step 2: Add a tab/section in the property detail panel**

Inside the right-hand property detail panel JSX (where KB entries are rendered for the selected property), add a collapsible "Cleaning Checklist" section. Locate the section near where KB entries render and add above or below it:

```tsx
{selectedId && (
  <section className="mb-8">
    <h3 className="text-lg font-semibold text-gray-900 mb-3">Cleaning Checklist Template</h3>
    <ChecklistTemplateEditor propertyId={selectedId} />
  </section>
)}
```

(Exact placement depends on the layout. If unsure, place it just after the existing KB entries section in the right panel.)

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/
git commit -m "feat(dashboard): per-property cleaning checklist template editor"
```

---

## Phase 9: Dashboard — SMS Recipient New Columns

### Task 9.1: Add two new toggles to SmsRecipients table

**Files:**
- Modify: `dashboard/src/pages/SmsRecipients.tsx`

- [ ] **Step 1: Extend the Recipient interface**

Find the `interface Recipient { ... }` block and add the two new fields:

```tsx
interface Recipient {
  id: string; name: string; phone: string;
  receives_maintenance_low: boolean; receives_maintenance_medium: boolean; receives_maintenance_high: boolean;
  receives_kb_gaps: boolean; receives_checkin_checkout: boolean;
  receives_extras: boolean;
  receives_reservation_checklist: boolean;
  is_active: boolean;
}
```

- [ ] **Step 2: Extend the add-form `form` state**

```tsx
const [form, setForm] = useState({
  name: "", phone: "",
  receives_maintenance_low: true, receives_maintenance_medium: true, receives_maintenance_high: true,
  receives_kb_gaps: true, receives_checkin_checkout: true,
  receives_extras: false, receives_reservation_checklist: false,
});
```

- [ ] **Step 3: Add two checkboxes inside the "add recipient" form block**

In the existing block with `KB gap escalations` and `Check-in / checkout requests` checkboxes, add two more side-by-side:

```tsx
<label className="flex items-center gap-2 text-base text-gray-600">
  <input type="checkbox" checked={form.receives_extras}
    onChange={(e) => setForm({ ...form, receives_extras: e.target.checked })}
    className="rounded w-5 h-5" />
  Extras approval requests
</label>
<label className="flex items-center gap-2 text-base text-gray-600">
  <input type="checkbox" checked={form.receives_reservation_checklist}
    onChange={(e) => setForm({ ...form, receives_reservation_checklist: e.target.checked })}
    className="rounded w-5 h-5" />
  New reservation checklist
</label>
```

- [ ] **Step 4: Add two columns to the table header and body**

In the `<thead>` row that has `KB Gaps` and `Check-in/out`, add two more columns:

```tsx
<th className="text-center px-5 py-4 font-medium">Extras</th>
<th className="text-center px-5 py-4 font-medium">Checklist</th>
```

In the `<tbody>` row, add two more cells before the actions cell:

```tsx
<td className="px-5 py-4 text-center">
  <button onClick={() => toggle(r.id, "receives_extras", r.receives_extras)}
    className={`w-6 h-6 rounded ${r.receives_extras ? "bg-orange-500" : "bg-gray-200"}`} />
</td>
<td className="px-5 py-4 text-center">
  <button onClick={() => toggle(r.id, "receives_reservation_checklist", r.receives_reservation_checklist)}
    className={`w-6 h-6 rounded ${r.receives_reservation_checklist ? "bg-emerald-500" : "bg-gray-200"}`} />
</td>
```

Also extend the empty sub-header row to accommodate the two new columns (add two empty `<th />` cells).

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/
git commit -m "feat(dashboard): sms_recipients receives_extras + receives_reservation_checklist toggles"
```

---

## Phase 10: Dashboard — Turno Cleanup

### Task 10.1: Remove Turno fields from PropertiesKB.tsx Property interface

**Files:**
- Modify: `dashboard/src/pages/PropertiesKB.tsx`

- [ ] **Step 1: Strip turno fields from Property interface**

Find the `interface Property { ... }` block and remove these two lines:

```tsx
turno_property_id: string | null;
turno_alias: string | null;
```

- [ ] **Step 2: Remove any UI that displays `turno_alias` or `turno_property_id`**

Search `PropertiesKB.tsx` for `turno_alias` and `turno_property_id` and delete the lines that render or reference them. Replace with nothing — these fields are gone.

```bash
grep -n "turno" /Users/vedantchellani/Desktop/Uncommon/dashboard/src/pages/PropertiesKB.tsx
```

Each match → delete the line.

- [ ] **Step 3: Rebuild and verify**

```bash
cd /Users/vedantchellani/Desktop/Uncommon/dashboard
npm run build
```

Expected: build completes with zero TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/
git commit -m "chore(dashboard): drop Turno columns from Property interface"
```

---

## Phase 11: Update property-sync.ts (drop Turno sync)

### Task 11.1: Edit property-sync.ts

**Files:**
- Modify: `backend/trigger/property-sync.ts`

- [ ] **Step 1: Open the file and locate any Turno-related blocks**

```bash
grep -n "turno\|listProperties" /Users/vedantchellani/Desktop/Uncommon/backend/trigger/property-sync.ts
```

- [ ] **Step 2: Remove every Turno import, call, and reference**

Strip:
- `import { listProperties } from ...turno...`
- The Turno fetch + matching code block
- `turno_property_id` and `turno_alias` from the `upsert` payload

Keep only the Hospitable property fetch + upsert into `properties`.

- [ ] **Step 3: Verify compile**

```bash
cd /Users/vedantchellani/Desktop/Uncommon
npx trigger.dev@4.4.4 dev --skip-update-check
```

Expected: starts with no import errors. Press Ctrl+C.

- [ ] **Step 4: Commit**

```bash
git add backend/trigger/property-sync.ts
git commit -m "refactor(trigger): drop Turno integration from property-sync"
```

---

## Phase 12: Sonic Branding

### Task 12.1: Generate logo via Gemini

This is a manual step performed by the user. Pause here.

- [ ] **Step 1: Get a Sonic-themed logo from Gemini**

The user uses Gemini to generate a Sonic-themed logo (blue mascot, friendly, AI-coded aesthetic), saves it as a PNG, and provides the file at:

`/Users/vedantchellani/Desktop/Uncommon/dashboard/public/logo.png` (overwriting the existing logo)

- [ ] **Step 2: Verify it loads in the sidebar**

```bash
cd /Users/vedantchellani/Desktop/Uncommon/dashboard
npm run dev
```

Visit `http://localhost:5173/login`, log in, confirm the new logo renders in the sidebar.

- [ ] **Step 3: Commit**

```bash
git add dashboard/public/logo.png
git commit -m "feat(branding): swap dashboard logo to Sonic-themed Iris de Mer mascot"
```

---

## Phase 13: Deploy & End-to-End Test

### Task 13.1: Update test-reservation filter or remove for production

**Files:**
- Modify: `backend/trigger/messaging/main-agent.ts` (the `ALLOWED_RESERVATION_UUIDS` constant)

- [ ] **Step 1: Decide based on current state**

If still in testing with the new client → swap the array contents to the new client's test reservation UUID. The user provides the new UUID.

If going to live production → remove the entire filter block (the `if (!ALLOWED_RESERVATION_UUIDS.includes(reservationUuid))` check).

- [ ] **Step 2: Commit**

```bash
git add backend/trigger/messaging/main-agent.ts
git commit -m "chore(agent): update test reservation filter for Iris de Mer"
```

### Task 13.2: Deploy Trigger.dev workflows

- [ ] **Step 1: Deploy**

```bash
cd /Users/vedantchellani/Desktop/Uncommon
npx trigger.dev@4.4.4 deploy
```

Expected: deploys 4 tasks (`main-agent-workflow`, `reservation-webhook`, `property-sync`, `supabase-keepalive`) to `proj_ofggmqipbwsuiltgqlej`. Prints production deployment URL.

- [ ] **Step 2: Set production secrets in Trigger.dev**

Via Trigger.dev dashboard → Project → Environment Variables → Production. Add (copy from local `.env`):

- `ANTHROPIC_API_KEY`
- `HOSPITABLE_API_TOKEN`
- `SMSAPI_TOKEN`
- `SMSAPI_SENDER_NAME`
- `SUPABASE_URL` = `https://bxjdrbktiycmdrozjpgw.supabase.co`
- `SUPABASE_SERVICE_ROLE_KEY`
- `PUBLIC_LINK_SIGNING_SECRET`
- `DASHBOARD_HOST` = (the final Render URL once Phase 13.3 is done; set placeholder for now and update after)

### Task 13.3: Deploy dashboard to Render

This involves Render account access — pause and ask user to:

- [ ] **Step 1: Create new Render Web Service** linked to this repo, root directory `dashboard/`, build command `npm install && npm run build`, publish directory `dist/`, environment variables `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` set to the new project values.

- [ ] **Step 2: Capture the Render URL** (something like `https://iris-de-mer.onrender.com`).

- [ ] **Step 3: Update `DASHBOARD_HOST` in Trigger.dev prod env vars** to this URL.

### Task 13.4: Register Hospitable webhook

The user does this in Hospitable's dashboard:

- [ ] **Step 1: Add webhook** targeting `https://bxjdrbktiycmdrozjpgw.supabase.co/functions/v1/hospitable-webhook` for events:
  - `message.created`
  - `reservation.created`

### Task 13.5: End-to-end smoke test

- [ ] **Step 1: Trigger a test webhook**

```bash
curl -X POST "https://api.hospitable.com/v1/webhooks-next/8870253e-d55a-43f4-83d6-67482cf6ba12/test" \
  -H "Authorization: Bearer $HOSPITABLE_API_TOKEN"
```

(Or use Hospitable's "Send test" button in the dashboard.)

- [ ] **Step 2: Observe**

- Supabase function logs show `hospitable-webhook` receiving the POST.
- Trigger.dev run appears for the appropriate task.
- For a `message.created` → guest reply lands in Hospitable inbox.
- For a `reservation.created` → `reservations` row appears, `checklist_instances` row appears (if template exists), SMS sent to recipients.

### Task 13.6: Final commit

```bash
cd /Users/vedantchellani/Desktop/Uncommon
git add -A
git commit -m "chore: end-to-end deployment verified"
```

---

## Out-of-Scope Reminders

- Multi-tenant hierarchy (partner / organization layer from Convrse) — NOT implemented.
- Sessions / session_messages tables — NOT implemented; conversation history still fetched live from Hospitable.
- Telemetry tables — NOT implemented.
- Multi-PMS support — Hospitable only.
- Voice / Telnyx / LiveKit — NOT implemented.
- Billing / Stripe — NOT implemented.
- Hospitable webhook signature verification — deferred to follow-up; current security model is URL secrecy + payload validation.
