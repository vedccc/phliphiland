import { describe, it, expect } from "vitest";
import { toE164 } from "../trigger/helpers/sms.ts";

describe("toE164", () => {
  it("adds the missing + to a bare international number (the Telnyx 40310 bug)", () => {
    // Vedant's stored recipient number — SMSAPI accepted it, Telnyx rejected it.
    expect(toE164("917724958567")).toBe("+917724958567");
  });

  it("leaves an already-E.164 number untouched", () => {
    expect(toE164("+18333180776")).toBe("+18333180776");
  });

  it("strips spaces, dashes and parens", () => {
    expect(toE164("+61 434 (945) 150-6")).toBe("+614349451506");
    expect(toE164("917724 958567")).toBe("+917724958567");
  });

  it("converts a 00 international prefix to +", () => {
    expect(toE164("0061412345678")).toBe("+61412345678");
  });
});
