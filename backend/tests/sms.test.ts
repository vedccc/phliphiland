import { describe, it, expect } from "vitest";
import { toE164, twilioConfig, twilioRequest } from "../trigger/helpers/sms.ts";

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

describe("twilioConfig", () => {
  it("is null until an Account SID is set", () => {
    expect(twilioConfig({})).toBeNull();
    expect(twilioConfig({ TWILIO_AUTH_TOKEN: "tok" })).toBeNull();
  });

  it("is null when the Account SID has no secret", () => {
    expect(twilioConfig({ TWILIO_ACCOUNT_SID: "ACxxx" })).toBeNull();
  });

  it("authenticates with Account SID + Auth Token", () => {
    expect(twilioConfig({ TWILIO_ACCOUNT_SID: "ACxxx", TWILIO_AUTH_TOKEN: "tok" })).toEqual({
      accountSid: "ACxxx",
      user: "ACxxx",
      pass: "tok",
      from: "+61485026523",
    });
  });

  it("authenticates with an API key pair, but still addresses the Account SID", () => {
    const cfg = twilioConfig({
      TWILIO_ACCOUNT_SID: "ACxxx",
      TWILIO_API_KEY_SID: "SKyyy",
      TWILIO_API_KEY_SECRET: "sec",
      TWILIO_AUTH_TOKEN: "ignored",
    });
    expect(cfg).toMatchObject({ accountSid: "ACxxx", user: "SKyyy", pass: "sec" });
  });

  it("ignores a lone API key SID rather than pairing it with the wrong secret", () => {
    const cfg = twilioConfig({ TWILIO_ACCOUNT_SID: "ACxxx", TWILIO_API_KEY_SID: "SKyyy", TWILIO_AUTH_TOKEN: "tok" });
    expect(cfg).toMatchObject({ user: "ACxxx", pass: "tok" });
  });

  it("uses TWILIO_FROM_NUMBER when set", () => {
    const cfg = twilioConfig({ TWILIO_ACCOUNT_SID: "ACxxx", TWILIO_AUTH_TOKEN: "tok", TWILIO_FROM_NUMBER: "+15550001111" });
    expect(cfg?.from).toBe("+15550001111");
  });
});

describe("twilioRequest", () => {
  const cfg = { accountSid: "ACxxx", user: "ACxxx", pass: "tok", from: "+61485026523" };

  it("posts to the account's Messages endpoint", () => {
    expect(twilioRequest(cfg, "+61400000000", "hi").url).toBe(
      "https://api.twilio.com/2010-04-01/Accounts/ACxxx/Messages.json",
    );
  });

  it("sends HTTP Basic auth as user:pass", () => {
    const { headers } = twilioRequest(cfg, "+61400000000", "hi");
    expect(headers.Authorization).toBe(`Basic ${Buffer.from("ACxxx:tok").toString("base64")}`);
    expect(headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
  });

  it("form-encodes To/From/Body and normalizes the recipient to E.164", () => {
    const params = new URLSearchParams(twilioRequest(cfg, "61 400 000 000", "Heater broken & urgent").body);
    expect(params.get("To")).toBe("+61400000000");
    expect(params.get("From")).toBe("+61485026523");
    expect(params.get("Body")).toBe("Heater broken & urgent");
  });
});
