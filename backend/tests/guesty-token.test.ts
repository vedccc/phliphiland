import { describe, it, expect, beforeEach } from "vitest";
import {
  __resetTokenCache,
  getAccessToken,
  authedFetch,
  refreshGuestyToken,
} from "../trigger/helpers/guesty.ts";

function fakeTokenFetch(calls: { n: number }) {
  return async () =>
    ({
      ok: true,
      json: async () => ({ access_token: `tok-${++calls.n}`, expires_in: 86400 }),
      text: async () => "",
    }) as any;
}

describe("getAccessToken", () => {
  beforeEach(() => {
    process.env.GUESTY_CLIENT_ID = "id";
    process.env.GUESTY_CLIENT_SECRET = "secret";
    __resetTokenCache();
  });

  it("fetches once and caches within TTL", async () => {
    const calls = { n: 0 };
    const t1 = await getAccessToken(1_000_000, fakeTokenFetch(calls));
    const t2 = await getAccessToken(1_000_000 + 10_000, fakeTokenFetch(calls));
    expect(t1).toBe("tok-1");
    expect(t2).toBe("tok-1"); // cached
    expect(calls.n).toBe(1);
  });

  it("refetches after expiry (minus safety margin)", async () => {
    const calls = { n: 0 };
    await getAccessToken(1_000_000, fakeTokenFetch(calls));
    // 86400s TTL minus 60s margin → expires at +86340s
    const t = await getAccessToken(1_000_000 + 86_341_000, fakeTokenFetch(calls));
    expect(t).toBe("tok-2");
    expect(calls.n).toBe(2);
  });

  it("refreshGuestyToken force-mints even when a valid token is cached", async () => {
    const calls = { n: 0 };
    await getAccessToken(1_000_000, fakeTokenFetch(calls)); // caches tok-1
    const { expiresAt } = await refreshGuestyToken(1_000_000, fakeTokenFetch(calls)); // forces tok-2
    expect(calls.n).toBe(2); // did NOT reuse the cached token
    expect(expiresAt).toBe(1_000_000 + 86_340_000); // TTL minus 60s margin
    // subsequent reads now serve the refreshed token
    expect(await getAccessToken(1_000_000 + 1000, fakeTokenFetch(calls))).toBe("tok-2");
    expect(calls.n).toBe(2);
  });
});

// A fetchImpl for the DATA endpoint that returns a scripted sequence of statuses.
function scriptedFetch(statuses: number[], calls: { n: number }) {
  return async () => {
    const status = statuses[Math.min(calls.n, statuses.length - 1)];
    calls.n++;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => ({ ok: true }),
      text: async () => `status ${status}`,
    } as any;
  };
}

describe("authedFetch retry", () => {
  const noSleep = async () => {};

  beforeEach(async () => {
    process.env.GUESTY_CLIENT_ID = "id";
    process.env.GUESTY_CLIENT_SECRET = "secret";
    __resetTokenCache();
    // Seed the in-memory token cache so authedFetch's getAccessToken() is a no-op
    // and the scripted fetchImpl only drives the data request.
    await getAccessToken(Date.now(), fakeTokenFetch({ n: 0 }));
  });

  it("retries a 5xx then succeeds", async () => {
    const calls = { n: 0 };
    const res = await authedFetch("/reservations/x", {}, {
      fetchImpl: scriptedFetch([503, 200], calls),
      sleep: noSleep,
    });
    expect(res.ok).toBe(true);
    expect(calls.n).toBe(2);
  });

  it("retries a 429 then succeeds", async () => {
    const calls = { n: 0 };
    const res = await authedFetch("/reservations/x", {}, {
      fetchImpl: scriptedFetch([429, 200], calls),
      sleep: noSleep,
    });
    expect(res.ok).toBe(true);
    expect(calls.n).toBe(2);
  });

  it("fails fast on a 404 (no retry)", async () => {
    const calls = { n: 0 };
    await expect(
      authedFetch("/reservations/missing", {}, { fetchImpl: scriptedFetch([404], calls), sleep: noSleep })
    ).rejects.toThrow(/failed: 404/);
    expect(calls.n).toBe(1);
  });

  it("gives up after exhausting retries on a persistent 5xx", async () => {
    const calls = { n: 0 };
    await expect(
      authedFetch("/x", {}, { retries: 2, fetchImpl: scriptedFetch([500], calls), sleep: noSleep })
    ).rejects.toThrow(/failed: 500/);
    expect(calls.n).toBe(3); // initial attempt + 2 retries
  });
});
