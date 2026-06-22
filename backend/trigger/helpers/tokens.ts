import crypto from "node:crypto";

function getSecret(): string {
  const s = process.env.PUBLIC_LINK_SIGNING_SECRET;
  if (!s) throw new Error("Missing PUBLIC_LINK_SIGNING_SECRET");
  return s;
}

function b64url(buf: Buffer | string): string {
  const b = typeof buf === "string" ? Buffer.from(buf) : buf;
  return b.toString("base64url");
}

function sign(payload: object): string {
  const json = JSON.stringify(payload);
  const sig = crypto.createHmac("sha256", getSecret()).update(json).digest();
  return `${b64url(json)}.${b64url(sig)}`;
}

export interface ApprovalTokenPayload {
  extra_request_id: string;
  exp?: number;
}

export async function signApprovalToken(payload: ApprovalTokenPayload): Promise<string> {
  return sign({
    kind: "extras",
    id: payload.extra_request_id,
    exp: payload.exp ?? Math.floor(Date.now() / 1000) + 15 * 60,
  });
}

export interface ChecklistTokenPayload {
  instance_id: string;
  exp?: number;
}

export async function signChecklistToken(payload: ChecklistTokenPayload): Promise<string> {
  return sign({
    kind: "checklist",
    id: payload.instance_id,
    exp: payload.exp ?? Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
  });
}
