import { describe, it, expect } from "vitest";
import * as edge from "../supabase/functions/_shared/schedule.ts";
import * as node from "../trigger/helpers/schedule.js";
import type { WeeklySchedule } from "../trigger/helpers/schedule.js";

// The edge-function copy and the Trigger.dev copy must behave identically.
describe.each([
  ["edge (_shared/schedule.ts)", edge],
  ["trigger (helpers/schedule.ts)", node],
])("%s", (_name, mod) => {
const { isWithinSchedule, melbourneNow, DEFAULT_SCHEDULE, onDuty } = mod;

// Melbourne is UTC+11 in November (AEDT) and UTC+10 in July (AEST).
// 2026-11-19 is a Thursday.
const at = (iso: string) => new Date(iso);

const weekdays9to5: WeeklySchedule = DEFAULT_SCHEDULE; // Mon–Fri 09:00–17:00, weekend off

describe("melbourneNow", () => {
  it("converts UTC to Melbourne day and minutes, daylight saving included", () => {
    expect(melbourneNow(at("2026-11-19T03:30:00Z"))).toEqual({ day: "thu", minutes: 14 * 60 + 30 }); // AEDT
    expect(melbourneNow(at("2026-07-16T03:30:00Z"))).toEqual({ day: "thu", minutes: 13 * 60 + 30 }); // AEST
  });

  it("rolls the day over at Melbourne midnight, not UTC midnight", () => {
    // 13:30 UTC Thursday = 00:30 Friday in Melbourne
    expect(melbourneNow(at("2026-11-19T13:30:00Z"))).toEqual({ day: "fri", minutes: 30 });
  });
});

describe("isWithinSchedule", () => {
  it("is inside during a weekday window", () => {
    expect(isWithinSchedule(weekdays9to5, at("2026-11-19T03:30:00Z"))).toBe(true); // Thu 14:30
  });

  it("start is inclusive, end is exclusive", () => {
    expect(isWithinSchedule(weekdays9to5, at("2026-11-18T22:00:00Z"))).toBe(true); // Thu 09:00
    expect(isWithinSchedule(weekdays9to5, at("2026-11-19T06:00:00Z"))).toBe(false); // Thu 17:00
  });

  it("is outside before and after the window", () => {
    expect(isWithinSchedule(weekdays9to5, at("2026-11-18T21:59:00Z"))).toBe(false); // Thu 08:59
    expect(isWithinSchedule(weekdays9to5, at("2026-11-19T09:00:00Z"))).toBe(false); // Thu 20:00
  });

  it("is outside on a day that is switched off", () => {
    expect(isWithinSchedule(weekdays9to5, at("2026-11-21T03:00:00Z"))).toBe(false); // Sat 14:00
  });

  it("supports overnight windows that cross midnight", () => {
    const afterHours: WeeklySchedule = {
      ...weekdays9to5,
      thu: { on: true, start: "17:00", end: "09:00" },
      fri: { on: false, start: "17:00", end: "09:00" },
    };
    expect(isWithinSchedule(afterHours, at("2026-11-19T09:00:00Z"))).toBe(true); // Thu 20:00
    // Fri 02:00 is still Thursday night's window, even though Friday itself is off
    expect(isWithinSchedule(afterHours, at("2026-11-19T15:00:00Z"))).toBe(true);
    expect(isWithinSchedule(afterHours, at("2026-11-19T22:30:00Z"))).toBe(false); // Fri 09:30
    expect(isWithinSchedule(afterHours, at("2026-11-19T03:00:00Z"))).toBe(false); // Thu 14:00
  });

  it("treats the same start and end as all day", () => {
    const allDaySat: WeeklySchedule = { ...weekdays9to5, sat: { on: true, start: "00:00", end: "00:00" } };
    expect(isWithinSchedule(allDaySat, at("2026-11-20T13:05:00Z"))).toBe(true); // Sat 00:05
    expect(isWithinSchedule(allDaySat, at("2026-11-21T12:50:00Z"))).toBe(true); // Sat 23:50
  });

  it("treats a malformed day as off", () => {
    const broken = { ...weekdays9to5, thu: { on: true, start: "nine", end: "17:00" } } as WeeklySchedule;
    expect(isWithinSchedule(broken, at("2026-11-19T03:30:00Z"))).toBe(false);
    expect(isWithinSchedule(null as unknown as WeeklySchedule, at("2026-11-19T03:30:00Z"))).toBe(false);
  });
});

describe("onDuty", () => {
  const person = { name: "Matt", schedule: null };
  const agent = { name: "AI agent", schedule: weekdays9to5 };

  it("always keeps recipients without a schedule", () => {
    expect(onDuty([person], at("2026-11-21T03:00:00Z"))).toEqual([person]); // Sat 14:00
  });

  it("keeps a scheduled recipient inside its hours", () => {
    expect(onDuty([person, agent], at("2026-11-19T03:30:00Z"))).toEqual([person, agent]); // Thu 14:30
  });

  it("skips a scheduled recipient outside its hours", () => {
    expect(onDuty([person, agent], at("2026-11-19T09:00:00Z"))).toEqual([person]); // Thu 20:00
  });
});
});
