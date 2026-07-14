// Normalize a phone number to strict E.164 (`+<countrycode><number>`), which
// Telnyx requires (error 40310 otherwise). SMSAPI tolerated bare digits like
// "917724958567" and separators; Telnyx does not. Numbers are stored in
// international format (country code included) but sometimes without the "+".
export function toE164(raw: string): string {
  const s = (raw ?? "").replace(/[\s()\-.]/g, "");
  if (!s) return s;
  if (s.startsWith("+")) return s;
  if (s.startsWith("00")) return "+" + s.slice(2);
  return "+" + s;
}

export async function sendSms(to: string, message: string) {
  const apiKey = process.env.TELNYX_API_KEY;
  const from = process.env.TELNYX_FROM_NUMBER || "+18333180776";
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
  return res.json();
}
