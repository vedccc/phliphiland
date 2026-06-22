// Admin-only user management. Uses the Supabase Admin API to create users with an
// admin-generated password (no invite email is sent), delete users, and update
// roles / access. All writes go through the service role to bypass RLS.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Generate a readable, strong temporary password (no ambiguous chars).
function generatePassword(len = 14): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const arr = new Uint32Array(len);
  crypto.getRandomValues(arr);
  return Array.from(arr, (n) => chars[n % chars.length]).join("");
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ status: "method_not_allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const authHeader = req.headers.get("Authorization") || "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!jwt) return json({ status: "error", detail: "missing_jwt" }, 401);

  const serviceClient = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false },
  });

  // Auth: caller must be a super_admin
  const { data: userData, error: userErr } = await serviceClient.auth.getUser(jwt);
  if (userErr || !userData?.user) return json({ status: "error", detail: "invalid_jwt" }, 401);
  const callerId = userData.user.id;

  const { data: callerProfile, error: profileErr } = await serviceClient
    .from("profiles")
    .select("role")
    .eq("id", callerId)
    .single();
  if (profileErr || !callerProfile) return json({ status: "error", detail: "no_profile" }, 403);
  if (callerProfile.role !== "super_admin") return json({ status: "error", detail: "forbidden_role" }, 403);

  const body = await req.json().catch(() => ({} as any));
  const op = body?.op as string | undefined;

  // ─── List users (joined with auth.users last_sign_in_at) ───
  if (op === "list") {
    const { data: profiles, error: profErr } = await serviceClient
      .from("profiles")
      .select("id, email, role, can_view_kb, can_view_maintenance, can_view_reservations, created_at")
      .order("email");
    if (profErr) return json({ status: "error", detail: "list_failed", message: profErr.message }, 500);

    // Pull auth metadata (last_sign_in_at) via admin list
    const { data: authList, error: authErr } = await serviceClient.auth.admin.listUsers({ perPage: 200 });
    const lastSignInMap: Record<string, string | null> = {};
    if (!authErr) {
      for (const u of authList?.users ?? []) {
        lastSignInMap[u.id] = (u as any).last_sign_in_at ?? null;
      }
    }

    const enriched = (profiles ?? []).map((p) => ({
      ...p,
      last_sign_in_at: lastSignInMap[p.id] ?? null,
    }));

    return json({ status: "ok", users: enriched });
  }

  // ─── Create user (admin-generated password; NO invite email) ───
  if (op === "create") {
    const email = (body?.email as string | undefined)?.trim();
    const role = (body?.role as string | undefined) === "super_admin" ? "super_admin" : "member";
    const canViewKb = role === "super_admin" ? true : !!body?.can_view_kb;
    const canViewMaintenance = role === "super_admin" ? true : !!body?.can_view_maintenance;
    const canViewReservations = role === "super_admin" ? true : !!body?.can_view_reservations;
    if (!email) return json({ status: "error", detail: "missing_email" }, 400);

    // Admin-generated account: create the user with a confirmed email and a
    // strong random password (or an admin-supplied one), then return the
    // password so the admin can share the credentials directly. No email sent.
    const provided = (body?.password as string | undefined)?.trim();
    const password = provided && provided.length >= 6 ? provided : generatePassword();

    const { data: created, error: createErr } = await serviceClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (createErr || !created?.user) {
      return json({ status: "error", detail: "create_failed", message: createErr?.message ?? "unknown" }, 400);
    }

    const { error: profErr } = await serviceClient
      .from("profiles")
      .update({
        role,
        can_view_kb: canViewKb,
        can_view_maintenance: canViewMaintenance,
        can_view_reservations: canViewReservations,
      })
      .eq("id", created.user.id);
    if (profErr) {
      await serviceClient.auth.admin.deleteUser(created.user.id).catch(() => {});
      return json({ status: "error", detail: "profile_update_failed", message: profErr.message }, 500);
    }

    return json({
      status: "ok",
      password,
      user: {
        id: created.user.id,
        email: created.user.email,
        role,
        can_view_kb: canViewKb,
        can_view_maintenance: canViewMaintenance,
        can_view_reservations: canViewReservations,
      },
    });
  }

  // ─── Update role (also resets perms appropriately) ───
  if (op === "update_role") {
    const userId = body?.user_id as string | undefined;
    const role = (body?.role as string | undefined) === "super_admin" ? "super_admin" : "member";
    if (!userId) return json({ status: "error", detail: "missing_user_id" }, 400);

    if (userId === callerId && role !== "super_admin") {
      return json({ status: "error", detail: "cannot_demote_self" }, 400);
    }

    // When promoting to admin, grant all access. When demoting, leave existing toggles.
    const patch: Record<string, unknown> = { role };
    if (role === "super_admin") {
      patch.can_view_kb = true;
      patch.can_view_maintenance = true;
      patch.can_view_reservations = true;
    }

    const { error: updErr } = await serviceClient.from("profiles").update(patch).eq("id", userId);
    if (updErr) return json({ status: "error", detail: "update_failed", message: updErr.message }, 500);

    return json({ status: "ok" });
  }

  // ─── Update access flags (only meaningful for member role) ───
  if (op === "update_access") {
    const userId = body?.user_id as string | undefined;
    const canViewKb = !!body?.can_view_kb;
    const canViewMaintenance = !!body?.can_view_maintenance;
    const canViewReservations = !!body?.can_view_reservations;
    if (!userId) return json({ status: "error", detail: "missing_user_id" }, 400);

    const { error: updErr } = await serviceClient
      .from("profiles")
      .update({
        can_view_kb: canViewKb,
        can_view_maintenance: canViewMaintenance,
        can_view_reservations: canViewReservations,
      })
      .eq("id", userId);
    if (updErr) return json({ status: "error", detail: "update_failed", message: updErr.message }, 500);

    return json({ status: "ok" });
  }

  // ─── Delete user (auth + profile cascade) ───
  if (op === "delete") {
    const userId = body?.user_id as string | undefined;
    if (!userId) return json({ status: "error", detail: "missing_user_id" }, 400);
    if (userId === callerId) return json({ status: "error", detail: "cannot_delete_self" }, 400);

    const { error: delErr } = await serviceClient.auth.admin.deleteUser(userId);
    if (delErr) return json({ status: "error", detail: "delete_failed", message: delErr.message }, 500);

    return json({ status: "ok" });
  }

  // ─── Reset password ───
  if (op === "reset_password") {
    const userId = body?.user_id as string | undefined;
    const newPassword = body?.new_password as string | undefined;
    if (!userId || !newPassword) return json({ status: "error", detail: "missing_fields" }, 400);
    if (newPassword.length < 6) return json({ status: "error", detail: "password_too_short" }, 400);

    // email_confirm:true so an admin-set password works even for users who never
    // confirmed their email (e.g. an invite that was never completed) — otherwise
    // sign-in is blocked by the "Confirm email" requirement despite a valid password.
    const { error: updErr } = await serviceClient.auth.admin.updateUserById(userId, {
      password: newPassword,
      email_confirm: true,
    });
    if (updErr) return json({ status: "error", detail: "reset_failed", message: updErr.message }, 500);

    return json({ status: "ok" });
  }

  return json({ status: "error", detail: "unknown_op" }, 400);
});
