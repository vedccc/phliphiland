export interface NormalizedMessage {
  reservationId: string;
  conversationId: string;
  body: string;
  module: string;
  guestName: string;
  platform: string;
}

const GUEST_TYPES = new Set(["fromGuest", "fromThirdParty"]);

export function normalizeMessageWebhook(payload: any): NormalizedMessage | null {
  if (payload?.event !== "reservation.messageReceived") return null;
  const conv = payload?.conversation ?? {};
  const msg = payload?.message ?? {};
  if (!GUEST_TYPES.has(msg?.type)) return null;
  if (conv?.conversationWith && conv.conversationWith !== "Guest") return null;

  const reservationId = payload?.reservationId ?? msg?.reservationId ?? "";
  const conversationId = conv?._id ?? "";
  if (!reservationId || !conversationId || !msg?.body) return null;

  return {
    reservationId,
    conversationId,
    body: msg.body,
    module: msg.module ?? conv?.integration?.platform ?? "email",
    guestName: conv?.meta?.guestName ?? "Guest",
    platform: conv?.integration?.platform ?? msg.module ?? "",
  };
}
