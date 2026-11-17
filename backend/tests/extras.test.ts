import { describe, it, expect } from "vitest";
import {
  formatDelivery,
  buildHostDecisionBody,
  isExtraAllowed,
  splitRequestedItems,
} from "../supabase/functions/_shared/extras.ts";

// The live whitelist (allowed_extras) at the time of the reported bug.
const ALLOWED = ["Extra bedding", "Extra toiletries", "Extra towels"];

describe("isExtraAllowed", () => {
  it("allows a bundled multi-item request (the reported production bug)", () => {
    // Call RM_iF24agBnU8zh: agent sent "towels and bedding" and it was declined,
    // because neither string contained the other.
    expect(isExtraAllowed("towels and bedding", ALLOWED)).toBe(true);
  });

  it("still allows the single-item phrasings that already worked", () => {
    expect(isExtraAllowed("towels", ALLOWED)).toBe(true);
    expect(isExtraAllowed("extra towels", ALLOWED)).toBe(true);
    expect(isExtraAllowed("Extra Toiletries", ALLOWED)).toBe(true);
  });

  it("ignores filler words and punctuation around the item", () => {
    expect(isExtraAllowed("some extra towels, please", ALLOWED)).toBe(true);
    expect(isExtraAllowed("towels and bedding please", ALLOWED)).toBe(true);
    expect(isExtraAllowed("a couple of extra towels", ALLOWED)).toBe(true);
  });

  it("still declines items that are not on the whitelist", () => {
    expect(isExtraAllowed("a bottle of wine", ALLOWED)).toBe(false);
    expect(isExtraAllowed("late checkout", ALLOWED)).toBe(false);
  });

  it("declines a mixed request rather than silently approving the allowed half", () => {
    expect(isExtraAllowed("towels and a bottle of wine", ALLOWED)).toBe(false);
  });

  it("declines when the whitelist is empty or the request is empty", () => {
    expect(isExtraAllowed("towels", [])).toBe(false);
    expect(isExtraAllowed("", ALLOWED)).toBe(false);
    expect(isExtraAllowed("please", ALLOWED)).toBe(false);
  });
});

describe("splitRequestedItems", () => {
  it("splits on and / commas / ampersands", () => {
    expect(splitRequestedItems("towels and bedding")).toEqual(["towels", "bedding"]);
    expect(splitRequestedItems("towels, bedding & toiletries")).toEqual([
      "towels", "bedding", "toiletries",
    ]);
  });
});

describe("formatDelivery", () => {
  it("formats the host's picked wall-clock as an exact date + time", () => {
    // 2026-07-18 is a Saturday; 15:00 -> 3:00 PM. No tz conversion.
    expect(formatDelivery("2026-07-18T15:00")).toBe("Sat 18 Jul 2026, 3:00 PM");
  });

  it("handles noon and midnight without 0:00 / 24:00 glitches", () => {
    expect(formatDelivery("2026-07-18T12:00")).toContain("12:00 PM");
    expect(formatDelivery("2026-07-18T00:00")).toContain("12:00 AM");
  });

  it("keeps single-digit hours and zero-padded minutes", () => {
    expect(formatDelivery("2026-07-19T09:05")).toContain("9:05 AM");
  });

  it("tolerates a trailing seconds component", () => {
    expect(formatDelivery("2026-07-18T15:00:00")).toBe("Sat 18 Jul 2026, 3:00 PM");
  });

  it("returns null for anything unparseable so callers can fall back", () => {
    expect(formatDelivery(null)).toBeNull();
    expect(formatDelivery(undefined)).toBeNull();
    expect(formatDelivery("")).toBeNull();
    expect(formatDelivery("tomorrow afternoon")).toBeNull();
    expect(formatDelivery("2026-13-40T99:99")).toBeNull();
  });
});

describe("buildHostDecisionBody", () => {
  it("weaves the delivery time into an approved instruction", () => {
    const body = buildHostDecisionBody("approved", "extra towels", "2026-07-18T15:00");
    expect(body).toContain("extra towels");
    expect(body).toContain("Sat 18 Jul 2026, 3:00 PM");
    expect(body.startsWith("[host-decision] Host approved")).toBe(true);
  });

  it("falls back to the ORIGINAL time-less approved wording when no time is present", () => {
    // Byte-for-byte identical to the string extras-respond emitted before this change,
    // so an approval without a time behaves exactly as it did.
    const original =
      `[host-decision] Host approved extra request: "extra towels". Reply to the guest that we will deliver this for them.`;
    expect(buildHostDecisionBody("approved", "extra towels", null)).toBe(original);
    expect(buildHostDecisionBody("approved", "extra towels", "not-a-date")).toBe(original);
  });

  it("leaves the declined instruction unchanged (and never adds a time)", () => {
    const original =
      `[host-decision] Host declined extra request: "extra towels". Reply to the guest apologizing that this cannot be accommodated this time.`;
    expect(buildHostDecisionBody("declined", "extra towels", "2026-07-18T15:00")).toBe(original);
  });
});
