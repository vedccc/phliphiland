// Deno SMS helper for the voice-agent edge functions.
// Mirrors backend/trigger/helpers/sms.ts (Telnyx), plus a recipient lookup that
// matches the text agent's sms_recipients routing.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// Normalize to strict E.164 (`+<countrycode><number>`) — Telnyx requires it
// (error 40310 otherwise). SMSAPI tolerated bare digits ("917724958567") and
// separators; Telnyx does not. Kept in sync with backend/trigger/helpers/sms.ts.
export function toE164(raw: string): string {
  const s = (raw ?? "").replace(/[\s()\-.]/g, "");
  if (!s) return s;
  if (s.startsWith("+")) return s;
  if (s.startsWith("00")) return "+" + s.slice(2);
  return "+" + s;
}

export async function sendSms(to: string, message: string): Promise<void> {
  const apiKey = Deno.env.get("TELNYX_API_KEY");
  const from = Deno.env.get("TELNYX_FROM_NUMBER") || "+18333180776";
  if (!apiKey) throw new Error("Missing TELNYX_API_KEY");
  const res = await fetch("https://api.telnyx.com/v2/messages", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to: toE164(to), text: message }),
  });
  if (!res.ok) throw new Error(`Telnyx failed: ${res.status} ${await res.text()}`);
}

// Active recipients who have `flag` set (e.g. "receives_maintenance_high").
export async function getRecipients(
  supabase: SupabaseClient,
  flag: string,
): Promise<{ name: string; phone: string }[]> {
  const { data } = await supabase
    .from("sms_recipients")
    .select("name, phone")
    .eq("is_active", true)
    .eq(flag, true);
  return (data ?? []) as { name: string; phone: string }[];
}

// Best-effort fan-out — one guest/host should never fail a call because an SMS
// bounced, so we swallow per-recipient errors.
export async function smsAll(
  recipients: { phone: string }[],
  message: string,
): Promise<number> {
  let sent = 0;
  for (const r of recipients) {
    try {
      await sendSms(r.phone, message);
      sent++;
    } catch (_e) {
      // ignore individual failures
    }
  }
  return sent;
}
