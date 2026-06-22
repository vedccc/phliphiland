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
  try {
    body = await req.json();
  } catch {
    return json({ status: "error", detail: "invalid_json" }, 400);
  }

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
