const TOKEN_URL = "https://open-api.guesty.com/oauth2/token";
export const GUESTY_BASE = "https://open-api.guesty.com/v1";
const SAFETY_MARGIN_MS = 60_000;

type FetchLike = (
  url: string,
  init?: any
) => Promise<{ ok: boolean; json: () => Promise<any>; text: () => Promise<string> }>;

let cachedToken: { value: string; expiresAt: number } | null = null;

export function __resetTokenCache() {
  cachedToken = null;
}

export async function getAccessToken(
  now: number = Date.now(),
  fetchImpl: FetchLike = fetch as any
): Promise<string> {
  if (cachedToken && now < cachedToken.expiresAt) return cachedToken.value;

  const clientId = process.env.GUESTY_CLIENT_ID;
  const clientSecret = process.env.GUESTY_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Missing GUESTY_CLIENT_ID or GUESTY_CLIENT_SECRET");

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    scope: "open-api",
    client_id: clientId,
    client_secret: clientSecret,
  });

  const res = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`Guesty token request failed: ${await res.text()}`);
  const json = await res.json();
  const ttlMs = (Number(json.expires_in) || 86400) * 1000;
  cachedToken = { value: json.access_token, expiresAt: now + ttlMs - SAFETY_MARGIN_MS };
  return cachedToken.value;
}

export async function authedFetch(path: string, init: any = {}): Promise<Response> {
  const token = await getAccessToken();
  const res = await fetch(`${GUESTY_BASE}${path}`, {
    ...init,
    headers: {
      ...(init.headers || {}),
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) throw new Error(`Guesty ${init.method || "GET"} ${path} failed: ${res.status} ${await res.text()}`);
  return res;
}

// ─── Types ──────────────────────────────────────────────────────────
export interface GuestyListing {
  _id: string;
  nickname?: string;
  title?: string;
  address?: { full?: string; city?: string; country?: string };
  timezone?: string;
  amenities?: string[];
  publicDescription?: Record<string, any>;
}

export interface GuestyReservation {
  _id: string;
  guestId?: string;
  listingId?: string;
  checkIn?: string;
  checkOut?: string;
  status?: string;
  source?: string;
  guest?: { fullName?: string; firstName?: string; lastName?: string; email?: string; phone?: string };
}

export interface GuestyMessage {
  type?: string; // "fromGuest" | "fromHost" | ...
  body?: string;
  module?: string; // channel
  createdAt?: string;
}

// ─── Reservations ───────────────────────────────────────────────────
export async function getReservation(id: string): Promise<GuestyReservation> {
  const res = await authedFetch(
    `/reservations/${id}?fields=_id guestId listingId checkIn checkOut status source guest`
  );
  return res.json();
}

// ─── Listings (properties) ──────────────────────────────────────────
export async function listListings(): Promise<GuestyListing[]> {
  const out: GuestyListing[] = [];
  let skip = 0;
  const limit = 100;
  for (;;) {
    const res = await authedFetch(`/listings?limit=${limit}&skip=${skip}`);
    const json = await res.json();
    const batch: GuestyListing[] = json?.results ?? json?.data ?? [];
    out.push(...batch);
    const total = json?.count ?? out.length;
    skip += limit;
    if (batch.length < limit || out.length >= total) break;
  }
  return out;
}

export async function getListingDetails(listingId: string): Promise<GuestyListing | null> {
  try {
    const res = await authedFetch(`/listings/${listingId}`);
    return res.json();
  } catch {
    return null;
  }
}

// ─── Conversations / messaging ──────────────────────────────────────
export async function getConversationThread(conversationId: string): Promise<GuestyMessage[]> {
  const res = await authedFetch(`/communication/conversations/${conversationId}`);
  const json = await res.json();
  const thread = json?.thread ?? json?.messages ?? json?.posts ?? [];
  return thread as GuestyMessage[];
}

export async function sendMessage(conversationId: string, body: string, module: string): Promise<any> {
  const res = await authedFetch(`/communication/conversations/${conversationId}/send-message`, {
    method: "POST",
    body: JSON.stringify({ body, module: module || "email" }),
  });
  return res.json();
}

export async function findConversationIdForReservation(reservationId: string): Promise<string | null> {
  // Fallback for host-decision re-fires when conversationId is missing.
  try {
    const res = await authedFetch(`/communication/conversations?reservationId=${reservationId}&limit=1`);
    const json = await res.json();
    const first = (json?.results ?? json?.data ?? [])[0];
    return first?._id ?? null;
  } catch {
    return null;
  }
}
