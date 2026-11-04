import { ConvexError } from "convex/values";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Loans use calendar dates (YYYY-MM-DD); "today" comes from resolveToday. */
export function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function todayIso(now: number = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

const HOUR_MS = 60 * 60 * 1000;

/**
 * "Today" for the calling user. Clients send their local calendar date; it is
 * accepted only if it is today in some real time zone (UTC-12 to UTC+14) right
 * now, so a client can't move "today" arbitrarily. Without one, UTC is used.
 */
export function resolveToday(clientToday: string | undefined, now: number = Date.now()): string {
  if (clientToday === undefined) return todayIso(now);
  const earliest = todayIso(now - 12 * HOUR_MS);
  const latest = todayIso(now + 14 * HOUR_MS);
  if (!isIsoDate(clientToday) || clientToday < earliest || clientToday > latest) {
    throw new ConvexError({ code: "INVALID_ARGUMENT", message: "Invalid local date." });
  }
  return clientToday;
}

export function addDays(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Whole days from `a` to `b` (b - a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);
}

/** Inclusive ranges [aStart, aEnd] and [bStart, bEnd] share at least one day. */
export function rangesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string) {
  return aStart <= bEnd && bStart <= aEnd;
}

export function assertValidRange(
  startDate: string,
  endDate: string,
  opts: { today: string; maxDays: number; maxLeadDays: number },
) {
  const fail = (message: string) => {
    throw new ConvexError({ code: "INVALID_ARGUMENT", message });
  };
  if (!isIsoDate(startDate) || !isIsoDate(endDate)) fail("Dates must be YYYY-MM-DD.");
  if (startDate < opts.today) fail("The loan cannot start in the past.");
  if (endDate < startDate) fail("The end date must be on or after the start date.");
  if (daysBetween(startDate, endDate) + 1 > opts.maxDays) {
    fail(`Loans can last at most ${opts.maxDays} days.`);
  }
  if (daysBetween(opts.today, startDate) > opts.maxLeadDays) {
    fail(`Loans can start at most ${opts.maxLeadDays} days ahead.`);
  }
}
