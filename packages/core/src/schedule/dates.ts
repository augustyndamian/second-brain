import type { Weekday } from "../types.js";

const WEEKDAYS: Weekday[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/** Parse YYYY-MM-DD as a UTC midnight Date (no timezone drift). */
export function parseDate(d: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (!m) throw new Error(`invalid date: ${d}`);
  return new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!));
}

export function formatDate(d: Date): string {
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
  const da = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${mo}-${da}`;
}

export function addDays(d: string, n: number): string {
  const date = parseDate(d);
  date.setUTCDate(date.getUTCDate() + n);
  return formatDate(date);
}

export function diffDays(from: string, to: string): number {
  const a = parseDate(from).getTime();
  const b = parseDate(to).getTime();
  return Math.round((b - a) / 86400000);
}

export function weekdayOf(d: string): Weekday {
  return WEEKDAYS[parseDate(d).getUTCDay()]!;
}

/** Convert an ISO timestamp to a YYYY-MM-DD string in local timezone. */
export function localDateOf(isoTs: string): string {
  const d = new Date(isoTs);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Today in the local timezone, as YYYY-MM-DD. */
export function localToday(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function lastDayOfMonth(year: number, month1to12: number): number {
  return new Date(Date.UTC(year, month1to12, 0)).getUTCDate();
}
