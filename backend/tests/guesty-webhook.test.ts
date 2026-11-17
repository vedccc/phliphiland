import { describe, it, expect } from "vitest";
import { normalizeMessageWebhook } from "../trigger/helpers/guesty-webhook.ts";

const guestEvent = {
  event: "reservation.messageReceived",
  reservationId: "res_1",
  conversation: {
    _id: "conv_1",
    conversationWith: "Guest",
    integration: { platform: "airbnb2" },
    meta: { guestName: "Liam" },
  },
  message: { type: "fromGuest", body: "what's the wifi?", module: "airbnb2", createdAt: "2026-06-22" },
};

describe("normalizeMessageWebhook", () => {
  it("normalizes a guest message", () => {
    expect(normalizeMessageWebhook(guestEvent)).toEqual({
      reservationId: "res_1",
      conversationId: "conv_1",
      body: "what's the wifi?",
      module: "airbnb2",
      guestName: "Liam",
      platform: "airbnb2",
    });
  });

  it("drops host messages", () => {
    const host = { ...guestEvent, message: { ...guestEvent.message, type: "fromHost" } };
    expect(normalizeMessageWebhook(host)).toBeNull();
  });

  it("drops the wrong event", () => {
    expect(normalizeMessageWebhook({ ...guestEvent, event: "reservation.updated" })).toBeNull();
  });

  it("accepts fromThirdParty as guest", () => {
    const tp = { ...guestEvent, message: { ...guestEvent.message, type: "fromThirdParty" } };
    expect(normalizeMessageWebhook(tp)?.conversationId).toBe("conv_1");
  });
});

import { shouldForward, TEST_CONVERSATION_IDS } from "../trigger/helpers/guesty-webhook.ts";

describe("shouldForward (test mode gate)", () => {
  const settings = (testMode: boolean, ids = ["conv_test"]) => ({ testMode, testConversationIds: ids });

  it("test mode on: forwards only listed conversations", () => {
    expect(shouldForward("conv_test", settings(true))).toBe(true);
    expect(shouldForward("conv_guest", settings(true))).toBe(false);
  });

  it("test mode off: forwards every conversation", () => {
    expect(shouldForward("conv_guest", settings(false))).toBe(true);
  });

  it("test mode on with an empty list forwards nothing", () => {
    expect(shouldForward("conv_test", settings(true, []))).toBe(false);
  });

  it("unreadable settings fail closed to the built-in test conversations", () => {
    expect(shouldForward(TEST_CONVERSATION_IDS[0], null)).toBe(true);
    expect(shouldForward("conv_guest", null)).toBe(false);
  });

  it("knows the two test conversations (Matt + ours)", () => {
    expect(TEST_CONVERSATION_IDS).toEqual(["6ab4e0843e05570011c490d7", "6a27b3f6ad3d6b00126f9b05"]);
  });
});
