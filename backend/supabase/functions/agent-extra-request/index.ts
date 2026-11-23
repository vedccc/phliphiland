// Voice agent: a simple extra request (e.g. towels). Gated by allowed_extras —
// if the item is on the active allowed list, record it as pending and notify the
// team (they approve/fulfil from the dashboard Extra Requests page). Extending
// the stay is handled separately by agent-extend-stay.

import { preflight, json } from "../_shared/cors.ts";
import { getServiceClient } from "../_shared/supabase.ts";
import { sendSms } from "../_shared/sms.ts";
import { signApprovalToken } from "../_shared/tokens.ts";
import { isExtraAllowed } from "../_shared/extras.ts";
import { onDuty, type WeeklySchedule } from "../_shared/schedule.ts";

function authorized(req: Request): boolean {
  const expected = Deno.env.get("API_SECRET");
  if (!expected) return true;
  return req.headers.get("Authorization") === `Bearer ${expected}`;
}

Deno.serve(async (req) => {
  const pf = preflight(req);
  if (pf) return pf;
  if (!authorized(req)) return json({ error: "unauthorized" }, 401);

  let body: {
    property_id?: string;
    reservation_id?: string;
    item?: string;
    guest_name?: string;
    guest_phone?: string;
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  if (!body.property_id || !body.item) {
    return json({ error: "missing_property_or_item" }, 400);
  }

  const supabase = getServiceClient();

  // Is this item allowed? Match loosely against the active allowed_extras list.
  const { data: allowed } = await supabase
    .from("allowed_extras")
    .select("item_name")
    .eq("is_active", true);
  // Splits bundled requests ("towels and bedding") and compares on significant
  // tokens, so a multi-item ask is no longer wrongly declined. See _shared/extras.ts.
  const isAllowed = isExtraAllowed(body.item, (allowed ?? []).map((a) => a.item_name || ""));

  if (!isAllowed) {
    return json({
      status: "not_allowed",
      message: "That's not something I'm able to arrange directly, but I can connect you with the team if you'd like.",
    });
  }

  const { data: reqRow, error } = await supabase
    .from("extra_requests")
    .insert({
      property_id: body.property_id,
      reservation_uuid: body.reservation_id ?? null,
      item_requested: body.item,
      status: "pending",
      approval_status: "pending",
    })
    .select("id")
    .single();
  if (error) return json({ error: "insert_failed", detail: error.message }, 500);

  // Send each active recipient an SMS with a one-tap approve/decline link (same
  // flow as the messaging agent's Sub-Workflow C). The host's decision is handled
  // by extras-respond; for a voice request it simply records the decision.
  const { data: prop } = await supabase
    .from("properties")
    .select("name")
    .eq("id", body.property_id)
    .maybeSingle();
  const { data: allRecipients } = await supabase
    .from("sms_recipients")
    .select("phone, schedule")
    .eq("is_active", true);
  // Recipients with a schedule only get texts inside their days and times.
  const recipients = onDuty((allRecipients ?? []) as { phone: string; schedule: WeeklySchedule | null }[]);

  const dashboardHost = Deno.env.get("DASHBOARD_HOST") ?? "https://phillip-island-host.onrender.com";
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  let notified = 0;
  for (const r of recipients ?? []) {
    try {
      const token = await signApprovalToken(reqRow.id);
      await supabase.from("extras_approval_tokens").insert({
        extra_request_id: reqRow.id,
        token,
        recipient_phone: r.phone,
        expires_at: expiresAt,
      });
      const url = `${dashboardHost}/r/${token}`;
      // Verbatim match to the messaging agent's Sub-Workflow C host SMS.
      await sendSms(
        r.phone,
        `${prop?.name ?? "A property"}: guest requested "${body.item}". Approve or decline: ${url}`,
      );
      notified++;
    } catch (_e) { /* best effort */ }
  }

  return json({
    status: "submitted",
    request_id: reqRow.id,
    notified,
    message: "I've sent that request to our team to confirm — they'll sort it out for you.",
  });
});
