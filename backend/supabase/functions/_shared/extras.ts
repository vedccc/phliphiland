// Pure helpers for the extras approval → guest-confirmation flow.
//
// Deliberately free of Deno / network / URL imports so they can be unit-tested
// with vitest (see backend/tests/extras.test.ts) the same way trigger/helpers/sms.ts
// is. extras-respond imports these to weave the host's chosen delivery time into
// the message the agent sends the guest.

// Words that carry no meaning when matching a requested item against the
// allowed_extras whitelist ("Extra towels" must match a guest saying "towels").
const FILLER = new Set([
  "extra", "extras", "some", "a", "an", "the", "please", "more", "additional",
  "few", "couple", "of", "my", "our", "need", "want", "get", "any",
]);

function significantTokens(s: string): string[] {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !FILLER.has(w));
}

/**
 * Split a spoken request into the individual items it asks for.
 * "towels and bedding" -> ["towels", "bedding"]
 */
export function splitRequestedItems(raw: string): string[] {
  return (raw || "")
    .toLowerCase()
    .split(/\s*(?:,|\band\b|&|\+|\bplus\b)\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Is every item in the guest's request on the allowed_extras whitelist?
 *
 * The old check was a bidirectional substring test on the WHOLE phrase, so a
 * bundled request ("towels and bedding") matched neither "Extra towels" nor
 * "Extra bedding" and was wrongly declined. This splits the request first and
 * compares on significant tokens, so filler words and the "Extra " prefix don't
 * break the match.
 *
 * Requires EVERY requested part to be allowed — so a request that mixes an
 * allowed item with a disallowed one ("towels and a bottle of wine") is still
 * declined rather than silently approved.
 */
export function isExtraAllowed(requested: string, allowedNames: string[]): boolean {
  const allowed = allowedNames.map(significantTokens).filter((t) => t.length);
  if (!allowed.length) return false;
  const parts = splitRequestedItems(requested).map(significantTokens).filter((t) => t.length);
  if (!parts.length) return false;
  return parts.every((p) =>
    allowed.some((a) => a.every((t) => p.includes(t)) || p.every((t) => a.includes(t))),
  );
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/**
 * Format the host's picked wall-clock delivery time for the guest message.
 *
 * Input is the naive `datetime-local` string the host picked, e.g.
 * "2026-07-18T15:00". It is intentionally timezone-free — it IS the local wall
 * clock the host saw — so NO timezone conversion is done (that's what makes this
 * correct regardless of where the property or the host's browser is).
 *
 * Returns e.g. "Sat 18 Jul 2026, 3:00 PM", or `null` for anything unparseable so
 * callers fall back to the original time-less wording.
 */
export function formatDelivery(local: string | null | undefined): string | null {
  if (!local || typeof local !== "string") return null;
  const m = local.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const hh = Number(m[4]);
  const mi = Number(m[5]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || hh > 23 || mi > 59) return null;
  // Build in UTC purely to derive the weekday — no tz shift is introduced because
  // we read the day/month/hour straight from the parsed wall-clock fields above.
  const dt = new Date(Date.UTC(y, mo - 1, d, hh, mi));
  if (isNaN(dt.getTime())) return null;
  const day = DAYS[dt.getUTCDay()];
  const mon = MONTHS[mo - 1];
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  const ampm = hh < 12 ? "AM" : "PM";
  const mins = String(mi).padStart(2, "0");
  return `${day} ${d} ${mon} ${y}, ${h12}:${mins} ${ampm}`;
}

/**
 * Build the synthetic `[host-decision]` instruction the messaging agent re-fires
 * on. When an approved request has a parseable delivery time, it is woven in so
 * the guest is told the exact date and time; otherwise this returns the ORIGINAL
 * time-less wording verbatim, so the current flow is unchanged when no time is
 * present (old UI, declines, or an unparseable value).
 */
export function buildHostDecisionBody(
  decision: "approved" | "declined",
  item: string,
  deliveryLocal?: string | null,
): string {
  if (decision === "declined") {
    return `[host-decision] Host declined extra request: "${item}". Reply to the guest apologizing that this cannot be accommodated this time.`;
  }
  const when = formatDelivery(deliveryLocal);
  if (when) {
    return `[host-decision] Host approved extra request: "${item}", to be delivered on ${when}. Reply to the guest confirming we'll deliver their ${item} on ${when}.`;
  }
  return `[host-decision] Host approved extra request: "${item}". Reply to the guest that we will deliver this for them.`;
}
