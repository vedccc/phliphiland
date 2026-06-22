import { json, preflight } from "../_shared/cors.ts";
import { getServiceClient } from "../_shared/supabase.ts";
import { verifyToken } from "../_shared/tokens.ts";

Deno.serve(async (req: Request) => {
  const pf = preflight(req);
  if (pf) return pf;
  if (req.method !== "POST") return json({ status: "method_not_allowed" }, 405);

  const { token, item_id, is_checked, jwt } = await req.json().catch(() => ({}));
  if (!item_id) return json({ status: "error", detail: "missing_fields" }, 400);

  const supabase = getServiceClient();

  // Resolve the checklist instance: either via signed token (cleaner/SMS link) or via JWT (in-portal).
  let instanceId: string | null = null;
  let checkedByUserId: string | null = null;

  if (token) {
    const payload = await verifyToken(token);
    if (!payload || payload.kind !== "checklist") {
      return json({ status: "error", detail: "invalid_token" }, 401);
    }
    instanceId = payload.id;
  }

  if (jwt) {
    const { data: userData, error: userErr } = await supabase.auth.getUser(jwt);
    if (!userErr && userData?.user) {
      checkedByUserId = userData.user.id;
    }
  }

  if (!instanceId && checkedByUserId) {
    // In-portal flow: no token. Resolve the instance via the item itself.
    const { data: lookup } = await supabase
      .from("checklist_instance_items")
      .select("instance_id")
      .eq("id", item_id)
      .single();
    if (!lookup) return json({ status: "error", detail: "item_not_found" }, 404);
    instanceId = lookup.instance_id;
  }

  if (!instanceId) return json({ status: "error", detail: "missing_token_or_jwt" }, 401);

  // Verify the item belongs to this instance.
  const { data: item } = await supabase
    .from("checklist_instance_items")
    .select("instance_id")
    .eq("id", item_id)
    .single();
  if (!item || item.instance_id !== instanceId) {
    return json({ status: "error", detail: "forbidden" }, 403);
  }

  const now = new Date().toISOString();
  await supabase
    .from("checklist_instance_items")
    .update({
      is_checked: !!is_checked,
      checked_at: is_checked ? now : null,
      checked_by_user_id: is_checked ? checkedByUserId : null,
    })
    .eq("id", item_id);

  const { data: items } = await supabase
    .from("checklist_instance_items")
    .select("is_checked")
    .eq("instance_id", instanceId);
  const total = items?.length ?? 0;
  const done = items?.filter((i) => i.is_checked).length ?? 0;
  const newStatus = done === 0 ? "pending" : done === total ? "completed" : "in_progress";

  await supabase
    .from("checklist_instances")
    .update({
      status: newStatus,
      completed_at: newStatus === "completed" ? now : null,
    })
    .eq("id", instanceId);

  return json({ status: "ok", progress: { done, total }, overall_status: newStatus });
});
