// Deno-compatible HMAC-SHA256 token verify.
// Mirrors backend/trigger/helpers/tokens.ts (signing happens in Node, verify here in Deno).

const enc = new TextEncoder();

function getSecret(): string {
  const s = Deno.env.get("PUBLIC_LINK_SIGNING_SECRET");
  if (!s) throw new Error("Missing PUBLIC_LINK_SIGNING_SECRET");
  return s;
}

function b64urlDecode(s: string): Uint8Array {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const b64 = (s + pad).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function b64urlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(getSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return new Uint8Array(sigBuf);
}

export interface TokenPayload {
  kind: "extras" | "checklist";
  id: string;
  exp: number;
}

export async function verifyToken(token: string): Promise<TokenPayload | null> {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payloadB64, sigB64] = parts;

  const payloadBytes = b64urlDecode(payloadB64);
  const payloadStr = new TextDecoder().decode(payloadBytes);
  const expectedSig = await hmac(payloadStr);
  const expectedB64 = b64urlEncode(expectedSig);

  if (expectedB64.length !== sigB64.length) return null;
  let diff = 0;
  for (let i = 0; i < expectedB64.length; i++) {
    diff |= expectedB64.charCodeAt(i) ^ sigB64.charCodeAt(i);
  }
  if (diff !== 0) return null;

  let payload: TokenPayload;
  try {
    payload = JSON.parse(payloadStr);
  } catch {
    return null;
  }
  if (!payload.kind || !payload.id || !payload.exp) return null;
  if (payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}
