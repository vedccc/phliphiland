// Receives Guesty `reservation.messageReceived` webhooks and forwards normalized
// guest messages to the Trigger.dev main agent.
//
// SAFETY FILTER: test mode (Agent Config switch, table agent_settings).
//   - test_mode on  → only agent_settings.test_conversation_ids are forwarded.
//   - test_mode off → every guest message is forwarded.
//   - settings unreadable → fail closed to the built-in test conversations.
// ACTIVE HOURS: when schedule_enabled, messages outside the weekly schedule
//   (Melbourne time, _shared/schedule.ts) are dropped so the team handles them.
// Gated by conversationId (stable per guest) rather than reservationId, which Guesty
// stamps with the guest's latest booking and therefore changes over time.

import { isWithinSchedule, type WeeklySchedule } from "../_shared/schedule.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

const GUEST_TYPES = new Set(["fromGuest", "fromThirdParty"]);
// NOTE: kept in sync with backend/trigger/helpers/guesty-webhook.ts (unit-tested).
// Deno edge functions cannot import the Node module, hence the inline copy.
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
    reservationId,
    conversationId,
    body: msg.body,
    module: msg.module ?? conv?.integration?.platform ?? "email",
    guestName: conv?.meta?.guestName ?? "Guest",
    platform: conv?.integration?.platform ?? msg.module ?? "",
  };
}

// NOTE: kept in sync with shouldForward in backend/trigger/helpers/guesty-webhook.ts (unit-tested).
const TEST_CONVERSATION_IDS = ["6ab4e0843e05570011c490d7", "6a27b3f6ad3d6b00126f9b05"];

interface TestModeSettings {
  testMode: boolean;
  testConversationIds: string[];
  scheduleEnabled: boolean;
  schedule: WeeklySchedule | null;
}

async function readTestMode(): Promise<TestModeSettings | null> {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return null;
  try {
    const res = await fetch(`${url}/rest/v1/agent_settings?select=test_mode,test_conversation_ids,schedule_enabled,schedule&limit=1`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    if (!res.ok) return null;
    const row = (await res.json())?.[0];
    if (!row || typeof row.test_mode !== "boolean") return null;
    return {
      testMode: row.test_mode,
      testConversationIds: row.test_conversation_ids ?? [],
      scheduleEnabled: row.schedule_enabled === true,
      schedule: row.schedule ?? null,
    };
  } catch {
    return null;
  }
}

function shouldForward(conversationId: string, settings: TestModeSettings | null): boolean {
  const s = settings ?? { testMode: true, testConversationIds: TEST_CONVERSATION_IDS };
  if (!s.testMode) return true;
  return s.testConversationIds.includes(conversationId);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ status: "method_not_allowed" }, 405);

  const triggerSecret = Deno.env.get("TRIGGER_SECRET_KEY");
  if (!triggerSecret) return json({ status: "error", detail: "Missing TRIGGER_SECRET_KEY" }, 500);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ status: "error", detail: "invalid_json" }, 400);
  }

  const normalized = normalize(body);
  if (!normalized) return json({ status: "ignored", reason: "not_a_guest_message" }, 200);

  const settings = await readTestMode();
  if (!shouldForward(normalized.conversationId, settings)) {
    return json({ status: "filtered", conversation_id: normalized.conversationId, test_mode: settings?.testMode ?? true }, 200);
  }

  // Active hours: outside the weekly schedule (Melbourne time) the AI stays silent
  // and the team handles the message. Unreadable settings skip this gate — test
  // mode above has already failed closed.
  if (settings?.scheduleEnabled && !isWithinSchedule(settings.schedule as WeeklySchedule, new Date())) {
    return json({ status: "outside_active_hours", conversation_id: normalized.conversationId }, 200);
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
