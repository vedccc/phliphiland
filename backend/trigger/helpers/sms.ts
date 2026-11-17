// Normalize a phone number to strict E.164 (`+<countrycode><number>`), which
// Twilio and Telnyx both require. SMSAPI tolerated bare digits like
// "917724958567" and separators; they do not. Numbers are stored in
// international format (country code included) but sometimes without the "+".
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

/**
 * Twilio's Messages API needs an Account SID (it is part of the URL) plus a
 * secret: either the account Auth Token, or an API Key SID + secret pair.
 * Returns null when the Account SID or its secret is missing.
 *
 * Note: an Organization-level Twilio OAuth app (client id `OQ…`, token context
 * `organization:OR…`) is for Twilio's organization admin APIs (users, roles,
 * usage) and isn't documented to call the Messages API, so it is not used here.
 */
export function twilioConfig(env: Env): TwilioConfig | null {
  const accountSid = env.TWILIO_ACCOUNT_SID;
  if (!accountSid) return null;
  const apiKey = env.TWILIO_API_KEY_SID && env.TWILIO_API_KEY_SECRET;
  const user = apiKey ? env.TWILIO_API_KEY_SID : accountSid;
  const pass = apiKey ? env.TWILIO_API_KEY_SECRET : env.TWILIO_AUTH_TOKEN;
  if (!user || !pass) return null;
  return { accountSid, user, pass, from: env.TWILIO_FROM_NUMBER || TWILIO_DEFAULT_FROM };
}

/** The exact HTTP request for one Twilio SMS (form-encoded, unlike Telnyx's JSON). */
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

// Twilio is the SMS provider once TWILIO_ACCOUNT_SID (+ a secret) is set. Telnyx
// stays as the fallback until then, so deploying this before the Twilio secrets
// exist keeps host alerts flowing. Delete the Telnyx branch once Twilio is
// confirmed live in both runtimes (here and supabase/functions/_shared/sms.ts).
export async function sendSms(to: string, message: string) {
  const twilio = twilioConfig(process.env);
  if (twilio) {
    const req = twilioRequest(twilio, to, message);
    const res = await fetch(req.url, { method: "POST", headers: req.headers, body: req.body });
    if (!res.ok) throw new Error(`Twilio failed: ${res.status} ${await res.text()}`);
    return res.json();
  }
  // A half-set Twilio config must not quietly fall through to Telnyx.
  if (process.env.TWILIO_ACCOUNT_SID) {
    throw new Error("Twilio is half-configured: TWILIO_ACCOUNT_SID needs TWILIO_AUTH_TOKEN or TWILIO_API_KEY_SID + TWILIO_API_KEY_SECRET");
  }

  const apiKey = process.env.TELNYX_API_KEY;
  const from = process.env.TELNYX_FROM_NUMBER || "+18333180776";
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
  return res.json();
}
