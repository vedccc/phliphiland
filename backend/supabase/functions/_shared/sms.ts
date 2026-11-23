// Deno SMS helper for the voice-agent edge functions.
// Mirrors backend/trigger/helpers/sms.ts (Twilio, with Telnyx as fallback), plus a
// recipient lookup that matches the text agent's sms_recipients routing.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { onDuty, type WeeklySchedule } from "./schedule.ts";

// Normalize to strict E.164 (`+<countrycode><number>`) — Twilio and Telnyx both
// require it. SMSAPI tolerated bare digits ("917724958567") and separators; they
// do not. Kept in sync with backend/trigger/helpers/sms.ts.
export function toE164(raw: string): string {
  const s = (raw ?? "").replace(/[\s()\-.]/g, "");
  if (!s) return s;
  if (s.startsWith("+")) return s;
  if (s.startsWith("00")) return "+" + s.slice(2);
  return "+" + s;
}

type Env = Record<string, string | undefined>;

const TWILIO_DEFAULT_FROM = "+61485026523";

export interface TwilioConfig {
  accountSid: string;
  /** Basic-auth username: the Account SID, or an API Key SID (`SK…`). */
  user: string;
  /** Basic-auth password: the Auth Token, or that API key's secret. */
  pass: string;
  from: string;
}

// Kept in sync with backend/trigger/helpers/sms.ts (which has the unit tests).
export function twilioConfig(env: Env): TwilioConfig | null {
  const accountSid = env.TWILIO_ACCOUNT_SID;
  if (!accountSid) return null;
  const apiKey = env.TWILIO_API_KEY_SID && env.TWILIO_API_KEY_SECRET;
  const user = apiKey ? env.TWILIO_API_KEY_SID : accountSid;
  const pass = apiKey ? env.TWILIO_API_KEY_SECRET : env.TWILIO_AUTH_TOKEN;
  if (!user || !pass) return null;
  return { accountSid, user, pass, from: env.TWILIO_FROM_NUMBER || TWILIO_DEFAULT_FROM };
}

export function twilioRequest(cfg: TwilioConfig, to: string, message: string) {
  return {
    url: `https://api.twilio.com/2010-04-01/Accounts/${cfg.accountSid}/Messages.json`,
    headers: {
      Authorization: `Basic ${btoa(`${cfg.user}:${cfg.pass}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ To: toE164(to), From: cfg.from, Body: message }).toString(),
  };
}

// Twilio is the provider once TWILIO_ACCOUNT_SID (+ a secret) is set as a Supabase
// secret; Telnyx stays as the fallback until then so a deploy can't silence alerts.
export async function sendSms(to: string, message: string): Promise<void> {
  const env = Deno.env.toObject();
  const twilio = twilioConfig(env);
  if (twilio) {
    const req = twilioRequest(twilio, to, message);
    const res = await fetch(req.url, { method: "POST", headers: req.headers, body: req.body });
    if (!res.ok) throw new Error(`Twilio failed: ${res.status} ${await res.text()}`);
    return;
  }
  // A half-set Twilio config must not quietly fall through to Telnyx.
  if (env.TWILIO_ACCOUNT_SID) {
    throw new Error("Twilio is half-configured: TWILIO_ACCOUNT_SID needs TWILIO_AUTH_TOKEN or TWILIO_API_KEY_SID + TWILIO_API_KEY_SECRET");
  }

  const apiKey = env.TELNYX_API_KEY;
  const from = env.TELNYX_FROM_NUMBER || "+18333180776";
  if (!apiKey) throw new Error("Missing SMS credentials: set TWILIO_* (preferred) or TELNYX_API_KEY");
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
// Recipients with a schedule are included only inside their days and times (onDuty).
export async function getRecipients(
  supabase: SupabaseClient,
  flag: string,
): Promise<{ name: string; phone: string }[]> {
  const { data } = await supabase
    .from("sms_recipients")
    .select("name, phone, schedule")
    .eq("is_active", true)
    .eq(flag, true);
  return onDuty((data ?? []) as { name: string; phone: string; schedule: WeeklySchedule | null }[]);
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
