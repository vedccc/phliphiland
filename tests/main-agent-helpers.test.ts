import { describe, it, expect } from "vitest";
import { extractInbound, dedupeToolUses } from "../backend/trigger/messaging/main-agent.ts";

describe("extractInbound", () => {
  it("reads the normalized guesty payload", () => {
    const p = { data: { reservationId: "r1", conversationId: "c1", body: "hi", module: "airbnb2", guestName: "Liam" } };
    expect(extractInbound(p)).toMatchObject({
      reservationId: "r1",
      conversationId: "c1",
      body: "hi",
      module: "airbnb2",
      guestName: "Liam",
    });
  });

  it("reads a host-decision synthetic payload", () => {
    const p = {
      data: {
        reservation_id: "r1",
        conversation_id: "c1",
        module: "email",
        body: "[host-decision] approved",
        sender: { first_name: "host" },
      },
    };
    const e = extractInbound(p);
    expect(e.reservationId).toBe("r1");
    expect(e.conversationId).toBe("c1");
    expect(e.body).toContain("[host-decision]");
  });
});

describe("dedupeToolUses", () => {
  it("removes duplicate tool calls with identical input", () => {
    const blocks = [
      { type: "tool_use", id: "a", name: "use_knowledge_base", input: { query: "wifi" } },
      { type: "tool_use", id: "b", name: "use_knowledge_base", input: { query: "wifi" } },
      { type: "tool_use", id: "c", name: "use_knowledge_base", input: { query: "parking" } },
    ];
    expect(dedupeToolUses(blocks as any).length).toBe(2);
  });

  it("keeps the same tool with different input", () => {
    const blocks = [
      { type: "tool_use", id: "a", name: "use_knowledge_base", input: { query: "wifi" } },
      { type: "tool_use", id: "b", name: "process_extra_request", input: { item_requested: "towels" } },
    ];
    expect(dedupeToolUses(blocks as any).length).toBe(2);
  });
});
