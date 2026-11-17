import { describe, it, expect } from "vitest";
import { parseKbCategory, selectKbGapRecipients, kbGapSmsBody } from "../trigger/helpers/kb-gap-routing.ts";

type R = Parameters<typeof selectKbGapRecipients>[0][number];
const r = (id: string, flags: Partial<R> = {}): R => ({
  id, name: id, phone: "+61000",
  receives_kb_gaps: false, receives_kb_general: false, receives_kb_cleaning: false, receives_kb_maintenance: false,
  ...flags,
});
const ids = (xs: R[]) => xs.map((x) => x.id).sort();

describe("parseKbCategory", () => {
  it("reads the classifier's one-word answer, case and punctuation tolerant", () => {
    expect(parseKbCategory("maintenance")).toBe("maintenance");
    expect(parseKbCategory(" Cleaning.\n")).toBe("cleaning");
    expect(parseKbCategory("GENERAL")).toBe("general");
  });
  it("anything unexpected is general", () => {
    expect(parseKbCategory("")).toBe("general");
    expect(parseKbCategory("I think it's plumbing")).toBe("general");
  });
});

describe("selectKbGapRecipients", () => {
  const all = r("all", { receives_kb_gaps: true });
  const cleaner = r("cleaner", { receives_kb_cleaning: true });
  const fixer = r("fixer", { receives_kb_maintenance: true });
  const office = r("office", { receives_kb_general: true });

  it("sends to that category's recipients plus All", () => {
    expect(ids(selectKbGapRecipients([all, cleaner, fixer, office], "maintenance"))).toEqual(["all", "fixer"]);
    expect(ids(selectKbGapRecipients([all, cleaner, fixer, office], "cleaning"))).toEqual(["all", "cleaner"]);
    expect(ids(selectKbGapRecipients([all, cleaner, fixer, office], "general"))).toEqual(["all", "office"]);
  });

  it("falls back to General when nobody is ticked for the category", () => {
    expect(ids(selectKbGapRecipients([all, office, fixer], "cleaning"))).toEqual(["all", "office"]);
  });

  it("does not fall back when someone is ticked for the category", () => {
    expect(ids(selectKbGapRecipients([cleaner, office], "cleaning"))).toEqual(["cleaner"]);
  });

  it("never texts the same person twice", () => {
    const both = r("both", { receives_kb_gaps: true, receives_kb_general: true });
    expect(ids(selectKbGapRecipients([both], "cleaning"))).toEqual(["both"]);
  });

  it("people with no KB ticks get nothing", () => {
    expect(selectKbGapRecipients([r("none")], "general")).toEqual([]);
  });
});

describe("kbGapSmsBody", () => {
  it("names the category", () => {
    expect(kbGapSmsBody("Test Property", "How do I turn on the boiler?", "maintenance")).toBe(
      `⚠️ AI couldn't answer (Maintenance) at Test Property: "How do I turn on the boiler?". 8hr cooldown active. Please respond manually.`,
    );
  });
});
