import { json, preflight } from "../_shared/cors.ts";
import { getServiceClient } from "../_shared/supabase.ts";
import { verifyToken } from "../_shared/tokens.ts";

Deno.serve(async (req: Request) => {
  const pf = preflight(req);
  if (pf) return pf;
  if (req.method !== "POST") return json({ status: "method_not_allowed" }, 405);

  const { token, instance_id, jwt } = await req.json().catch(() => ({}));
  const supabase = getServiceClient();

  // Authorization: either a signed token (public cleaner/SMS link) or a JWT (in-portal).
  let instanceId: string | null = null;
  if (token) {
    const payload = await verifyToken(token);
    if (!payload || payload.kind !== "checklist") {
      return json({ status: "error", detail: "invalid_token" }, 401);
    }
    instanceId = payload.id;
  } else if (jwt && instance_id) {
    const { data: userData, error: userErr } = await supabase.auth.getUser(jwt);
    if (userErr || !userData?.user) return json({ status: "error", detail: "invalid_jwt" }, 401);
    // Any authenticated user with a profile may view the in-portal checklist.
    const { data: profile } = await supabase.from("profiles").select("role").eq("id", userData.user.id).single();
    if (!profile) return json({ status: "error", detail: "no_profile" }, 403);
    instanceId = instance_id;
  } else {
    return json({ status: "error", detail: "missing_auth" }, 401);
  }

  const { data: instance } = await supabase
    .from("checklist_instances")
    .select("id, property_id, reservation_uuid, status, completed_at, properties(name)")
    .eq("id", instanceId)
    .single();

  if (!instance) return json({ status: "error", detail: "not_found" }, 404);

  // Join the profile email so the UI can attribute who checked each item.
  const { data: items } = await supabase
    .from("checklist_instance_items")
    .select("id, body, sort_order, is_checked, checked_at, checked_by_user_id, profiles!checklist_instance_items_checked_by_user_id_fkey(email)")
    .eq("instance_id", instance.id)
    .order("sort_order");

  const { data: reservation } = await supabase
    .from("reservations")
    .select("check_in, check_out, guest_name")
    .eq("guesty_reservation_id", instance.reservation_uuid)
    .maybeSingle();

  const total = items?.length ?? 0;
  const done = items?.filter((i) => i.is_checked).length ?? 0;

  const enrichedItems = (items ?? []).map((i: any) => ({
    id: i.id,
    body: i.body,
    sort_order: i.sort_order,
    is_checked: i.is_checked,
    checked_at: i.checked_at,
    checked_by_email: i.profiles?.email ?? null,
  }));

  return json({
    status: "ok",
    instance_id: instance.id,
    reservation_uuid: instance.reservation_uuid,
    property_name: (instance as any).properties?.name ?? "Property",
    guest_name: reservation?.guest_name ?? null,
    check_in: reservation?.check_in ?? null,
    check_out: reservation?.check_out ?? null,
    overall_status: instance.status,
    completed_at: instance.completed_at,
    items: enrichedItems,
    progress: { done, total },
  });
});
