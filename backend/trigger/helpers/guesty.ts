const TOKEN_URL = "https://open-api.guesty.com/oauth2/token";
export const GUESTY_BASE = "https://open-api.guesty.com/v1";
const SAFETY_MARGIN_MS = 60_000;
// Guesty caps client-credentials tokens at ~5 / 24h. One token is shared across
// ALL Trigger workers via Upstash Redis so restarts/scaling never blow the cap;
// the in-memory copy is the per-isolate fast path. Mirrors _shared/guesty.ts.
const TOKEN_CACHE_KEY = "guesty:open-api:token";

type FetchLike = (
  url: string,
  init?: any
) => Promise<{ ok: boolean; status?: number; json: () => Promise<any>; text: () => Promise<string> }>;

let cachedToken: { value: string; expiresAt: number } | null = null;

export function __resetTokenCache() {
  cachedToken = null;
}

// Thin Upstash Redis REST client. No-ops (returns null) when the env isn't set,
// so tests and local runs without Redis simply fall back to per-isolate minting.
async function redisCmd(cmd: unknown[]): Promise<{ result?: unknown } | null> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(cmd),
    });
    if (!res.ok) return null;
    return (await res.json()) as { result?: unknown };
  } catch {
    return null;
  }
}

export async function getAccessToken(
  now: number = Date.now(),
  fetchImpl: FetchLike = fetch as any
): Promise<string> {
  // 1. in-memory (per-isolate) fast path
  if (cachedToken && now < cachedToken.expiresAt) return cachedToken.value;

  // 2. shared Redis cache — the scheduled `guesty-token-refresh` task keeps a valid
  //    token here, so under normal operation NOBODY mints on the hot path.
  const cached = await redisCmd(["GET", TOKEN_CACHE_KEY]);
  if (cached?.result) {
    try {
      const parsed = JSON.parse(cached.result as string) as { value: string; expiresAt: number };
      if (parsed?.value && now < parsed.expiresAt) {
        cachedToken = parsed;
        return parsed.value;
      }
    } catch {
      // corrupt cache entry → fall through and mint
    }
  }

  // 3. last-resort mint (shouldn't happen once the scheduled refresher is running)
  return mintAndCache(now, fetchImpl);
}

// Mint a fresh Guesty token and write it to both the in-memory and shared Redis
// caches. Guesty caps client-credentials tokens at ~5 / 24h, so this runs as rarely
// as possible — ideally only from the scheduled refresher.
async function mintAndCache(now: number, fetchImpl: FetchLike): Promise<string> {
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
  if (!res.ok) throw new Error(`Guesty token request failed: ${res.status ?? "?"} ${await res.text()}`);
  const json = await res.json();
  const ttlMs = (Number(json.expires_in) || 86400) * 1000;
  cachedToken = { value: json.access_token, expiresAt: now + ttlMs - SAFETY_MARGIN_MS };
  // persist to the shared cache read by all resources (Trigger, Supabase edge, LiveKit)
  await redisCmd([
    "SET",
    TOKEN_CACHE_KEY,
    JSON.stringify(cachedToken),
    "EX",
    Math.max(60, Math.floor((ttlMs - SAFETY_MARGIN_MS) / 1000)),
  ]);
  return cachedToken.value;
}

// Force-mint a fresh token and store it in the shared cache, ignoring any existing
// cached value. Called by the scheduled `guesty-token-refresh` task so every
// consumer reads ONE shared token and no service mints on its own.
export async function refreshGuestyToken(
  now: number = Date.now(),
  fetchImpl: FetchLike = fetch as any
): Promise<{ expiresAt: number }> {
  __resetTokenCache();
  await mintAndCache(now, fetchImpl);
  return { expiresAt: cachedToken!.expiresAt };
}

function backoffMs(attempt: number): number {
  return Math.min(2000, 250 * 2 ** attempt); // 250, 500, 1000, 2000…
}

// Authenticated fetch with retry. Guesty (and the token endpoint) can 429/5xx or
// return a stale-token 401 — a single blip must not kill a whole guest reply.
// Retries transient failures with backoff, re-mints on 401, fails fast on 4xx.
export async function authedFetch(
  path: string,
  init: any = {},
  opts: { retries?: number; fetchImpl?: FetchLike; sleep?: (ms: number) => Promise<void> } = {}
): Promise<Response> {
  const retries = opts.retries ?? 3;
  const doFetch = (opts.fetchImpl ?? (fetch as any)) as FetchLike;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  let lastErr: unknown = new Error(`Guesty ${path}: no attempt made`);

  for (let attempt = 0; attempt <= retries; attempt++) {
    let res: { ok: boolean; status?: number; text: () => Promise<string> };
    try {
      const token = await getAccessToken();
      res = await doFetch(`${GUESTY_BASE}${path}`, {
        ...init,
        headers: {
          ...(init.headers || {}),
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
      });
    } catch (e) {
      // network error or token-mint failure (e.g. 429 cap) → transient, retry
      lastErr = e;
      if (attempt === retries) throw e;
      await sleep(backoffMs(attempt));
      continue;
    }

    const status = res.status ?? (res.ok ? 200 : 500);
    if (status === 401) __resetTokenCache(); // stale/revoked token → re-mint next attempt
    if (status === 401 || status === 429 || status >= 500) {
      lastErr = new Error(`Guesty ${init.method || "GET"} ${path} failed: ${status}`);
      if (attempt === retries) throw lastErr;
      await sleep(backoffMs(attempt));
      continue;
    }
    if (!res.ok) {
      // permanent 4xx (400/403/404) — retrying won't help
      throw new Error(`Guesty ${init.method || "GET"} ${path} failed: ${status} ${await res.text()}`);
    }
    return res as unknown as Response;
  }
  throw lastErr;
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
  // Guesty conversation POSTS identify the sender via `sentBy`, not `type`.
  sentBy?: string; // "guest" | "host"
  type?: string; // legacy — not present on /posts items
  body?: string; // HTML body
  plainTextBody?: string; // plain-text body (preferred for the model)
  module?: unknown; // channel metadata (object on /posts)
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
  // Messages live in the conversation's POSTS collection. The bare
  // GET /communication/conversations/{id} returns only conversation metadata
  // (no messages) — reading a top-level thread/messages/posts key off it always
  // yielded [], so the agent silently ran with no history. Posts come back
  // newest-first; callers order them (see postsToHistory).
  const res = await authedFetch(`/communication/conversations/${conversationId}/posts`);
  const json = await res.json();
  return (json?.data?.posts ?? []) as GuestyMessage[];
}

export async function sendMessage(conversationId: string, body: string, module: string): Promise<any> {
  // Reply on the same channel the guest messaged on (the inbound `module`).
  // Guesty requires `module` to be an OBJECT ({ type: <channel> }), NOT a bare string;
  // the string form fails with 400 VALIDATION_ERROR: "module" must be of type object.
  const res = await authedFetch(`/communication/conversations/${conversationId}/send-message`, {
    method: "POST",
    body: JSON.stringify({ body, module: { type: module || "email" } }),
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
