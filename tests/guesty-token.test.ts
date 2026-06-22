import { describe, it, expect, beforeEach } from "vitest";
import { __resetTokenCache, getAccessToken } from "../backend/trigger/helpers/guesty.ts";

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
});
