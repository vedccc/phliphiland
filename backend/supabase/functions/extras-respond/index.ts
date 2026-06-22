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

  const { data: extra } = await supabase
    .from("extra_requests")
    .select("reservation_uuid, item_requested, guesty_conversation_id, guesty_channel_module")
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
          reservation_id: extra.reservation_uuid,
          conversation_id: (extra as any).guesty_conversation_id ?? null,
          module: (extra as any).guesty_channel_module ?? "email",
          body: syntheticBody,
          sender: { first_name: "host" },
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
