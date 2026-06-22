import { describe, it, expect } from "vitest";
import { normalizeMessageWebhook } from "../backend/trigger/helpers/guesty-webhook.ts";

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
