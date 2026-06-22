# Phillip Island Guest Agent (Guesty clone) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Work on a feature branch (or worktree) — the top-level repo is on `main`.

**Goal:** Clone the Sonic AI text-messaging guest agent into `philiphiland/`, replacing the Hospitable PMS with Guesty and pointing at a new Supabase project.

**Architecture:** Faithful copy of `sonic_ai_vedant_version/`. The PMS is isolated behind one module (`helpers/hospitable.ts`); we replace it with `helpers/guesty.ts` and adapt ~13 callers. A Supabase Edge Function ingests Guesty's `reservation.messageReceived` webhook, normalizes it, and triggers the existing Trigger.dev agent loop. The one structural change: Guesty messaging is keyed by `conversationId` (not `reservation_id`), so a `conversationId` + channel `module` are threaded through the agent run.

**Tech Stack:** TypeScript (Node 22), Trigger.dev v4, Anthropic SDK (`claude-sonnet-4-6`), Supabase (Postgres + Edge Functions/Deno), Vite/React dashboard, SMSAPI, Vitest (added for unit tests).

## Global Constraints

- Source repo to copy from: `/Users/vedantchellani/Desktop/sonicai/sonic_ai_vedant_version`. Target: `/Users/vedantchellani/Desktop/sonicai/philiphiland`.
- Trigger.dev SDK v4: use `@trigger.dev/sdk` `task({...})`. NEVER `client.defineJob`.
- AI model id: `claude-sonnet-4-6` (unchanged).
- Guesty base URL: `https://open-api.guesty.com/v1`. Token URL: `https://open-api.guesty.com/oauth2/token`.
- Guesty token: cache and reuse (max 5 tokens / 24h per key); never request per-call.
- DB column renames (apply everywhere): `hospitable_property_uuid` → `guesty_listing_id`; `hospitable_reservation_uuid` → `guesty_reservation_id`. The generic `reservation_uuid` text columns in `kb_gap_log`, `cooldowns`, `maintenance_tickets`, `extra_requests`, `agent_activity_log`, `checklist_instances` KEEP their name but store the Guesty reservation `_id`.
- Dashboard JSON field returned by `list-reservations` and consumed by `Reservations.tsx`: standardize on `guesty_reservation_id` (was inconsistently `hospitable_reservation_id`).
- Branding: dashboard `<title>` → "Sonic AI · Phillip Island"; agent business name → "Phillip Island Co-Hosts"; footer phone → placeholder `PHILLIP_ISLAND_PHONE` until provided.
- Do NOT copy `whole/`, `node_modules/`, `.trigger/`, `dashboard/dist/`, `.git/`, `.DS_Store` from the source.
- Each task ends with a commit. Run `npx tsc --noEmit` (backend) before commits where types changed.

---

## File Structure (what the clone contains after this plan)

```
philiphiland/
├── package.json                 # renamed; + vitest
├── tsconfig.json                # copied as-is
├── trigger.config.ts            # GUESTY_* env names, new project ref
├── .env.example                 # NEW (Guesty + new Supabase placeholders)
├── .gitignore                   # copied as-is
├── backend/
│   ├── trigger/
│   │   ├── helpers/
│   │   │   ├── guesty.ts         # NEW — replaces hospitable.ts
│   │   │   ├── guesty-webhook.ts # NEW — pure normalizer (shared by edge fn + tests)
│   │   │   ├── supabase.ts time.ts tokens.ts sms.ts   # copied as-is
│   │   ├── messaging/main-agent.ts          # adapted (conversationId/module, guesty)
│   │   ├── flows/{import-properties,import-reservations,sync-property-knowledge,reservation-webhook}.ts  # adapted
│   │   ├── property-sync.ts keep-alive.ts   # property-sync result field rename only
│   └── supabase/
│       ├── functions/guesty-webhook/index.ts            # renamed from hospitable-webhook
│       ├── functions/list-reservations/index.ts         # Guesty
│       ├── functions/{extras-respond,extras-resolve,checklist-resolve}/index.ts  # column rename + conv id
│       ├── functions/{checklist-mark-item,extras-resolve,manage-users,trigger-sync}/  # copied as-is
│       └── migrations/                                  # baseline+reservations adapted; +1 new
├── dashboard/                    # copied; column renames + branding + env
├── scripts/populate-kb.ts        # Guesty
└── tests/                        # NEW — vitest unit tests
    ├── guesty-token.test.ts
    ├── guesty-webhook.test.ts
    └── main-agent-helpers.test.ts
```

---

## Task 1: Scaffold the clone + test harness

**Files:**
- Create: all of `philiphiland/` by copying the source (minus excludes)
- Modify: `philiphiland/package.json`
- Create: `philiphiland/.env.example`, `philiphiland/vitest.config.ts`, `philiphiland/tests/smoke.test.ts`

**Interfaces:**
- Produces: a buildable project skeleton; `npm test` runs Vitest.

- [ ] **Step 1: Copy the source tree (excluding heavy/irrelevant dirs)**

```bash
cd /Users/vedantchellani/Desktop/sonicai
rsync -a --exclude 'whole/' --exclude 'node_modules/' --exclude '.trigger/' \
  --exclude 'dashboard/dist/' --exclude '.git/' --exclude '.DS_Store' \
  --exclude 'dashboard/node_modules/' \
  sonic_ai_vedant_version/ philiphiland/
ls philiphiland/backend/trigger/helpers
```
Expected: lists `hospitable.ts supabase.ts sms.ts time.ts tokens.ts` (the spec/plan docs already in philiphiland are preserved).

- [ ] **Step 2: Rename the package**

In `philiphiland/package.json`, change:
```json
  "name": "uncommon-accomodations",
```
to:
```json
  "name": "phillip-island-guest-agent",
```
and add Vitest to `devDependencies` (keep existing entries):
```json
    "vitest": "^2.1.0"
```
and add to `scripts`:
```json
    "test": "vitest run"
```

- [ ] **Step 3: Add Vitest config + a smoke test**

Create `philiphiland/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["tests/**/*.test.ts"], environment: "node" },
});
```

Create `philiphiland/tests/smoke.test.ts`:
```ts
import { describe, it, expect } from "vitest";

describe("smoke", () => {
  it("runs", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 4: Create `.env.example`**

Create `philiphiland/.env.example`:
```
# Guesty Open API (OAuth2 client credentials)
GUESTY_CLIENT_ID=
GUESTY_CLIENT_SECRET=
# Supabase (new project ictumlksmzjenevtaqvp)
SUPABASE_URL=https://ictumlksmzjenevtaqvp.supabase.co
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
# AI + messaging + jobs
ANTHROPIC_API_KEY=
SMSAPI_TOKEN=
SMSAPI_SENDER_NAME=
TRIGGER_SECRET_KEY=
PUBLIC_LINK_SIGNING_SECRET=
DASHBOARD_HOST=
```

- [ ] **Step 5: Install + run tests**

```bash
cd philiphiland && npm install && npm test
```
Expected: Vitest reports `smoke.test.ts` PASS (1 passed).

- [ ] **Step 6: Commit**

```bash
git add philiphiland
git commit -m "chore: scaffold phillip island clone from sonic_ai_vedant_version"
```

---

## Task 2: Guesty OAuth token cache

**Files:**
- Create: `philiphiland/backend/trigger/helpers/guesty.ts` (auth portion only)
- Test: `philiphiland/tests/guesty-token.test.ts`

**Interfaces:**
- Produces: `getAccessToken(now?: number, fetchImpl?): Promise<string>` and a resettable module cache for tests. Later tasks consume `authedFetch`.

- [ ] **Step 1: Write the failing test**

Create `philiphiland/tests/guesty-token.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import { __resetTokenCache, getAccessToken } from "../backend/trigger/helpers/guesty.ts";

function fakeTokenFetch(calls: { n: number }) {
  return async () =>
    ({
      ok: true,
      json: async () => ({ access_token: `tok-${++calls.n}`, expires_in: 86400 }),
      text: async () => "",
    }) as any;
}

describe("getAccessToken", () => {
  beforeEach(() => {
    process.env.GUESTY_CLIENT_ID = "id";
    process.env.GUESTY_CLIENT_SECRET = "secret";
    __resetTokenCache();
  });

  it("fetches once and caches within TTL", async () => {
    const calls = { n: 0 };
    const t1 = await getAccessToken(1_000_000, fakeTokenFetch(calls));
    const t2 = await getAccessToken(1_000_000 + 10_000, fakeTokenFetch(calls));
    expect(t1).toBe("tok-1");
    expect(t2).toBe("tok-1"); // cached
    expect(calls.n).toBe(1);
  });

  it("refetches after expiry (minus safety margin)", async () => {
    const calls = { n: 0 };
    await getAccessToken(1_000_000, fakeTokenFetch(calls));
    // 86400s TTL minus 60s margin → expires at +86340s
    const t = await getAccessToken(1_000_000 + 86_341_000, fakeTokenFetch(calls));
    expect(t).toBe("tok-2");
    expect(calls.n).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd philiphiland && npx vitest run tests/guesty-token.test.ts`
Expected: FAIL — cannot import `getAccessToken` (module/exports missing).

- [ ] **Step 3: Write minimal implementation**

Create `philiphiland/backend/trigger/helpers/guesty.ts`:
```ts
const TOKEN_URL = "https://open-api.guesty.com/oauth2/token";
export const GUESTY_BASE = "https://open-api.guesty.com/v1";
const SAFETY_MARGIN_MS = 60_000;

type FetchLike = (url: string, init?: any) => Promise<{ ok: boolean; json: () => Promise<any>; text: () => Promise<string> }>;

let cachedToken: { value: string; expiresAt: number } | null = null;

export function __resetTokenCache() {
  cachedToken = null;
}

export async function getAccessToken(
  now: number = Date.now(),
  fetchImpl: FetchLike = fetch as any
): Promise<string> {
  if (cachedToken && now < cachedToken.expiresAt) return cachedToken.value;

  const clientId = process.env.GUESTY_CLIENT_ID;
  const clientSecret = process.env.GUESTY_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Missing GUESTY_CLIENT_ID or GUESTY_CLIENT_SECRET");

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    scope: "open-api",
    client_id: clientId,
    client_secret: clientSecret,
  });

  const res = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`Guesty token request failed: ${await res.text()}`);
  const json = await res.json();
  const ttlMs = (Number(json.expires_in) || 86400) * 1000;
  cachedToken = { value: json.access_token, expiresAt: now + ttlMs - SAFETY_MARGIN_MS };
  return cachedToken.value;
}

export async function authedFetch(path: string, init: any = {}): Promise<Response> {
  const token = await getAccessToken();
  const res = await fetch(`${GUESTY_BASE}${path}`, {
    ...init,
    headers: {
      ...(init.headers || {}),
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) throw new Error(`Guesty ${init.method || "GET"} ${path} failed: ${res.status} ${await res.text()}`);
  return res;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd philiphiland && npx vitest run tests/guesty-token.test.ts`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add philiphiland/backend/trigger/helpers/guesty.ts philiphiland/tests/guesty-token.test.ts
git commit -m "feat: guesty oauth token cache"
```

---

## Task 2b: Validate the live token call (manual)

- [ ] **Step 1:** With real creds in `philiphiland/.env`, run:
```bash
cd philiphiland && node -e '
require("dotenv").config();
const b=new URLSearchParams({grant_type:"client_credentials",scope:"open-api",client_id:process.env.GUESTY_CLIENT_ID,client_secret:process.env.GUESTY_CLIENT_SECRET});
fetch("https://open-api.guesty.com/oauth2/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:b.toString()}).then(r=>r.json()).then(j=>console.log(Object.keys(j), "expires_in:", j.expires_in));
'
```
Expected: prints keys incl. `access_token` and `expires_in` (≈86400). If it 400s, fix field casing/scope here (this is the source-of-truth check from the spec) and update `getAccessToken` + its test accordingly, then re-run Task 2 Step 4.

---

## Task 3: Guesty API methods (reservations, listings, conversations, send)

**Files:**
- Modify: `philiphiland/backend/trigger/helpers/guesty.ts` (append)
- Delete: `philiphiland/backend/trigger/helpers/hospitable.ts` (after callers migrated — do the delete in Task 8 to avoid breaking intermediate typechecks; here only ADD guesty methods)

**Interfaces:**
- Produces:
  - `getReservation(id: string): Promise<GuestyReservation>`
  - `getConversationThread(conversationId: string): Promise<GuestyMessage[]>`
  - `sendMessage(conversationId: string, body: string, module: string): Promise<any>`
  - `listListings(): Promise<GuestyListing[]>`
  - `getListingDetails(listingId: string): Promise<GuestyListing | null>`
  - `findConversationIdForReservation(reservationId: string): Promise<string | null>`
  - Types `GuestyReservation`, `GuestyListing`, `GuestyMessage`.

- [ ] **Step 1: Append implementation to `guesty.ts`**

```ts
// ─── Types ──────────────────────────────────────────────────────────
export interface GuestyListing {
  _id: string;
  nickname?: string;
  title?: string;
  address?: { full?: string; city?: string; country?: string };
  timezone?: string;
  amenities?: string[];
  publicDescription?: Record<string, any>;
}

export interface GuestyReservation {
  _id: string;
  guestId?: string;
  listingId?: string;
  checkIn?: string;
  checkOut?: string;
  status?: string;
  source?: string;
  guest?: { fullName?: string; firstName?: string; lastName?: string; email?: string; phone?: string };
}

export interface GuestyMessage {
  type?: string;   // "fromGuest" | "fromHost" | ...
  body?: string;
  module?: string; // channel
  createdAt?: string;
}

// ─── Reservations ───────────────────────────────────────────────────
export async function getReservation(id: string): Promise<GuestyReservation> {
  const res = await authedFetch(`/reservations/${id}?fields=_id guestId listingId checkIn checkOut status source guest`);
  return res.json();
}

// ─── Listings (properties) ──────────────────────────────────────────
export async function listListings(): Promise<GuestyListing[]> {
  const out: GuestyListing[] = [];
  let skip = 0;
  const limit = 100;
  for (;;) {
    const res = await authedFetch(`/listings?limit=${limit}&skip=${skip}`);
    const json = await res.json();
    const batch: GuestyListing[] = json?.results ?? json?.data ?? [];
    out.push(...batch);
    const total = json?.count ?? out.length;
    skip += limit;
    if (batch.length < limit || out.length >= total) break;
  }
  return out;
}

export async function getListingDetails(listingId: string): Promise<GuestyListing | null> {
  try {
    const res = await authedFetch(`/listings/${listingId}`);
    return res.json();
  } catch {
    return null;
  }
}

// ─── Conversations / messaging ──────────────────────────────────────
export async function getConversationThread(conversationId: string): Promise<GuestyMessage[]> {
  const res = await authedFetch(`/communication/conversations/${conversationId}`);
  const json = await res.json();
  const thread = json?.thread ?? json?.messages ?? json?.posts ?? [];
  return thread as GuestyMessage[];
}

export async function sendMessage(conversationId: string, body: string, module: string): Promise<any> {
  const res = await authedFetch(`/communication/conversations/${conversationId}/send-message`, {
    method: "POST",
    body: JSON.stringify({ body, module: module || "email" }),
  });
  return res.json();
}

export async function findConversationIdForReservation(reservationId: string): Promise<string | null> {
  // Fallback for host-decision re-fires when conversationId is missing.
  try {
    const res = await authedFetch(`/communication/conversations?reservationId=${reservationId}&limit=1`);
    const json = await res.json();
    const first = (json?.results ?? json?.data ?? [])[0];
    return first?._id ?? null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `cd philiphiland && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i guesty || echo "guesty.ts clean"`
Expected: `guesty.ts clean` (other files still reference hospitable until later tasks — that's fine; only confirm guesty.ts itself has no type errors).

- [ ] **Step 3: Commit**

```bash
git add philiphiland/backend/trigger/helpers/guesty.ts
git commit -m "feat: guesty api methods (reservations, listings, conversations, send)"
```

- [ ] **Step 4: Live verification (manual, after creds wired)**

```bash
cd philiphiland && npx tsx -e '
import { listListings, getReservation } from "./backend/trigger/helpers/guesty.ts";
const ls = await listListings(); console.log("listings:", ls.length, ls[0]?._id, ls[0]?.nickname || ls[0]?.title);
'
```
Expected: prints a listing count and a sample `_id` + name. Note the real field names returned; if `nickname`/`title`/`timezone` differ, adjust `GuestyListing` + mappers in Task 8.

---

## Task 4: Guesty webhook normalizer (pure)

**Files:**
- Create: `philiphiland/backend/trigger/helpers/guesty-webhook.ts`
- Test: `philiphiland/tests/guesty-webhook.test.ts`

**Interfaces:**
- Produces:
  - `interface NormalizedMessage { reservationId: string; conversationId: string; body: string; module: string; guestName: string; platform: string }`
  - `normalizeMessageWebhook(payload: any): NormalizedMessage | null` — returns null for non-guest messages or wrong event.

- [ ] **Step 1: Write the failing test**

Create `philiphiland/tests/guesty-webhook.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { normalizeMessageWebhook } from "../backend/trigger/helpers/guesty-webhook.ts";

const guestEvent = {
  event: "reservation.messageReceived",
  reservationId: "res_1",
  conversation: {
    _id: "conv_1",
    conversationWith: "Guest",
    integration: { platform: "airbnb2" },
    meta: { guestName: "Liam" },
  },
  message: { type: "fromGuest", body: "what's the wifi?", module: "airbnb2", createdAt: "2026-06-22" },
};

describe("normalizeMessageWebhook", () => {
  it("normalizes a guest message", () => {
    expect(normalizeMessageWebhook(guestEvent)).toEqual({
      reservationId: "res_1",
      conversationId: "conv_1",
      body: "what's the wifi?",
      module: "airbnb2",
      guestName: "Liam",
      platform: "airbnb2",
    });
  });

  it("drops host messages", () => {
    const host = { ...guestEvent, message: { ...guestEvent.message, type: "fromHost" } };
    expect(normalizeMessageWebhook(host)).toBeNull();
  });

  it("drops the wrong event", () => {
    expect(normalizeMessageWebhook({ ...guestEvent, event: "reservation.updated" })).toBeNull();
  });

  it("accepts fromThirdParty as guest", () => {
    const tp = { ...guestEvent, message: { ...guestEvent.message, type: "fromThirdParty" } };
    expect(normalizeMessageWebhook(tp)?.conversationId).toBe("conv_1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd philiphiland && npx vitest run tests/guesty-webhook.test.ts`
Expected: FAIL — `normalizeMessageWebhook` not found.

- [ ] **Step 3: Write minimal implementation**

Create `philiphiland/backend/trigger/helpers/guesty-webhook.ts`:
```ts
export interface NormalizedMessage {
  reservationId: string;
  conversationId: string;
  body: string;
  module: string;
  guestName: string;
  platform: string;
}

const GUEST_TYPES = new Set(["fromGuest", "fromThirdParty"]);

export function normalizeMessageWebhook(payload: any): NormalizedMessage | null {
  if (payload?.event !== "reservation.messageReceived") return null;
  const conv = payload?.conversation ?? {};
  const msg = payload?.message ?? {};
  if (!GUEST_TYPES.has(msg?.type)) return null;
  if (conv?.conversationWith && conv.conversationWith !== "Guest") return null;

  const reservationId = payload?.reservationId ?? msg?.reservationId ?? "";
  const conversationId = conv?._id ?? "";
  if (!reservationId || !conversationId || !msg?.body) return null;

  return {
    reservationId,
    conversationId,
    body: msg.body,
    module: msg.module ?? conv?.integration?.platform ?? "email",
    guestName: conv?.meta?.guestName ?? "Guest",
    platform: conv?.integration?.platform ?? msg.module ?? "",
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd philiphiland && npx vitest run tests/guesty-webhook.test.ts`
Expected: PASS (4 passed).

- [ ] **Step 5: Commit**

```bash
git add philiphiland/backend/trigger/helpers/guesty-webhook.ts philiphiland/tests/guesty-webhook.test.ts
git commit -m "feat: guesty message webhook normalizer"
```

---

## Task 5: `guesty-webhook` Edge Function (ingress)

**Files:**
- Create: `philiphiland/backend/supabase/functions/guesty-webhook/index.ts`
- Delete: `philiphiland/backend/supabase/functions/hospitable-webhook/` (the whole dir)

**Interfaces:**
- Consumes: trigger task id `main-agent-workflow`, `TRIGGER_SECRET_KEY`, `ALLOWED_RESERVATION_UUIDS` env.
- Produces: an HTTP endpoint that triggers `main-agent-workflow` with `{ event, data: NormalizedMessage, received_at }`.

> Note: Deno edge functions can't import the Node normalizer directly; we inline an identical normalizer here (small, and the logic is unit-tested in Task 4). Keep the two in sync.

- [ ] **Step 1: Create the function**

Create `philiphiland/backend/supabase/functions/guesty-webhook/index.ts`:
```ts
// Receives Guesty `reservation.messageReceived` webhooks and forwards normalized
// guest messages to the Trigger.dev main agent.
//
// SAFETY FILTER: ALLOWED_RESERVATION_UUIDS (comma-separated Guesty reservation ids).
//   - unset/empty  → ALL guest messages dropped (safe default, no AI replies).
//   - "*"          → all pass (production).
//   - list         → only listed reservation ids forwarded.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

const GUEST_TYPES = new Set(["fromGuest", "fromThirdParty"]);
function normalize(payload: any) {
  if (payload?.event !== "reservation.messageReceived") return null;
  const conv = payload?.conversation ?? {};
  const msg = payload?.message ?? {};
  if (!GUEST_TYPES.has(msg?.type)) return null;
  if (conv?.conversationWith && conv.conversationWith !== "Guest") return null;
  const reservationId = payload?.reservationId ?? msg?.reservationId ?? "";
  const conversationId = conv?._id ?? "";
  if (!reservationId || !conversationId || !msg?.body) return null;
  return {
    reservationId, conversationId, body: msg.body,
    module: msg.module ?? conv?.integration?.platform ?? "email",
    guestName: conv?.meta?.guestName ?? "Guest",
    platform: conv?.integration?.platform ?? msg.module ?? "",
  };
}

function parseAllowlist(): { allowAll: boolean; ids: Set<string> } {
  const raw = (Deno.env.get("ALLOWED_RESERVATION_UUIDS") ?? "").trim();
  if (raw === "*") return { allowAll: true, ids: new Set() };
  if (!raw) return { allowAll: false, ids: new Set() };
  return { allowAll: false, ids: new Set(raw.split(",").map((s) => s.trim()).filter(Boolean)) };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ status: "method_not_allowed" }, 405);

  const triggerSecret = Deno.env.get("TRIGGER_SECRET_KEY");
  if (!triggerSecret) return json({ status: "error", detail: "Missing TRIGGER_SECRET_KEY" }, 500);

  let body: any;
  try { body = await req.json(); } catch { return json({ status: "error", detail: "invalid_json" }, 400); }

  const normalized = normalize(body);
  if (!normalized) return json({ status: "ignored", reason: "not_a_guest_message" }, 200);

  const { allowAll, ids } = parseAllowlist();
  if (!allowAll && (ids.size === 0 || !ids.has(normalized.reservationId))) {
    return json({ status: "filtered", reservation_id: normalized.reservationId }, 200);
  }

  const payload = { payload: { event: "message.created", data: normalized, received_at: new Date().toISOString() } };
  try {
    const resp = await fetch("https://api.trigger.dev/api/v1/tasks/main-agent-workflow/trigger", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${triggerSecret}` },
      body: JSON.stringify(payload),
    });
    const result = await resp.json();
    if (!resp.ok) return json({ status: "error", detail: result }, 502);
    return json({ status: "ok", trigger_run_id: result.id });
  } catch (e) {
    return json({ status: "error", detail: String(e) }, 502);
  }
});
```

- [ ] **Step 2: Remove the old function**

```bash
rm -rf philiphiland/backend/supabase/functions/hospitable-webhook
```

- [ ] **Step 3: Commit**

```bash
git add philiphiland/backend/supabase/functions
git commit -m "feat: guesty-webhook edge function (replaces hospitable-webhook)"
```

---

## Task 6: Main agent — conversationId/module threading + Guesty + guardrails

**Files:**
- Modify: `philiphiland/backend/trigger/messaging/main-agent.ts`
- Test: `philiphiland/tests/main-agent-helpers.test.ts`

**Interfaces:**
- Consumes: `guesty.ts` (`getReservation`, `getConversationThread`, `sendMessage`, `findConversationIdForReservation`), normalized webhook payload from Task 5.
- Produces: exported pure helpers `extractInbound(payload)` and `dedupeToolUses(blocks)` for unit testing; `AgentContext` gains `conversationId` and `channelModule`.

- [ ] **Step 1: Write the failing test (pure helpers)**

Create `philiphiland/tests/main-agent-helpers.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { extractInbound, dedupeToolUses } from "../backend/trigger/messaging/main-agent.ts";

describe("extractInbound", () => {
  it("reads the normalized guesty payload", () => {
    const p = { data: { reservationId: "r1", conversationId: "c1", body: "hi", module: "airbnb2", guestName: "Liam" } };
    expect(extractInbound(p)).toMatchObject({ reservationId: "r1", conversationId: "c1", body: "hi", module: "airbnb2", guestName: "Liam" });
  });
  it("reads a host-decision synthetic payload", () => {
    const p = { data: { reservation_id: "r1", conversation_id: "c1", module: "email", body: "[host-decision] approved", sender: { first_name: "host" } } };
    const e = extractInbound(p);
    expect(e.reservationId).toBe("r1");
    expect(e.conversationId).toBe("c1");
    expect(e.body).toContain("[host-decision]");
  });
});

describe("dedupeToolUses", () => {
  it("removes duplicate tool calls with identical input", () => {
    const blocks = [
      { type: "tool_use", id: "a", name: "use_knowledge_base", input: { query: "wifi" } },
      { type: "tool_use", id: "b", name: "use_knowledge_base", input: { query: "wifi" } },
      { type: "tool_use", id: "c", name: "use_knowledge_base", input: { query: "parking" } },
    ];
    expect(dedupeToolUses(blocks as any).length).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd philiphiland && npx vitest run tests/main-agent-helpers.test.ts`
Expected: FAIL — `extractInbound` / `dedupeToolUses` not exported.

- [ ] **Step 3: Edit imports + add pure helpers at top of `main-agent.ts`**

Replace the import block (lines 1-7):
```ts
import { task, logger } from "@trigger.dev/sdk";
import Anthropic from "@anthropic-ai/sdk";
import { getSupabaseClient } from "../helpers/supabase.js";
import { getReservation, getConversationThread, sendMessage, findConversationIdForReservation } from "../helpers/guesty.js";
import { getLocalHour } from "../helpers/time.js";
import { sendSms } from "../helpers/sms.js";
import { signApprovalToken } from "../helpers/tokens.js";
```

Replace the `WebhookPayload` interface (lines 11-31) with the normalized shape + add exported helpers:
```ts
interface InboundPayload {
  event: string;
  data: {
    // normalized guesty-webhook shape
    reservationId?: string;
    conversationId?: string;
    body?: string;
    module?: string;
    guestName?: string;
    platform?: string;
    // host-decision synthetic shape (from extras-respond)
    reservation_id?: string;
    conversation_id?: string;
    sender?: { first_name?: string };
  };
  received_at: string;
}

export function extractInbound(payload: { data: any }) {
  const d = payload?.data ?? {};
  return {
    reservationId: d.reservationId ?? d.reservation_id ?? "",
    conversationId: d.conversationId ?? d.conversation_id ?? "",
    body: d.body ?? "",
    module: d.module ?? "email",
    guestName: d.guestName ?? d.sender?.first_name ?? "Guest",
  };
}

export function dedupeToolUses<T extends { name: string; input: unknown }>(blocks: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const b of blocks) {
    const key = `${b.name}:${JSON.stringify(b.input)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(b);
  }
  return out;
}
```

Update `AgentContext` (was lines 33-41) to add fields:
```ts
interface AgentContext {
  propertyId: string;
  propertyName: string;
  reservationUuid: string;   // Guesty reservation _id
  conversationId: string;    // Guesty conversation _id (for replies)
  channelModule: string;     // reply channel, e.g. airbnb2 | email
  conversationHistory: { role: string; content: string }[];
  latestMessage: string;
  guestName: string;
  timezone: string;
}
```

- [ ] **Step 4: Run the pure-helper tests**

Run: `cd philiphiland && npx vitest run tests/main-agent-helpers.test.ts`
Expected: PASS (3 passed).

- [ ] **Step 5: Rewrite Phase 1 setup (the `run` body, lines ~561-679)**

Replace from `// Step 1: Extract webhook data` through the end of the `agentCtx` object with:
```ts
    // Step 1: Extract inbound (normalized guest message OR host-decision)
    const { reservationId, conversationId: inboundConvId, body: messageBody, module: channelModule, guestName } = extractInbound(payload);

    logger.info("Inbound received", { reservationId, hasBody: !!messageBody, channelModule });

    if (!reservationId) {
      logger.error("No reservationId in payload");
      return { status: "error", reason: "no_reservation_id" };
    }
    if (!messageBody) {
      logger.error("No message body in payload");
      return { status: "error", reason: "no_message_body" };
    }

    // Resolve conversationId (fallback for host-decision re-fires that lack it)
    let conversationId = inboundConvId;
    if (!conversationId) {
      conversationId = (await findConversationIdForReservation(reservationId)) ?? "";
    }

    // Step 2: Resolve the Guesty listing for this reservation
    let listingId: string | undefined;
    try {
      const reservation = await getReservation(reservationId);
      listingId = reservation.listingId;
    } catch (e) {
      logger.error("Failed to fetch reservation from Guesty", { error: String(e) });
    }
    if (!listingId) {
      logger.error("Could not resolve Guesty listingId", { reservationId });
      return { status: "error", reason: "no_listing_id" };
    }

    // Step 3: Map to our Supabase property
    const supabase = getSupabaseClient();
    const { data: property, error: propError } = await supabase
      .from("properties")
      .select("*")
      .eq("guesty_listing_id", listingId)
      .single();
    if (propError || !property) {
      logger.error("Property not found in Supabase", { listingId, error: propError?.message });
      return { status: "error", reason: "property_not_synced" };
    }

    // Step 4: Cooldown check (unchanged)
    const { data: activeCooldowns } = await supabase
      .from("cooldowns")
      .select("*")
      .eq("property_id", property.id)
      .eq("is_active", true)
      .gt("expires_at", new Date().toISOString())
      .limit(1);
    if (activeCooldowns && activeCooldowns.length > 0) {
      logger.info("Property is in cooldown — ignoring message", { propertyId: property.id });
      return { status: "skipped", reason: "cooldown_active" };
    }

    // Step 5: Load conversation history from Guesty
    let conversationHistory: { role: string; content: string }[] = [];
    if (conversationId) {
      try {
        const thread = await getConversationThread(conversationId);
        conversationHistory = thread.map((m) => ({
          role: m.type === "fromGuest" || m.type === "fromThirdParty" ? "guest" : "host",
          content: m.body || "",
        }));
      } catch (e) {
        logger.warn("Failed to fetch conversation thread — using latest message only", { error: String(e) });
      }
    }
    if (conversationHistory.length === 0) {
      conversationHistory = [{ role: "guest", content: messageBody }];
    }

    const agentCtx: AgentContext = {
      propertyId: property.id,
      propertyName: property.name,
      reservationUuid: reservationId,
      conversationId,
      channelModule,
      conversationHistory,
      latestMessage: messageBody,
      guestName,
      timezone: property.timezone || "Australia/Melbourne",
    };
```

> Removes the `ALLOWED_RESERVATION_UUIDS` allowlist block (lines 585-594) — allowlisting now lives in the edge function. Removes the host-message filter (lines 575-578) — the edge function already drops host messages; host-decision synthetic events are handled by the existing `[host-decision]` prompt branch.

- [ ] **Step 6: Update the reply send (lines ~938-945)**

Replace the Hospitable send:
```ts
    // Send the reply via Guesty on the same channel the guest used
    try {
      await sendMessage(conversationId, finalReply, channelModule);
      logger.info("Reply sent to guest", { conversationId, replyLength: replyText.length });
    } catch (e) {
      logger.error("Failed to send reply via Guesty", { error: String(e) });
      return { status: "error", reason: "guesty_send_failed" };
    }
```

- [ ] **Step 7: Wire the guardrails into the agent loop**

In the loop (after `const toolUseBlocks = ...filter(b => b.type === "tool_use")`, ~line 793), dedupe:
```ts
      const dedupedToolUses = dedupeToolUses(toolUseBlocks);
```
and iterate `dedupedToolUses` instead of `toolUseBlocks` in the `for (const toolUseBlock of ...)` loop (~line 803).

Add to `systemPrompt` after the `# Output` section:
```
# Tool discipline
Never call the same tool twice with identical input in one turn. Call each tool at most
once unless new information from a previous tool result requires a different input.
```

Update branding in `systemPrompt`: replace `Uncommon Accommodations` (line 701) with `Phillip Island Co-Hosts`. Update the footer (line 935):
```ts
    const footer = "\n\n—\nThis message was automatically sent by my AI agent. In case of emergency, please call " + (process.env.PHILLIP_ISLAND_PHONE || "our support line") + ".";
```

- [ ] **Step 8: subWorkflowC — persist conversationId for host re-fires**

In `subWorkflowC`, the pending-approval insert (lines ~401-411) add `guesty_conversation_id: ctx.conversationId` and `guesty_channel_module: ctx.channelModule`:
```ts
    .insert({
      property_id: ctx.propertyId,
      reservation_uuid: ctx.reservationUuid,
      item_requested: itemRequested,
      status: "approved",
      approval_status: "pending",
      guesty_conversation_id: ctx.conversationId,
      guesty_channel_module: ctx.channelModule,
    })
```

- [ ] **Step 9: Update the task type + typecheck**

Change `run: async (payload: WebhookPayload)` → `run: async (payload: InboundPayload)`.
Run: `cd philiphiland && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "main-agent|guesty" || echo "clean"`
Expected: `clean` (hospitable-dependent flow files may still error — fixed in Task 8).

- [ ] **Step 10: Commit**

```bash
git add philiphiland/backend/trigger/messaging/main-agent.ts philiphiland/tests/main-agent-helpers.test.ts
git commit -m "feat: main agent on guesty (conversationId/module threading + guardrails)"
```

---

## Task 7: Database — adapt migrations + new project setup

**Files:**
- Modify: `philiphiland/backend/supabase/migrations/20260529000000_baseline.sql:26`
- Modify: `philiphiland/backend/supabase/migrations/20260529000200_reservations.sql:3`
- Create: `philiphiland/backend/supabase/migrations/20260622000000_guesty_extra_request_conversation.sql`
- Modify: `philiphiland/backend/supabase/config.toml` (project_id)

**Interfaces:**
- Produces: a schema on the new Supabase project with `guesty_listing_id`, `guesty_reservation_id`, and `extra_requests.guesty_conversation_id` / `guesty_channel_module`.

- [ ] **Step 1: Rename the properties column**

In `20260529000000_baseline.sql` line 26 change:
```sql
  hospitable_property_uuid text not null unique,
```
to:
```sql
  guesty_listing_id text not null unique,
```

- [ ] **Step 2: Rename the reservations column**

In `20260529000200_reservations.sql` line 3 change:
```sql
  hospitable_reservation_uuid text not null unique,
```
to:
```sql
  guesty_reservation_id text not null unique,
```

- [ ] **Step 3: New migration for extra_requests conversation fields**

Create `20260622000000_guesty_extra_request_conversation.sql`:
```sql
-- Persist the Guesty conversation + channel on extra_requests so the host-approval
-- re-fire (extras-respond) can reply to the guest on the right conversation/channel.
alter table public.extra_requests
  add column if not exists guesty_conversation_id text,
  add column if not exists guesty_channel_module text;
```

- [ ] **Step 4: Point config at the new project**

In `philiphiland/backend/supabase/config.toml` set `project_id = "ictumlksmzjenevtaqvp"` (and any `[api]`/`[db]` left as defaults).

- [ ] **Step 5: Link + push to the new Supabase project**

```bash
cd philiphiland/backend/supabase
npx supabase link --project-ref ictumlksmzjenevtaqvp   # prompts for DB password
npx supabase db push
```
Expected: all migrations apply; `properties.guesty_listing_id`, `reservations.guesty_reservation_id`, and the new `extra_requests` columns exist. Verify:
```bash
npx supabase db remote query "select column_name from information_schema.columns where table_name='properties';"
```
Expected output includes `guesty_listing_id` (and NOT `hospitable_property_uuid`).

- [ ] **Step 6: Commit**

```bash
git add philiphiland/backend/supabase/migrations philiphiland/backend/supabase/config.toml
git commit -m "feat: guesty db schema (column renames + extra_requests conversation fields)"
```

---

## Task 8: Trigger flows + delete hospitable.ts

**Files:**
- Modify: `import-properties.ts`, `import-reservations.ts`, `sync-property-knowledge.ts`, `reservation-webhook.ts`, `property-sync.ts`
- Delete: `backend/trigger/helpers/hospitable.ts`

**Interfaces:**
- Consumes: `guesty.ts` (`listListings`, `getListingDetails`).

- [ ] **Step 1: Rewrite `import-properties.ts`**

Replace import (line 3):
```ts
import { listListings, type GuestyListing } from "../helpers/guesty.js";
```
Rename interface field (line 7) `hospitable_property_uuid` → `guesty_listing_id` (and in `ImportedPropertyRow` usages lines 59, 71). In the loop:
- line 30: `const all = await listListings();`
- line 36: `const name = hp.nickname || hp.title || \`Property ${hp._id}\`;`
- line 37: `const timezone = hp.timezone || "Australia/Melbourne";`
- line 42: `.eq("guesty_listing_id", hp._id)`
- line 63: `.insert({ name, guesty_listing_id: hp._id, timezone, is_active: true })`
- lines 59,71: `guesty_listing_id: hp._id`
- line 87: `export type ImportedListing = GuestyListing;`
Rename result field `hospitable_properties_found` → `guesty_listings_found` (interface line 13 + return line 78).

- [ ] **Step 2: Rewrite `import-reservations.ts` to use Guesty**

Replace the Hospitable interface + headers + base (lines 4-22) with:
```ts
import { authedFetch } from "../helpers/guesty.js";

interface GuestyResv {
  _id: string;
  status?: string;
  checkIn?: string;
  checkOut?: string;
  source?: string;
  listingId?: string;
  guest?: { firstName?: string; lastName?: string; fullName?: string; email?: string; phone?: string };
}
```
Replace property load (lines 31-43):
```ts
    const { data: props } = await supabase
      .from("properties")
      .select("id, guesty_listing_id")
      .eq("is_active", true);
    if (!props || props.length === 0) {
      return { status: "ok", message: "No properties synced. Run property-sync first.", added: 0, updated: 0 };
    }
    const propertyByListing: Record<string, string> = Object.fromEntries(
      props.map((p) => [p.guesty_listing_id, p.id]),
    );
```
Replace pagination (lines 45-63) with Guesty list (limit/skip, filter by listingId set client-side or via `listingId` param per property). Simplest robust approach — page all reservations and filter to known listings:
```ts
    const all: GuestyResv[] = [];
    let skip = 0;
    const limit = 100;
    for (;;) {
      const resp = await authedFetch(`/reservations?limit=${limit}&skip=${skip}&fields=_id status checkIn checkOut source listingId guest`);
      const parsed = await resp.json();
      const data: GuestyResv[] = parsed?.results ?? parsed?.data ?? [];
      all.push(...data);
      const total = parsed?.count ?? all.length;
      skip += limit;
      if (data.length < limit || all.length >= total) break;
    }
```
Replace the row mapping (lines 72-99):
```ts
    for (const r of all) {
      const localPropertyId = r.listingId ? propertyByListing[r.listingId] : null;
      if (!localPropertyId) { skipped++; continue; }
      const guest = r.guest || {};
      const row = {
        property_id: localPropertyId,
        guesty_reservation_id: r._id,
        guest_name: guest.fullName || [guest.firstName, guest.lastName].filter(Boolean).join(" ") || null,
        guest_email: guest.email || null,
        guest_phone: guest.phone || null,
        platform: r.source || null,
        check_in: r.checkIn ? r.checkIn.slice(0, 10) : null,
        check_out: r.checkOut ? r.checkOut.slice(0, 10) : null,
        status: r.status || "confirmed",
        raw: r as unknown as object,
        updated_at: new Date().toISOString(),
      };
      const { data: existing } = await supabase.from("reservations").select("id").eq("guesty_reservation_id", r._id).maybeSingle();
      if (existing) {
        const { error } = await supabase.from("reservations").update(row).eq("id", existing.id);
        if (error) errors.push(`update ${r._id}: ${error.message}`); else updated++;
      } else {
        const { error } = await supabase.from("reservations").insert(row);
        if (error) errors.push(`insert ${r._id}: ${error.message}`); else added++;
      }
    }
```

- [ ] **Step 3: Rewrite `sync-property-knowledge.ts`**

Replace import (line 4): `import { getListingDetails } from "../helpers/guesty.js";`
Line 92: `const details = await getListingDetails(prop.guesty_listing_id);`
Inside the KB-generation prompt, map Guesty listing fields (`nickname`, `title`, `address.full`, `amenities`, `publicDescription`) instead of Hospitable's. (Read the current prompt body; swap field accessors `hp.public_name`→`details.nickname`, `hp.address?.display`→`details.address?.full`, etc.)

- [ ] **Step 4: Update `reservation-webhook.ts`**

This handles the Guesty `reservation.created`/updated event (subscribe separately). Replace column refs:
- line 41: `.eq("guesty_listing_id", listingId)`
- line 53: `guesty_reservation_id: reservationId`
- line 67: `onConflict: "guesty_reservation_id"`
Update payload extraction to Guesty fields: reservation `_id`, `listingId`, `guest.fullName/firstName/lastName/email/phone`, `source`, `checkIn`/`checkOut` (slice to date), `status`. (Read current extraction lines 16-64 and swap accessors.)

- [ ] **Step 5: `property-sync.ts`** — only the result field name changed in `import-properties`; update any reference to `hospitable_properties_found` → `guesty_listings_found` if present (Explore reported it's an orchestrator with no direct refs — confirm with grep below).

- [ ] **Step 6: Delete the old PMS module + typecheck**

```bash
rm philiphiland/backend/trigger/helpers/hospitable.ts
cd philiphiland && grep -rn "hospitable" backend/trigger || echo "no hospitable refs in trigger"
npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "backend/trigger" || echo "trigger typechecks clean"
```
Expected: `no hospitable refs in trigger` and `trigger typechecks clean`.

- [ ] **Step 7: Commit**

```bash
git add philiphiland/backend/trigger
git commit -m "feat: migrate trigger flows to guesty; remove hospitable helper"
```

---

## Task 9: Other Edge Functions (list-reservations, extras-respond, extras-resolve, checklist-resolve)

**Files:**
- Modify: `functions/list-reservations/index.ts`, `functions/extras-respond/index.ts`, `functions/extras-resolve/index.ts`, `functions/checklist-resolve/index.ts`

> Edge functions run on Deno and can't import the Node `guesty.ts`. `list-reservations` needs a self-contained Guesty token+fetch. Inline a minimal token helper there.

- [ ] **Step 1: Rewrite `list-reservations/index.ts` for Guesty**

Replace the Hospitable interface (lines 20-30) and env read (lines 38-39):
```ts
const GUESTY_CLIENT_ID = Deno.env.get("GUESTY_CLIENT_ID");
const GUESTY_CLIENT_SECRET = Deno.env.get("GUESTY_CLIENT_SECRET");

let _tok: { value: string; exp: number } | null = null;
async function guestyToken(): Promise<string> {
  const now = Date.now();
  if (_tok && now < _tok.exp) return _tok.value;
  const body = new URLSearchParams({ grant_type: "client_credentials", scope: "open-api", client_id: GUESTY_CLIENT_ID!, client_secret: GUESTY_CLIENT_SECRET! });
  const r = await fetch("https://open-api.guesty.com/oauth2/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: body.toString() });
  const j = await r.json();
  _tok = { value: j.access_token, exp: now + (Number(j.expires_in) || 86400) * 1000 - 60000 };
  return _tok.value;
}
```
Replace the guard (line 39) to check `GUESTY_CLIENT_ID && GUESTY_CLIENT_SECRET`.
Replace the property map (lines 68-89): select `guesty_listing_id` and build `propertyMap` keyed by `guesty_listing_id`.
Replace the Hospitable fetch loop (lines 91-125) with a Guesty paged fetch:
```ts
  const token = await guestyToken();
  const all: any[] = [];
  let skip = (page - 1) * perPage;
  const HARD_CAP = 200;
  try {
    while (all.length < HARD_CAP) {
      const resp = await fetch(`https://open-api.guesty.com/v1/reservations?limit=${perPage}&skip=${skip}&fields=_id status checkIn checkOut source listingId guest`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
      if (!resp.ok) return json({ status: "error", detail: "guesty_returned_error", upstream_status: resp.status, upstream_body: (await resp.text()).slice(0, 500) }, 502);
      const parsed = await resp.json();
      const data = parsed?.results ?? parsed?.data ?? [];
      all.push(...data);
      const total = parsed?.count ?? all.length;
      skip += perPage;
      if (data.length < perPage || all.length >= total) break;
    }
  } catch (e) { return json({ status: "error", detail: "fetch_failed", message: String(e) }, 502); }
```
Replace the checklist lookup keys (line 130) `r.id` → `r._id`. Replace the enrich mapping (lines 142-161):
```ts
  const enriched = all.map((r) => {
    const property = r.listingId ? propertyMap[r.listingId] : null;
    return {
      guesty_reservation_id: r._id,
      code: r.confirmationCode ?? null,
      guest_name: r.guest?.fullName || [r.guest?.firstName, r.guest?.lastName].filter(Boolean).join(" ") || null,
      guest_email: r.guest?.email ?? null,
      check_in: r.checkIn ? r.checkIn.slice(0, 10) : null,
      check_out: r.checkOut ? r.checkOut.slice(0, 10) : null,
      status: r.status ?? null,
      platform: r.source ?? null,
      property_id: property?.id ?? null,
      property_name: property?.name ?? null,
      checklist: checklistMap[r._id] ?? null,
    };
  });
```

- [ ] **Step 2: `extras-respond/index.ts` — pass conversation + channel through**

The synthetic trigger payload must carry the conversation so main-agent can reply. Change the select (line ~46) to also pull the new columns, and the trigger payload `data` (lines 57-72) to:
```ts
      data: {
        reservation_id: extra.reservation_uuid,
        conversation_id: (extra as any).guesty_conversation_id ?? null,
        module: (extra as any).guesty_channel_module ?? "email",
        sender_type: "system",
        body: syntheticBody,
        sender: { first_name: "host" },
      },
```
Remove the `property.id: hospitable_property_uuid` field (main-agent now resolves the property via the reservation). Update any `hospitable_property_uuid` select to drop it.

- [ ] **Step 3: `extras-resolve/index.ts` + `checklist-resolve/index.ts` — column rename**

Both query `reservations` for `guest_name` by reservation id. Change `.eq("hospitable_reservation_uuid", ...)` (extras-resolve line 44, checklist-resolve line 50) → `.eq("guesty_reservation_id", ...)`.

- [ ] **Step 4: Grep for leftovers**

```bash
cd philiphiland && grep -rn "hospitable" backend/supabase/functions || echo "no hospitable refs in functions"
```
Expected: `no hospitable refs in functions`.

- [ ] **Step 5: Commit**

```bash
git add philiphiland/backend/supabase/functions
git commit -m "feat: migrate edge functions to guesty (reservations + extras conversation passthrough)"
```

---

## Task 10: Dashboard — column renames, branding, env

**Files:**
- Modify: `dashboard/src/pages/Reservations.tsx`, `ReservationDetail.tsx`, `PropertiesKB.tsx`, `dashboard/index.html`, `dashboard/.env.example`

- [ ] **Step 1: Reservations.tsx**
- line 9: interface `hospitable_reservation_id: string;` → `guesty_reservation_id: string;`
- line 361: `navigate(\`/reservations/${r.guesty_reservation_id}\`)`
- line 256: label "Live from Hospitable" → "Live from Guesty"

- [ ] **Step 2: ReservationDetail.tsx**
- line 14: `hospitable_reservation_uuid: string;` → `guesty_reservation_id: string;`
- line 115: `.eq("guesty_reservation_id", reservationUuid)`
- line 125: `guesty_reservation_id: resRow.guesty_reservation_id,`
- line 201: `{context.guesty_reservation_id}`

- [ ] **Step 3: PropertiesKB.tsx**
- line 10: `hospitable_property_uuid: string;` → `guesty_listing_id: string;`
- line 339: `{selected.guesty_listing_id.slice(0, 8)}...`

- [ ] **Step 4: Branding + env**
- `dashboard/index.html` line 7: `<title>Sonic AI · Phillip Island</title>`
- `dashboard/.env.example`:
```
VITE_SUPABASE_URL=https://ictumlksmzjenevtaqvp.supabase.co
VITE_SUPABASE_ANON_KEY=your_anon_key_here
```

- [ ] **Step 5: Verify build**

```bash
cd philiphiland/dashboard && npm install && npm run build
```
Expected: Vite build succeeds (no TS errors about the renamed fields).

- [ ] **Step 6: Commit**

```bash
git add philiphiland/dashboard
git commit -m "feat: dashboard guesty column renames + phillip island branding"
```

---

## Task 11: scripts/populate-kb.ts + config + docs

**Files:**
- Modify: `scripts/populate-kb.ts`, `trigger.config.ts`, `README.md`, `CLAUDE.md`

- [ ] **Step 1: `scripts/populate-kb.ts`** — replace inline Hospitable API (line 7 base, line 8 token, lines 50-90 fetch+map) with `listListings()` from `../backend/trigger/helpers/guesty.ts` (import via tsx). Change the Supabase select (line 156) to `select("id, name, guesty_listing_id")` and the map key (line 159) `supaMap.get(hp._id)`. Map KB source fields from `GuestyListing`.

- [ ] **Step 2: `trigger.config.ts`** — in `RUNTIME_ENV_VARS` (lines 8-17) replace `"HOSPITABLE_API_TOKEN"` with `"GUESTY_CLIENT_ID"` and `"GUESTY_CLIENT_SECRET"`; add `"PHILLIP_ISLAND_PHONE"`. Set `project: "<new-trigger-project-ref>"` (line 20) — placeholder until provided; flag in commit.

- [ ] **Step 3: Docs** — update `README.md` ("# Phillip Island Guest Agent") and the `CLAUDE.md` Project Overview + Environment Variables block (Hospitable → Guesty, new tables/columns, footer/branding).

- [ ] **Step 4: Final grep + typecheck**

```bash
cd philiphiland && grep -rn "hospitable\|HOSPITABLE" backend scripts trigger.config.ts | grep -v node_modules || echo "no hospitable refs anywhere"
npx tsc --noEmit -p tsconfig.json && echo "typecheck clean"
npm test
```
Expected: `no hospitable refs anywhere`, `typecheck clean`, all Vitest suites pass.

- [ ] **Step 5: Commit**

```bash
git add philiphiland
git commit -m "feat: populate-kb on guesty + config/env/docs (NOTE: set trigger project ref)"
```

---

## Task 12: End-to-end verification (manual, with live creds)

- [ ] **Step 1:** Set all `philiphiland/.env` values (Guesty client id/secret, new Supabase keys, Anthropic, SMSAPI, Trigger secret, signing secret, dashboard host, phillip island phone).
- [ ] **Step 2:** Run property sync: `cd philiphiland && npx trigger dev` then trigger `property-sync` — confirm `properties` rows created with `guesty_listing_id`.
- [ ] **Step 3:** Deploy edge functions: `npx supabase functions deploy guesty-webhook list-reservations extras-respond extras-resolve checklist-resolve` (set their env: `TRIGGER_SECRET_KEY`, `GUESTY_CLIENT_ID/SECRET`, `ALLOWED_RESERVATION_UUIDS`).
- [ ] **Step 4:** Register the Guesty webhook (`POST /v1/webhooks`, event `reservation.messageReceived`) pointing at the deployed `guesty-webhook` URL. Add a test reservation id to `ALLOWED_RESERVATION_UUIDS`.
- [ ] **Step 5:** Send a guest message in Guesty for that reservation. Confirm: webhook → Trigger.dev run → KB answer → reply lands in the Guesty conversation on the same channel. Test maintenance, extras (incl. host SMS approval re-fire), and escalation (silent) paths.
- [ ] **Step 6:** Load the dashboard against the new Supabase; verify Reservations/Properties/Tickets render and the `guesty_reservation_id` deep-link works.

---

## Self-Review (completed against the spec)

- **§4 Guesty API** → Tasks 2, 2b, 3 (auth + methods, live validation). ✓
- **§4.5 webhook** → Tasks 4, 5 (normalizer + edge fn, `reservation.messageReceived`, guest filter). ✓
- **§3 conversationId threading** → Task 6 (AgentContext + send by conversationId). ✓
- **§5 file-by-file** → Tasks 6–11 cover main-agent, flows, edge functions, dashboard, scripts, config. ✓
- **§6 DB (rename + from scratch)** → Task 7 (renames + new migration + link/push). ✓
- **§7 guardrails (dedupe, no over-promise, confirm)** → Task 6 Step 7 (dedupe + prompt; confirm-before-acting preserved; footer/promise wording). ✓
- **§8 config/branding** → Tasks 10, 11. ✓
- **Placeholders:** the only deferred values are external credentials (Guesty Client ID, Supabase keys/DB password, Trigger project ref) — flagged in Tasks 7/11/12, consistent with spec §9. No code placeholders.
- **Type consistency:** `extractInbound`/`dedupeToolUses` exported in Task 6 and consumed there; `GuestyListing/Reservation/Message`, `getReservation/getConversationThread/sendMessage/listListings/getListingDetails` defined in Task 3 and consumed in Tasks 6, 8, 9, 11; `guesty_listing_id`/`guesty_reservation_id` consistent across Tasks 7–10.
