// Active hours (Agent Config): the AI replies to guests only inside a weekly
// schedule, in Melbourne time (Phillip Island, VIC — AEST/AEDT, DST-aware).
//
// COPY of backend/supabase/functions/_shared/schedule.ts (the tested original, used by
// guesty-webhook). Keep the two in sync. Used here for the "replying now?" line.

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
