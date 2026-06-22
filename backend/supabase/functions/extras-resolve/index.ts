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

  let guestName: string | null = null;
  if (extra.reservation_uuid) {
    const { data: res } = await supabase
      .from("reservations")
      .select("guest_name")
      .eq("guesty_reservation_id", extra.reservation_uuid)
      .maybeSingle();
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
