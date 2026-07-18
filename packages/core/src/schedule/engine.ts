import type { Event, RecurringRule } from "../types.js";
import {
  diffDays,
  lastDayOfMonth,
  parseDate,
  weekdayOf,
} from "./dates.js";

export type RecurringStatus = "pending" | "done" | "skipped";

export interface RecurringInstance {
  ruleId: string;
  forDate: string;
  status: RecurringStatus;
  reason?: string | null;
  rescheduledFrom?: string;
}

const WEEKDAY_SET = new Set(["mon", "tue", "wed", "thu", "fri"]);

/** True if rule's natural schedule fires on `date` (ignoring overrides). */
export function ruleMatches(rule: RecurringRule, date: string): boolean {
  if (date < rule.startsOn) return false;
  if (rule.endsOn && date > rule.endsOn) return false;

  const sched = rule.schedule;
  switch (sched.type) {
    case "daily":
      return true;
    case "weekdays":
      return WEEKDAY_SET.has(weekdayOf(date));
    case "weekly":
      return sched.daysOfWeek.includes(weekdayOf(date));
    case "interval": {
      const delta = diffDays(rule.startsOn, date);
      if (delta < 0) return false;
      return delta % sched.everyNDays === 0;
    }
    case "monthly": {
      const dt = parseDate(date);
      const dom = sched.dayOfMonth;
      const last = lastDayOfMonth(dt.getUTCFullYear(), dt.getUTCMonth() + 1);
      const effective = dom > last ? last : dom;
      return dt.getUTCDate() === effective;
    }
  }
}

/**
 * Expand recurring rules for a given date, applying override events.
 * Returns one instance per active rule that fires (or was rescheduled to) `date`.
 */
export function expandRulesForDate(
  date: string,
  rules: RecurringRule[],
  events: Event[],
): RecurringInstance[] {
  const activeRules = rules.filter((r) => r.active);
  const byId = new Map<string, RecurringRule>(activeRules.map((r) => [r.id, r]));

  const reschedFrom = new Set<string>(); // ruleIds whose forDate=date was moved away
  const reschedTo: { ruleId: string; from: string; reason: string | null }[] = [];
  const doneFor = new Map<string, RecurringStatus>(); // key = ruleId|date
  const reasonFor = new Map<string, string | null>();

  for (const e of events) {
    if (e.type === "recurring.rescheduled") {
      if (!byId.has(e.ruleId)) continue;
      if (e.fromDate === date) reschedFrom.add(e.ruleId);
      if (e.toDate === date) {
        reschedTo.push({ ruleId: e.ruleId, from: e.fromDate, reason: e.reason ?? null });
      }
    } else if (e.type === "recurring.done") {
      doneFor.set(`${e.ruleId}|${e.forDate}`, "done");
    } else if (e.type === "recurring.skipped") {
      doneFor.set(`${e.ruleId}|${e.forDate}`, "skipped");
      reasonFor.set(`${e.ruleId}|${e.forDate}`, e.reason ?? null);
    }
  }

  const instances: RecurringInstance[] = [];
  const seen = new Set<string>();

  for (const r of activeRules) {
    if (!ruleMatches(r, date)) continue;
    if (reschedFrom.has(r.id)) continue;
    const key = `${r.id}|${date}`;
    seen.add(r.id);
    instances.push({
      ruleId: r.id,
      forDate: date,
      status: doneFor.get(key) ?? "pending",
      reason: reasonFor.get(key) ?? null,
    });
  }

  for (const r of reschedTo) {
    if (seen.has(r.ruleId)) continue;
    const rule = byId.get(r.ruleId);
    if (!rule) continue;
    const key = `${r.ruleId}|${date}`;
    instances.push({
      ruleId: r.ruleId,
      forDate: date,
      status: doneFor.get(key) ?? "pending",
      reason: reasonFor.get(key) ?? null,
      rescheduledFrom: r.from,
    });
  }

  return instances;
}
