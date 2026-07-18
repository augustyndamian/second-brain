import { describe, expect, it } from "vitest";
import type { Event, RecurringRule } from "../types.js";
import { expandRulesForDate, ruleMatches } from "./engine.js";
import { addDays } from "./dates.js";

const ts = "2026-05-01T00:00:00.000Z";

function rule(over: Partial<RecurringRule> & Pick<RecurringRule, "schedule">): RecurringRule {
  return {
    id: "r_x",
    area: "health",
    boardId: "b_health_main",
    title: "test",
    description: "",
    parentGoalRef: null,
    startsOn: "2026-05-01",
    endsOn: null,
    active: true, points: 1,
    createdAt: ts,
    ...over,
  };
}

describe("ruleMatches", () => {
  it("daily fires every day after startsOn", () => {
    const r = rule({ schedule: { type: "daily" }, startsOn: "2026-05-01" });
    expect(ruleMatches(r, "2026-05-01")).toBe(true);
    expect(ruleMatches(r, "2026-05-15")).toBe(true);
    expect(ruleMatches(r, "2026-04-30")).toBe(false);
  });

  it("weekdays fires Mon-Fri only", () => {
    const r = rule({ schedule: { type: "weekdays" } });
    // 2026-05-04 is Mon, 2026-05-09 is Sat, 2026-05-10 is Sun.
    expect(ruleMatches(r, "2026-05-04")).toBe(true);
    expect(ruleMatches(r, "2026-05-08")).toBe(true);
    expect(ruleMatches(r, "2026-05-09")).toBe(false);
    expect(ruleMatches(r, "2026-05-10")).toBe(false);
  });

  it("weekly fires only on listed daysOfWeek", () => {
    const r = rule({
      schedule: { type: "weekly", daysOfWeek: ["mon", "wed", "fri"] },
    });
    expect(ruleMatches(r, "2026-05-04")).toBe(true);  // Mon
    expect(ruleMatches(r, "2026-05-05")).toBe(false); // Tue
    expect(ruleMatches(r, "2026-05-06")).toBe(true);  // Wed
    expect(ruleMatches(r, "2026-05-08")).toBe(true);  // Fri
  });

  it("interval respects everyNDays anchor", () => {
    const r = rule({ schedule: { type: "interval", everyNDays: 3 }, startsOn: "2026-05-01" });
    expect(ruleMatches(r, "2026-05-01")).toBe(true);
    expect(ruleMatches(r, "2026-05-02")).toBe(false);
    expect(ruleMatches(r, "2026-05-04")).toBe(true);
    expect(ruleMatches(r, "2026-05-07")).toBe(true);
  });

  it("monthly clamps to last day of short months", () => {
    const r = rule({ schedule: { type: "monthly", dayOfMonth: 31 }, startsOn: "2026-01-01" });
    expect(ruleMatches(r, "2026-01-31")).toBe(true);
    // Feb 2026 has 28 days → fires on Feb 28
    expect(ruleMatches(r, "2026-02-28")).toBe(true);
    expect(ruleMatches(r, "2026-02-27")).toBe(false);
    expect(ruleMatches(r, "2026-04-30")).toBe(true); // April has 30
    expect(ruleMatches(r, "2026-04-29")).toBe(false);
  });

  it("respects endsOn", () => {
    const r = rule({ schedule: { type: "daily" }, startsOn: "2026-05-01", endsOn: "2026-05-03" });
    expect(ruleMatches(r, "2026-05-03")).toBe(true);
    expect(ruleMatches(r, "2026-05-04")).toBe(false);
  });

  it("inactive rules are not filtered here (caller handles active)", () => {
    const r = rule({ schedule: { type: "daily" }, active: false });
    expect(ruleMatches(r, "2026-05-15")).toBe(true);
  });
});

describe("expandRulesForDate", () => {
  const gymRule = rule({
    id: "r_gym",
    schedule: { type: "weekly", daysOfWeek: ["mon", "wed", "fri"] },
  });
  const dailyRule = rule({ id: "r_water", schedule: { type: "daily" } });

  it("returns pending instances for matching rules", () => {
    const instances = expandRulesForDate("2026-05-04", [gymRule, dailyRule], []);
    expect(instances).toHaveLength(2);
    expect(instances.map((i) => i.ruleId).sort()).toEqual(["r_gym", "r_water"]);
    expect(instances.every((i) => i.status === "pending")).toBe(true);
  });

  it("skips inactive rules", () => {
    const inactive = { ...gymRule, active: false };
    const instances = expandRulesForDate("2026-05-04", [inactive, dailyRule], []);
    expect(instances.map((i) => i.ruleId)).toEqual(["r_water"]);
  });

  it("done events flip status to done", () => {
    const events: Event[] = [
      { ts, type: "recurring.done", ruleId: "r_gym", forDate: "2026-05-04" },
    ];
    const instances = expandRulesForDate("2026-05-04", [gymRule], events);
    expect(instances[0]?.status).toBe("done");
  });

  it("skipped events flip status to skipped + carry reason", () => {
    const events: Event[] = [
      { ts, type: "recurring.skipped", ruleId: "r_gym", forDate: "2026-05-04", reason: "sick" },
    ];
    const [inst] = expandRulesForDate("2026-05-04", [gymRule], events);
    expect(inst?.status).toBe("skipped");
    expect(inst?.reason).toBe("sick");
  });

  it("rescheduled removes from source date and adds to target date", () => {
    const events: Event[] = [
      {
        ts,
        type: "recurring.rescheduled",
        ruleId: "r_gym",
        fromDate: "2026-05-04",
        toDate: "2026-05-05",
        reason: "moved",
      },
    ];
    const onMon = expandRulesForDate("2026-05-04", [gymRule], events);
    const onTue = expandRulesForDate("2026-05-05", [gymRule], events);
    expect(onMon).toHaveLength(0);
    expect(onTue).toHaveLength(1);
    expect(onTue[0]?.rescheduledFrom).toBe("2026-05-04");
  });

  it("rescheduled then done flips status on target date", () => {
    const events: Event[] = [
      { ts, type: "recurring.rescheduled", ruleId: "r_gym", fromDate: "2026-05-04", toDate: "2026-05-05", reason: null },
      { ts, type: "recurring.done", ruleId: "r_gym", forDate: "2026-05-05" },
    ];
    const onTue = expandRulesForDate("2026-05-05", [gymRule], events);
    expect(onTue[0]?.status).toBe("done");
  });
});

describe("expandRulesForDate snapshot — 14-day window", () => {
  it("matches expected schedule for mixed rules", () => {
    const rules: RecurringRule[] = [
      rule({ id: "r_water", schedule: { type: "daily" } }),
      rule({ id: "r_gym", schedule: { type: "weekly", daysOfWeek: ["mon", "wed", "fri"] } }),
      rule({ id: "r_pay", schedule: { type: "monthly", dayOfMonth: 15 }, startsOn: "2026-05-01" }),
      rule({ id: "r_alt", schedule: { type: "interval", everyNDays: 3 }, startsOn: "2026-05-01" }),
    ];
    const days: Record<string, string[]> = {};
    let d = "2026-05-01";
    for (let i = 0; i < 14; i++) {
      days[d] = expandRulesForDate(d, rules, []).map((i) => i.ruleId).sort();
      d = addDays(d, 1);
    }
    expect(days).toEqual({
      "2026-05-01": ["r_alt", "r_gym", "r_water"],   // Fri
      "2026-05-02": ["r_water"],                     // Sat
      "2026-05-03": ["r_water"],                     // Sun
      "2026-05-04": ["r_alt", "r_gym", "r_water"],   // Mon
      "2026-05-05": ["r_water"],                     // Tue
      "2026-05-06": ["r_gym", "r_water"],            // Wed
      "2026-05-07": ["r_alt", "r_water"],            // Thu
      "2026-05-08": ["r_gym", "r_water"],            // Fri
      "2026-05-09": ["r_water"],                     // Sat
      "2026-05-10": ["r_alt", "r_water"],            // Sun
      "2026-05-11": ["r_gym", "r_water"],            // Mon
      "2026-05-12": ["r_water"],                     // Tue
      "2026-05-13": ["r_alt", "r_gym", "r_water"],   // Wed
      "2026-05-14": ["r_water"],                     // Thu
    });
  });
});
