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

// Test mode (Agent Config switch, stored in agent_settings). The two test
// conversations: Matt's (GY-VZ8WCHB3) and ours (GY-WbGZxkrE). Gated by
// conversation id, which stays the same across a guest's bookings.
export const TEST_CONVERSATION_IDS = ["6ab4e0843e05570011c490d7", "6a27b3f6ad3d6b00126f9b05"];

export interface TestModeSettings {
  testMode: boolean;
  testConversationIds: string[];
}

// null = settings could not be read → fail closed (test mode, built-in list),
// so the agent never goes live by accident.
export function shouldForward(conversationId: string, settings: TestModeSettings | null): boolean {
  const s = settings ?? { testMode: true, testConversationIds: TEST_CONVERSATION_IDS };
  if (!s.testMode) return true;
  return s.testConversationIds.includes(conversationId);
}
