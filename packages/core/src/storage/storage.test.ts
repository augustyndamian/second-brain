import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeAreas } from "./areas.js";
import { readAllBoards, readBoard, updateBoard } from "./boards.js";
import { appendEvent, nowIso, readEvents } from "./events.js";
import { initStorage, isInitialized } from "./init.js";
import { nextBoardId, nextRuleId, nextTaskId, readMeta } from "./meta.js";
import { paths } from "./paths.js";
import { readRecurring, updateRecurring } from "./recurring.js";

let root: string;

/** initStorage bootstraps only the starter area — tests that need more seed areas.yaml first. */
const TEST_AREAS = [
  { id: "home", label: "Home", emoji: "🏠", color: "#8b5cf6" },
  { id: "work", label: "Work", emoji: "💼", color: "#3b82f6" },
  { id: "learning", label: "Learning", emoji: "📚", color: "#10b981" },
  { id: "health", label: "Health", emoji: "🌿", color: "#f59e0b" },
  { id: "finance", label: "Finance", emoji: "💰", color: "#ef4444" },
];

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), "kb-store-"));
  await writeAreas(root, TEST_AREAS);
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("initStorage", () => {
  it("creates expected layout with 4 default boards", async () => {
    await initStorage(root);
    expect(await isInitialized(root)).toBe(true);
    const p = paths(root);
    const stat = await fs.stat(p.boards);
    expect(stat.isDirectory()).toBe(true);

    const boards = await readAllBoards(root);
    expect(boards.map((b) => b.area).sort()).toEqual([
      "finance",
      "health",
      "home",
      "learning",
      "work",
    ]);
    for (const b of boards) {
      expect(b.isDefault).toBe(true);
      expect(b.tasks).toEqual([]);
    }
  });

  it("meta starts with sane counters", async () => {
    await initStorage(root);
    const meta = await readMeta(root);
    expect(meta.schemaVersion).toBe(3);
    expect(meta.nextTaskId).toBe(1);
    expect(meta.nextRuleId).toBe(1);
  });

  it("recurring file is empty list", async () => {
    await initStorage(root);
    const rec = await readRecurring(root);
    expect(rec.rules).toEqual([]);
  });
});

describe("counters", () => {
  it("nextTaskId/nextRuleId/nextBoardId are unique and monotonic", async () => {
    await initStorage(root);
    const t1 = await nextTaskId(root, "home");
    const t2 = await nextTaskId(root, "home");
    expect(t1).not.toBe(t2);
    const r1 = await nextRuleId(root);
    const r2 = await nextRuleId(root);
    expect(r1).not.toBe(r2);
    const b1 = await nextBoardId(root, "work", "Side Quests");
    expect(b1).toMatch(/^b_work_side_quests_/);
  });
});

describe("boards", () => {
  it("update mutates a board atomically", async () => {
    await initStorage(root);
    const ts = nowIso();
    await updateBoard(root, "b_health_main", (b) => ({
      ...b,
      tasks: [
        ...b.tasks,
        {
          id: "t_001",
          title: "Drink water",
          description: "",
          column: "todo",
          dueDate: null,
          plannedDate: null,
          parentGoalRef: null,
          priority: 5,
          note: null,
          createdAt: ts,
          updatedAt: ts,
          completedAt: null,
          completedSessionDate: null,
        },
      ],
    }));
    const b = await readBoard(root, "b_health_main");
    expect(b?.tasks).toHaveLength(1);
    expect(b?.tasks[0]?.title).toBe("Drink water");
  });
});

describe("recurring", () => {
  it("can append a rule via update", async () => {
    await initStorage(root);
    const ts = nowIso();
    await updateRecurring(root, (f) => ({
      ...f,
      rules: [
        ...f.rules,
        {
          id: "r_001",
          area: "health",
          boardId: null,
          title: "Push-ups",
          description: "",
          parentGoalRef: null,
          schedule: { type: "weekdays" },
          startsOn: "2026-05-01",
          endsOn: null,
          active: true, points: 1,
          createdAt: ts,
        },
      ],
    }));
    const rec = await readRecurring(root);
    expect(rec.rules).toHaveLength(1);
    expect(rec.rules[0]?.id).toBe("r_001");
  });
});

describe("events", () => {
  it("appends and reads back JSONL events", async () => {
    await initStorage(root);
    const ts = nowIso();
    await appendEvent(root, {
      ts,
      type: "recurring.done",
      ruleId: "r_001",
      forDate: "2026-05-02",
    });
    await appendEvent(root, {
      ts,
      type: "recurring.skipped",
      ruleId: "r_001",
      forDate: "2026-05-03",
      reason: "sick",
    });
    const events = await readEvents(root);
    // includes 4 board.created from initStorage + 2 above
    expect(events.length).toBeGreaterThanOrEqual(6);
    const recurringEvents = events.filter((e) => e.type.startsWith("recurring."));
    expect(recurringEvents).toHaveLength(2);
  });
});
