import { describe, it, expect } from "vitest";
import { postsToHistory } from "../trigger/messaging/main-agent.ts";

// Real Guesty /communication/conversations/{id}/posts shape: newest-first,
// sender in `sentBy` ("guest"|"host"), body is HTML, plainTextBody is clean.
const posts = [
  {
    sentBy: "host",
    plainTextBody: "I need a bit more context to help you properly, Liam!",
    body: "<div>I need a bit more context to help you properly, Liam!</div>",
    createdAt: "2026-07-14T15:46:40.000Z",
  },
  {
    sentBy: "guest",
    body: '<html><body dir="ltr"><div>That is correct.</div></body></html>',
    createdAt: "2026-07-14T15:46:32.000Z",
  },
  {
    sentBy: "host",
    plainTextBody: "Thanks for letting me know, Liam! ...is that correct?",
    createdAt: "2026-07-14T15:46:05.000Z",
  },
  {
    sentBy: "guest",
    body: "Tap not working in my room&#160;",
    createdAt: "2026-07-14T15:45:43.000Z",
  },
];

describe("postsToHistory", () => {
  it("orders posts oldest-first (Guesty returns them newest-first)", () => {
    const h = postsToHistory(posts as any);
    expect(h.map((m) => m.content)).toEqual([
      "Tap not working in my room",
      "Thanks for letting me know, Liam! ...is that correct?",
      "That is correct.",
      "I need a bit more context to help you properly, Liam!",
    ]);
  });

  it("maps sentBy -> role (guest vs host), not the nonexistent `type` field", () => {
    const h = postsToHistory(posts as any);
    expect(h.map((m) => m.role)).toEqual(["guest", "host", "guest", "host"]);
  });

  it("strips HTML tags and entities, preferring plainTextBody", () => {
    const h = postsToHistory(posts as any);
    // &#160; decoded + trimmed; HTML wrapper removed from the guest confirmation.
    expect(h[0].content).toBe("Tap not working in my room");
    expect(h[2].content).toBe("That is correct.");
  });

  it("gives the coordinator the confirmation context that was previously lost", () => {
    // The exact failure: a bare 'That is correct.' with no prior turns.
    const h = postsToHistory(posts as any);
    const text = h.map((m) => `${m.role}: ${m.content}`).join("\n");
    expect(text).toContain("guest: Tap not working");
    expect(text).toContain("host: Thanks for letting me know");
    expect(text.indexOf("Tap not working")).toBeLessThan(text.indexOf("That is correct."));
  });

  it("drops empty/attachment-only posts", () => {
    const withEmpty = [...posts, { sentBy: "guest", body: "", createdAt: "2026-07-14T15:47:00.000Z" }];
    expect(postsToHistory(withEmpty as any)).toHaveLength(4);
  });
});
