---
name: phillip-island-guesty-clone-design
created: 2026-06-22
status: awaiting-review
---

# Phillip Island Guest Agent — Sonic AI clone (Hospitable → Guesty)

## 1. Goal

Clone the existing **Sonic AI** text-messaging guest agent (`sonic_ai_vedant_version/`,
dashboard title "Sonic AI · Iris de Mer") into a self-contained project at `philiphiland/`
for the **Phillip Island Co-Hosts** client, with three changes:

1. Replace the **Hospitable** PMS integration with **Guesty** (Open API).
2. Point at a new Supabase project (`https://ictumlksmzjenevtaqvp.supabase.co`), set up from scratch.
3. Apply the **prompt/guardrail lessons** from the 2026-06-17 call that actually map to a text agent.

**Out of scope:** the LiveKit/Gemini voice agent debugged in the transcript (VAD, turn-detection,
dual-tool-calls, going-silent). The user will provide that code separately. None of those
voice-specific fixes apply to this text agent.

## 2. Approach

**Approach A — faithful copy + targeted Guesty swap.** Copy the whole project, replace the single
PMS module (`helpers/hospitable.ts`) with `helpers/guesty.ts` exposing the *same function shapes*,
adapt the ~13 callers, rename the webhook ingress, and make one small DB change. All business logic
(KB lookup, maintenance tickets, extras approval, cleaning checklist, cooldowns, SMS routing,
dashboard) is preserved unchanged.

Rejected: a generic pluggable `PMS` interface (YAGNI — only Guesty is needed) and a backend-only
clone (the dashboard is the client's admin surface).

## 3. Why this is tractable

The codebase already isolates the PMS behind one file. Callers invoke `getReservation`,
`getReservationMessages`, `sendMessage`, `listProperties`, `getPropertyDetails` — not Hospitable
URLs. Replacing that module + adapting callers is the whole migration.

**The one structural difference:** Hospitable keys messaging by `reservation_id`
(`POST /reservations/{id}/messages`). Guesty keys it by **`conversationId`**
(`POST /communication/conversations/{conversationId}/send-message`). So the clone must carry a
`conversationId` through the agent run, which the original never tracked. The Guesty inbound-message
webhook supplies both `reservationId` and `conversation._id`, so we capture it at ingress and thread
it through `AgentContext`.

## 4. Guesty Open API reference (verified against docs 2026-06-22)

Base URL: `https://open-api.guesty.com/v1`

### 4.1 Auth — OAuth2 client credentials
- `POST https://open-api.guesty.com/oauth2/token`
- `Content-Type: application/x-www-form-urlencoded`
- Body: `grant_type=client_credentials`, `scope=open-api`, `client_id=<id>`, `client_secret=<secret>`
- Response: `{ "token_type": "Bearer", "access_token": "...", "expires_in": 86400, ... }`
- Token valid **24h**; Guesty allows **max 5 tokens per API key per 24h** → MUST cache the token
  (in-memory in the Trigger.dev run + a Supabase `guesty_tokens` cache row, or a module-level cache
  with expiry) and reuse it. Never request a token per call.
- **First implementation step:** validate this exact request against the live endpoint with the
  provided creds (the docs renderer was ambiguous on field casing; the live 200 response is the
  source of truth).

### 4.2 Reservations
- `GET /v1/reservations/{id}` → `_id`, `guest` (`fullName`/`firstName`/`lastName`), `guestId`,
  `listingId`, `checkIn`, `checkOut`, `status`, `integration`/`source` (booking channel).
- `GET /v1/reservations?...` for listing/import flows (filters + `limit`/`skip` paging).

### 4.3 Listings (= properties)
- `GET /v1/listings/{id}` → `_id`, `nickname`, `title`, `address`, `timezone`, `accountId`.
- `GET /v1/listings?limit=100&skip=N` for the property-sync import.

### 4.4 Communication / conversations (messaging)
- Conversation detail incl. message thread: `GET /v1/communication/conversations/{id}`
  (thread/posts array). Often unnecessary because the inbound webhook already includes
  `conversation.thread`.
- **Send a message:** `POST /v1/communication/conversations/{conversationId}/send-message`
  - Body: `{ "body": "<text>", "module": "<channel>" }`
  - `module` ∈ `airbnb2` | `booking` | `homeaway` | `email` | `sms` | `whatsapp` (reply on the same
    channel the inbound message arrived on; fall back to `email`).

### 4.5 Inbound-message webhook
- Event: **`reservation.messageReceived`** (fires for new Guests-Inbox / Owners-Inbox messages).
- Payload (key fields): `event`, `reservationId`, `conversation` (`_id`, `guestId`,
  `conversationWith` e.g. `"Guest"`, `thread[]`, `meta.guestName`, `integration.platform`),
  `message` (`type`, `body`, `module`, `createdAt`, `reservationId`).
- Identify a **guest** message: `message.type === "fromGuest"` (also accept `"fromThirdParty"`),
  AND `conversation.conversationWith === "Guest"`. Ignore `fromHost`.
- Register via `POST /v1/webhooks` with event `reservation.messageReceived` pointing at our ingress
  Edge Function URL.

Sources: open-api-docs.guesty.com (root, send-message reference, webhooks-messages, quick-start).

## 5. File-by-file change list (the migration surface)

Copied from `sonic_ai_vedant_version/` → `philiphiland/`, excluding `whole/`, `node_modules/`,
`.trigger/`, `dashboard/dist/`, `.git/`, `.DS_Store`.

**New / replaced:**
- `backend/trigger/helpers/guesty.ts` — NEW. OAuth2 token cache + `getReservation`,
  `getReservationMessages` (thread), `sendMessage(conversationId, body, module)`, `listListings`,
  `getListingDetails`. Delete `helpers/hospitable.ts`.
- `backend/supabase/functions/guesty-webhook/index.ts` — renamed from `hospitable-webhook`; parses
  `reservation.messageReceived`, filters guest messages, normalizes `{reservationId, conversationId,
  body, module, guestName}`, triggers the task.

**Adapted callers:**
- `backend/trigger/messaging/main-agent.ts` — webhook payload type; `AgentContext` gains
  `conversationId` + `channelModule`; property lookup by `guesty_listing_id`; reply via
  `sendMessage(conversationId, reply, module)`; conversation history from thread; agent guardrails
  (§7); branding (business name, footer phone).
- `backend/trigger/flows/import-properties.ts`, `import-reservations.ts`,
  `sync-property-knowledge.ts`, `reservation-webhook.ts` — Guesty listings/reservations + column rename.
- `backend/trigger/property-sync.ts` — Guesty listings import.
- `backend/supabase/functions/list-reservations/index.ts` — Guesty reservations.
- `backend/supabase/functions/extras-respond/`, `extras-resolve/`, `checklist-resolve/` — use
  `guesty.sendMessage`/conversationId where they currently send via Hospitable reservation_id.
- `scripts/populate-kb.ts` — Guesty listing ids.
- `dashboard/src/pages/Reservations.tsx`, `ReservationDetail.tsx`, `PropertiesKB.tsx` — column rename
  + Guesty links/labels.
- `trigger.config.ts`, `backend/supabase/config.toml` — new project refs.

## 6. Database (new Supabase, from scratch)

Apply all 8 existing migrations to the new project, with ONE schema change, then seed
`urgency_categories`.

- `properties.hospitable_property_uuid` → **`guesty_listing_id`** (`text not null unique`).
- `reservation_uuid` columns keep their name but store the Guesty reservation `_id` (string).
  `conversationId` is run-scoped (passed via payload), not persisted — no column needed.
- Everything else (knowledge_bases, kb_gap_log, cooldowns, urgency_categories, maintenance_tickets,
  allowed_extras, extra_requests, sms_recipients (+ routing/extras cols), agent_activity_log,
  checklist tables, profiles + `handle_new_user` trigger, RLS policies) is created unchanged.
- Migrate via Supabase CLI linked to the new project (needs DB password) or `db push`.

## 7. Agent behavior — transcript-derived guardrails (text-agent-applicable only)

The 2026-06-17 call was about a voice agent; only these lessons generalize to the Claude
text coordinator:

1. **No duplicate tool calls.** Dedupe identical `tool_use` blocks within an iteration, and add a
   system-prompt line: "Never call the same tool twice with identical input in one turn."
2. **No over-promising.** Audit prompts/sub-workflow replies for commitments the system can't keep
   (the "front desk will call you back" lesson). Keep wording to what the system actually does.
3. **Confirm before acting** — already present for maintenance/extras; preserved.

Honest note: VAD, turn-detection, "going silent after a tool", and dual-tool-calls in
speech-to-speech are voice-runtime issues with no text-agent analogue and are intentionally not
addressed here.

## 8. Config / env / branding

`.env` (new project): `GUESTY_CLIENT_ID`, `GUESTY_CLIENT_SECRET`, `SUPABASE_URL`,
`SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `SMSAPI_TOKEN`,
`SMSAPI_SENDER_NAME`, `TRIGGER_SECRET_KEY`, `PUBLIC_LINK_SIGNING_SECRET`, `DASHBOARD_HOST`.
Dashboard `.env`: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`. Branding: dashboard title →
"Sonic AI · Phillip Island"; agent footer phone + business name → Phillip Island Co-Hosts.
New Trigger.dev project ref in `trigger.config.ts`; new `config.toml` `project_id`.

## 9. Credentials needed (at implementation)

- **Guesty Client ID** (the secret was provided; OAuth also needs the client/account ID).
- New Supabase **anon key**, **service_role key**, and **DB password** (for CLI migration).
- New **Trigger.dev project ref** (or create one).

## 10. Verification

1. Live OAuth token call returns 200 (validates §4.1).
2. `getReservation` / `getListing` return expected fields for a real id.
3. End-to-end: post a guest message in Guesty → `reservation.messageReceived` webhook →
   Trigger.dev run → KB answer (or maintenance/extras/escalation) → reply lands on the correct
   channel via `send-message`.
4. Dashboard loads against the new Supabase; KB/recipients/tickets CRUD works.
5. `urgency_categories` seeded; cooldown + escalation paths behave (silent escalation).
