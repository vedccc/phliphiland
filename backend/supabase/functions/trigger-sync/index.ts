// Authenticated proxy for triggering and polling Trigger.dev tasks.
// Verifies the caller is a super_admin before forwarding.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

// Allowlist of tasks the dashboard can trigger. Prevents the edge fn from being abused
// to fire arbitrary tasks even after auth.
const ALLOWED_TASKS = new Set([
  "property-sync-workflow",
]);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ status: "method_not_allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const triggerSecret = Deno.env.get("TRIGGER_SECRET_KEY");
  if (!triggerSecret) return json({ status: "error", detail: "Missing TRIGGER_SECRET_KEY" }, 500);

  // Verify the caller's JWT and look up their profile.role
  const authHeader = req.headers.get("Authorization") || "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!jwt) return json({ status: "error", detail: "missing_jwt" }, 401);

  const serviceClient = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false },
  });

  const { data: userData, error: userErr } = await serviceClient.auth.getUser(jwt);
  if (userErr || !userData?.user) {
    return json({ status: "error", detail: "invalid_jwt" }, 401);
  }
  const userId = userData.user.id;

  const { data: profile, error: profileErr } = await serviceClient
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .single();
  if (profileErr || !profile) {
    return json({ status: "error", detail: "no_profile" }, 403);
  }
  if (profile.role !== "super_admin") {
    return json({ status: "error", detail: "forbidden_role" }, 403);
  }

  const body = await req.json().catch(() => ({} as any));
  const op = body?.op as string | undefined;

  async function fetchTrigger(url: string, init?: RequestInit) {
    let resp: Response;
    try {
      resp = await fetch(url, init);
    } catch (e) {
      return { resp: null as Response | null, body: null, text: String(e) };
    }
    const text = await resp.text();
    let body: unknown = null;
    try {
      body = JSON.parse(text);
    } catch {
      // text is not JSON (likely HTML error page) — keep as raw text
    }
    return { resp, body, text };
  }

  if (op === "trigger") {
    const taskId = body?.task_id as string | undefined;
    if (!taskId || !ALLOWED_TASKS.has(taskId)) {
      return json({ status: "error", detail: "task_not_allowed" }, 400);
    }

    const triggerUrl = `https://api.trigger.dev/api/v1/tasks/${taskId}/trigger`;
    const { resp, body: parsed, text } = await fetchTrigger(triggerUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${triggerSecret}`,
      },
      body: JSON.stringify({ payload: body?.payload ?? {} }),
    });
    if (!resp) {
      return json({ status: "error", detail: "trigger_fetch_failed", message: text }, 502);
    }
    if (!resp.ok) {
      return json({
        status: "error",
        detail: "trigger_returned_error",
        upstream_status: resp.status,
        upstream_body: parsed ?? text.slice(0, 500),
      }, 502);
    }
    const result = parsed as { id?: string } | null;
    return json({ status: "ok", run_id: result?.id ?? null });
  }

  if (op === "status") {
    const runId = body?.run_id as string | undefined;
    if (!runId) return json({ status: "error", detail: "missing_run_id" }, 400);

    const statusUrl = `https://api.trigger.dev/api/v3/runs/${runId}`;
    const { resp, body: parsed, text } = await fetchTrigger(statusUrl, {
      headers: { Authorization: `Bearer ${triggerSecret}` },
    });
    if (!resp) {
      return json({ status: "error", detail: "status_fetch_failed", message: text }, 502);
    }
    if (!resp.ok) {
      return json({
        status: "error",
        detail: "status_returned_error",
        upstream_status: resp.status,
        upstream_body: parsed ?? text.slice(0, 500),
      }, 502);
    }
    const result = parsed as { status?: string; output?: unknown } | null;
    return json({
      status: "ok",
      run_status: result?.status ?? "UNKNOWN",
      output: result?.output ?? null,
    });
  }

  return json({ status: "error", detail: "unknown_op" }, 400);
});
