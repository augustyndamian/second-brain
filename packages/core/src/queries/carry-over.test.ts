import { describe, expect, it } from "vitest";
import type { Event } from "../types.js";
import { computeCarryOverMap } from "./carry-over.js";

function ev(over: Partial<Extract<Event, { type: "task.rescheduled" }>>): Event {
  return {
    ts: "2026-05-08T08:00:00.000Z",
    type: "task.rescheduled",
    taskId: "t1",
    boardId: "b1",
    fromPlanned: "2026-05-07",
    toPlanned: "2026-05-08",
    fromColumn: "doing",
    sessionDate: "2026-05-08",
    reason: null,
    ...over,
  } as Event;
}

describe("computeCarryOverMap", () => {
  it("captures simple carry-over (from < to)", () => {
    const map = computeCarryOverMap([ev({})], "2026-05-08");
    expect(map.get("t1")).toBe("2026-05-07");
  });

  it("multi-hop: last event wins (5→6→8 viewed at 8 → from=6)", () => {
    const events: Event[] = [
      ev({ taskId: "t1", fromPlanned: "2026-05-05", toPlanned: "2026-05-06", ts: "2026-05-06T08:00:00.000Z" }),
      ev({ taskId: "t1", fromPlanned: "2026-05-06", toPlanned: "2026-05-08", ts: "2026-05-08T08:00:00.000Z" }),
    ];
    const map = computeCarryOverMap(events, "2026-05-08");
    expect(map.get("t1")).toBe("2026-05-06");
  });

  it("ignores events targeting other dates", () => {
    const map = computeCarryOverMap([ev({ toPlanned: "2026-05-09" })], "2026-05-08");
    expect(map.has("t1")).toBe(false);
  });

  it("ignores fromPlanned=null (first plan, not carry-over)", () => {
    const map = computeCarryOverMap([ev({ fromPlanned: null })], "2026-05-08");
    expect(map.has("t1")).toBe(false);
  });

  it("ignores no-op anchor (from === to)", () => {
    const map = computeCarryOverMap([ev({ fromPlanned: "2026-05-08" })], "2026-05-08");
    expect(map.has("t1")).toBe(false);
  });

  it("ignores forward-pull (from > to)", () => {
    const map = computeCarryOverMap([ev({ fromPlanned: "2026-05-10" })], "2026-05-08");
    expect(map.has("t1")).toBe(false);
  });

  it("ignores non-rescheduled events", () => {
    const evs: Event[] = [
      { ts: "2026-05-08T08:00:00.000Z", type: "task.moved", taskId: "t1", boardId: "b1", from: "todo", to: "doing" },
    ];
    const map = computeCarryOverMap(evs, "2026-05-08");
    expect(map.size).toBe(0);
  });

  it("year-boundary carry-over (31 grudnia → 1 stycznia)", () => {
    const map = computeCarryOverMap(
      [ev({ taskId: "t2", fromPlanned: "2025-12-31", toPlanned: "2026-01-01" })],
      "2026-01-01",
    );
    expect(map.get("t2")).toBe("2025-12-31");
  });
});
