// SMS recipient schedules (SMS Recipients → AI agent number): a recipient with a
// schedule only gets texts inside its weekly hours, in Melbourne time
// (Phillip Island, VIC — AEST/AEDT, DST-aware). Recipients without one always do.
//
// Dashboard copy: used by SMS Recipients to show whether the agent number is on duty.
// Copies: supabase/functions/_shared/schedule.ts, trigger/helpers/schedule.ts. Keep them identical — backend/tests/schedule.test.ts runs
// the same suite against the backend copies.

export const SCHEDULE_TIMEZONE = "Australia/Melbourne";

export type DayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
export const DAY_KEYS: DayKey[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

/** start/end are "HH:MM" (24h). end < start runs overnight; end == start is all day. */
export interface DayWindow { on: boolean; start: string; end: string }
export type WeeklySchedule = Record<DayKey, DayWindow>;

export const DEFAULT_SCHEDULE: WeeklySchedule = {
  mon: { on: true, start: "09:00", end: "17:00" },
  tue: { on: true, start: "09:00", end: "17:00" },
  wed: { on: true, start: "09:00", end: "17:00" },
  thu: { on: true, start: "09:00", end: "17:00" },
  fri: { on: true, start: "09:00", end: "17:00" },
  sat: { on: false, start: "09:00", end: "17:00" },
  sun: { on: false, start: "09:00", end: "17:00" },
};

function toMinutes(hhmm: unknown): number | null {
  if (typeof hhmm !== "string") return null;
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** The current Melbourne weekday and minutes past midnight. */
export function melbourneNow(now: Date): { day: DayKey; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: SCHEDULE_TIMEZONE,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return {
    day: get("weekday").slice(0, 3).toLowerCase() as DayKey,
    minutes: (Number(get("hour")) % 24) * 60 + Number(get("minute")),
  };
}

/** True when `now` falls inside the schedule. A malformed day counts as off. */
export function isWithinSchedule(schedule: WeeklySchedule, now: Date): boolean {
  if (!schedule || typeof schedule !== "object") return false;
  const { day, minutes } = melbourneNow(now);
  const idx = DAY_KEYS.indexOf(day);
  if (idx < 0) return false;

  const today = schedule[day];
  if (today?.on) {
    const s = toMinutes(today.start);
    const e = toMinutes(today.end);
    if (s !== null && e !== null) {
      if (s === e) return true; // all day
      if (e > s ? minutes >= s && minutes < e : minutes >= s) return true;
    }
  }

  // The tail of yesterday's overnight window (e.g. Thu 17:00 → Fri 09:00).
  const yesterday = schedule[DAY_KEYS[(idx + 6) % 7]];
  if (yesterday?.on) {
    const s = toMinutes(yesterday.start);
    const e = toMinutes(yesterday.end);
    if (s !== null && e !== null && e < s && minutes < e) return true;
  }
  return false;
}

/** Anything with an optional weekly schedule (e.g. an sms_recipients row). */
export interface Scheduled { schedule?: WeeklySchedule | null }

/**
 * Keep only recipients on duty right now. No schedule = always on duty (every
 * person on the list); a scheduled recipient (an AI agent number) only inside
 * its hours. Outside them its copy is skipped, not queued.
 */
export function onDuty<T extends Scheduled>(recipients: T[], now: Date = new Date()): T[] {
  return recipients.filter((r) => !r.schedule || isWithinSchedule(r.schedule, now));
}
