import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initStorage } from "../storage/init.js";
import { writeAreas } from "../storage/areas.js";
import { readAllBoards } from "../storage/boards.js";
import { readEvents } from "../storage/events.js";
import { readTracking } from "../storage/tracking.js";
import { createTask } from "./tasks.js";
import { createTrackingItem } from "./tracking.js";
import {
  moveTasksBatch,
  rescheduleTasksBatch,
  editTasksBatch,
  BatchValidationError,
} from "./tasks.js";
import { editTrackingItemsBatch } from "./tracking.js";

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), "kb-batch-"));
  // Seed areas before init: initStorage bootstraps only the starter area.
  await writeAreas(root, [
    { id: "home", label: "Home", emoji: "🏠", color: "#8b5cf6" },
    { id: "work", label: "Work", emoji: "💼", color: "#3b82f6" },
  ]);
  await initStorage(root);
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

// ── helpers ──────────────────────────────────────────────────────────────────

async function makeTask(area: "work" | "home" = "work", column: "todo" | "doing" | "done" = "todo") {
  return createTask(root, { area, title: `task-${Math.random().toString(36).slice(2, 6)}`, column });
}

async function makeTracker() {
  return createTrackingItem(root, { kind: "commitment", area: "work", title: "tracker-" + Math.random().toString(36).slice(2, 6) });
}

function findTaskOnBoard(boards: Awaited<ReturnType<typeof readAllBoards>>, id: string) {
  for (const b of boards) {
    const t = b.tasks.find((t) => t.id === id);
    if (t) return { task: t, board: b };
  }
  return null;
}

// ── move-batch ────────────────────────────────────────────────────────────────

describe("moveTasksBatch", () => {
  it("rejects empty array", async () => {
    await expect(moveTasksBatch(root, [])).rejects.toBeInstanceOf(BatchValidationError);
  });

  it("rejects invalid column", async () => {
    const { task } = await makeTask();
    await expect(
      moveTasksBatch(root, [{ id: task.id, column: "invalid" as any }]),
    ).rejects.toBeInstanceOf(BatchValidationError);
  });

  it("rejects unknown task id", async () => {
    await expect(
      moveTasksBatch(root, [{ id: "nonexistent_001", column: "doing" }]),
    ).rejects.toBeInstanceOf(BatchValidationError);
  });

  it("moves single task", async () => {
    const { task } = await makeTask("work", "todo");
    const results = await moveTasksBatch(root, [{ id: task.id, column: "doing" }]);
    expect(results).toHaveLength(1);
    expect(results[0]!.from).toBe("todo");
    expect(results[0]!.to).toBe("doing");

    const boards = await readAllBoards(root);
    expect(findTaskOnBoard(boards, task.id)!.task.column).toBe("doing");
  });

  it("moves multiple tasks atomically", async () => {
    const t1 = await makeTask("work", "todo");
    const t2 = await makeTask("work", "todo");
    const t3 = await makeTask("home", "todo");

    await moveTasksBatch(root, [
      { id: t1.task.id, column: "doing" },
      { id: t2.task.id, column: "done" },
      { id: t3.task.id, column: "doing" },
    ]);

    const boards = await readAllBoards(root);
    expect(findTaskOnBoard(boards, t1.task.id)!.task.column).toBe("doing");
    expect(findTaskOnBoard(boards, t2.task.id)!.task.column).toBe("done");
    expect(findTaskOnBoard(boards, t3.task.id)!.task.column).toBe("doing");
  });

  it("emits per-item events with same batchId", async () => {
    const t1 = await makeTask();
    const t2 = await makeTask();
    const before = await readEvents(root);

    await moveTasksBatch(root, [
      { id: t1.task.id, column: "doing" },
      { id: t2.task.id, column: "doing" },
    ]);

    const after = await readEvents(root);
    const newEvents = after.slice(before.length).filter((e) => e.type === "task.moved");
    expect(newEvents).toHaveLength(2);
    const batchIds = newEvents.map((e: any) => e.batchId);
    expect(batchIds[0]).toBeTruthy();
    expect(batchIds[0]).toBe(batchIds[1]);
  });

  it("all-or-nothing: one invalid id aborts whole batch", async () => {
    const { task } = await makeTask("work", "todo");
    await expect(
      moveTasksBatch(root, [
        { id: task.id, column: "doing" },
        { id: "bad_999", column: "doing" },
      ]),
    ).rejects.toBeInstanceOf(BatchValidationError);

    const boards = await readAllBoards(root);
    expect(findTaskOnBoard(boards, task.id)!.task.column).toBe("todo");
  });
});

// ── reschedule-batch ──────────────────────────────────────────────────────────

describe("rescheduleTasksBatch", () => {
  it("rejects empty array", async () => {
    await expect(rescheduleTasksBatch(root, [])).rejects.toBeInstanceOf(BatchValidationError);
  });

  it("rejects bad date format", async () => {
    const { task } = await makeTask();
    await expect(
      rescheduleTasksBatch(root, [{ id: task.id, to: "not-a-date" }]),
    ).rejects.toBeInstanceOf(BatchValidationError);
  });

  it("rejects past date", async () => {
    const { task } = await makeTask();
    await expect(
      rescheduleTasksBatch(root, [{ id: task.id, to: "2020-01-01" }]),
    ).rejects.toBeInstanceOf(BatchValidationError);
  });

  it("rejects done task", async () => {
    const { task } = await makeTask("work", "done");
    await expect(
      rescheduleTasksBatch(root, [{ id: task.id, to: "2099-01-01" }]),
    ).rejects.toBeInstanceOf(BatchValidationError);
  });

  it("reschedules single task", async () => {
    const { task } = await makeTask("work", "doing");
    const results = await rescheduleTasksBatch(root, [{ id: task.id, to: "2099-06-01", reason: "test" }]);
    expect(results[0]!.toPlanned).toBe("2099-06-01");
    expect(results[0]!.fromColumn).toBe("doing");

    const boards = await readAllBoards(root);
    const found = findTaskOnBoard(boards, task.id)!;
    expect(found.task.column).toBe("todo");
    expect(found.task.plannedDate).toBe("2099-06-01");
  });

  it("reschedules multiple tasks with shared batchId", async () => {
    const t1 = await makeTask("work", "todo");
    const t2 = await makeTask("work", "todo");
    const before = await readEvents(root);

    await rescheduleTasksBatch(root, [
      { id: t1.task.id, to: "2099-06-01" },
      { id: t2.task.id, to: "2099-07-01" },
    ]);

    const after = await readEvents(root);
    const newEvts = after.slice(before.length).filter((e) => e.type === "task.rescheduled");
    expect(newEvts).toHaveLength(2);
    const bids = newEvts.map((e: any) => e.batchId);
    expect(bids[0]).toBeTruthy();
    expect(bids[0]).toBe(bids[1]);
  });
});

// ── edit-batch ────────────────────────────────────────────────────────────────

describe("editTasksBatch", () => {
  it("rejects empty array", async () => {
    await expect(editTasksBatch(root, [])).rejects.toBeInstanceOf(BatchValidationError);
  });

  it("rejects item with no edit fields", async () => {
    const { task } = await makeTask();
    await expect(editTasksBatch(root, [{ id: task.id } as any])).rejects.toBeInstanceOf(BatchValidationError);
  });

  it("rejects invalid priority", async () => {
    const { task } = await makeTask();
    await expect(editTasksBatch(root, [{ id: task.id, priority: 99 }])).rejects.toBeInstanceOf(BatchValidationError);
  });

  it("edits single task", async () => {
    const { task } = await makeTask();
    const results = await editTasksBatch(root, [{ id: task.id, priority: 9, title: "updated title" }]);
    expect(results[0]!.changes.priority).toEqual([task.priority, 9]);
    expect(results[0]!.changes.title).toBeTruthy();

    const boards = await readAllBoards(root);
    const found = findTaskOnBoard(boards, task.id)!;
    expect(found.task.priority).toBe(9);
    expect(found.task.title).toBe("updated title");
  });

  it("edits multiple tasks atomically with batchId on events", async () => {
    const t1 = await makeTask();
    const t2 = await makeTask();
    const before = await readEvents(root);

    await editTasksBatch(root, [
      { id: t1.task.id, priority: 8 },
      { id: t2.task.id, priority: 7 },
    ]);

    const after = await readEvents(root);
    const newEvts = after.slice(before.length).filter((e) => e.type === "task.edited");
    expect(newEvts).toHaveLength(2);
    const bids = newEvts.map((e: any) => e.batchId);
    expect(bids[0]).toBe(bids[1]);
  });
});

// ── tracking edit-batch ───────────────────────────────────────────────────────

describe("editTrackingItemsBatch", () => {
  it("rejects empty array", async () => {
    await expect(editTrackingItemsBatch(root, [])).rejects.toThrow();
  });

  it("rejects item missing edit fields", async () => {
    const item = await makeTracker();
    await expect(editTrackingItemsBatch(root, [{ id: item.id } as any])).rejects.toThrow();
  });

  it("rejects unknown id", async () => {
    await expect(editTrackingItemsBatch(root, [{ id: "bad_trk", status: "done" }])).rejects.toThrow();
  });

  it("edits single tracker item", async () => {
    const item = await makeTracker();
    const results = await editTrackingItemsBatch(root, [{ id: item.id, status: "done" }]);
    expect(results[0]!.changes.status).toEqual(["todo", "done"]);

    const { items } = await readTracking(root);
    const found = items.find((i) => i.id === item.id)!;
    expect(found.status).toBe("done");
  });

  it("edits multiple tracker items in single write with batchId on events", async () => {
    const t1 = await makeTracker();
    const t2 = await makeTracker();
    const before = await readEvents(root);

    await editTrackingItemsBatch(root, [
      { id: t1.id, status: "done" },
      { id: t2.id, status: "in-progress" },
    ]);

    const after = await readEvents(root);
    const newEvts = after.slice(before.length).filter((e) => e.type === "tracking.edited");
    expect(newEvts).toHaveLength(2);
    const bids = newEvts.map((e: any) => e.batchId);
    expect(bids[0]).toBeTruthy();
    expect(bids[0]).toBe(bids[1]);
  });
});
