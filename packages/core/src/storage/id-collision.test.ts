import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import YAML from "yaml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTask, moveTasksBatch, showTask } from "../services/tasks.js";
import { writeAreas } from "./areas.js";
import { findTaskBoard, readBoard, writeBoard } from "./boards.js";
import { initStorage } from "./init.js";
import { readMeta, writeMeta } from "./meta.js";
import { runMigrations } from "./migrate.js";
import { paths } from "./paths.js";
import { nowIso } from "./events.js";
import type { Board, Task } from "../types.js";

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), "kb-idcol-"));
  await writeAreas(root, [{ id: "home", label: "Home", emoji: "🏠", color: "#8b5cf6" }]);
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

function task(id: string, title: string, column: Task["column"] = "todo"): Task {
  const ts = nowIso();
  return {
    id,
    title,
    description: "",
    column,
    dueDate: null,
    plannedDate: null,
    parentGoalRef: null,
    priority: 5,
    note: null,
    createdAt: ts,
    updatedAt: ts,
    completedAt: column === "done" ? ts : null,
    completedSessionDate: null,
  };
}

/** Writes a board YAML directly, bypassing writeBoard's duplicate guard. */
async function writeBoardRaw(board: Board): Promise<void> {
  await fs.writeFile(join(paths(root).boards, `${board.id}.yaml`), YAML.stringify(board), "utf8");
}

describe("id allocation with lagging counters", () => {
  it("never mints an id that already exists on a board", async () => {
    await initStorage(root);
    const first = await createTask(root, { area: "home", title: "existing" });
    expect(first.task.id).toBe("home_001");

    // Simulate the confirmed field corruption: counters reset while data remains.
    const meta = await readMeta(root);
    await writeMeta(root, { ...meta, taskCounters: {} });

    const second = await createTask(root, { area: "home", title: "new" });
    expect(second.task.id).not.toBe(first.task.id);
    expect(second.task.id).toBe("home_002");

    const board = await readBoard(root, "b_home_main");
    expect(board?.tasks.map((t) => t.title).sort()).toEqual(["existing", "new"]);
  });
});

describe("v3 -> v4 migration", () => {
  it("seeds lagging counters from existing board task ids", async () => {
    await initStorage(root);
    const board = (await readBoard(root, "b_home_main"))!;
    await writeBoard(root, { ...board, tasks: [task("home_001", "a"), task("home_248", "b")] });
    const meta = await readMeta(root);
    await writeMeta(root, { ...meta, schemaVersion: 3, taskCounters: { home: 2 } });

    await runMigrations(root);

    const after = await readMeta(root);
    expect(after.schemaVersion).toBe(4);
    expect(after.taskCounters.home).toBe(249);
  });

  it("folds legacy nextTaskId<Area> fields left on a v3-stamped meta", async () => {
    await initStorage(root);
    // The field-observed corruption shape: schemaVersion already 3, but the
    // per-area counters still live in legacy fixed fields.
    await fs.writeFile(
      paths(root).meta,
      YAML.stringify({
        schemaVersion: 3,
        nextTaskId: 1,
        nextBoardId: 2,
        nextRuleId: 1,
        nextTaskIdHome: 7,
        nextTrackingId: 1,
      }),
      "utf8",
    );

    await runMigrations(root);

    const after = await readMeta(root);
    expect(after.schemaVersion).toBe(4);
    expect(after.taskCounters.home).toBe(7);
    expect((after as Record<string, unknown>).nextTaskIdHome).toBeUndefined();
  });

  it("is idempotent and never lowers a counter", async () => {
    await initStorage(root);
    const meta = await readMeta(root);
    await writeMeta(root, { ...meta, schemaVersion: 3, taskCounters: { home: 42 } });
    await runMigrations(root);
    await runMigrations(root);
    expect((await readMeta(root)).taskCounters.home).toBe(42);
  });
});

describe("duplicate-id guards", () => {
  it("writeBoard refuses a board with duplicate task ids", async () => {
    await initStorage(root);
    const board = (await readBoard(root, "b_home_main"))!;
    await expect(
      writeBoard(root, { ...board, tasks: [task("home_001", "old"), task("home_001", "new")] }),
    ).rejects.toThrow(/duplicate task id "home_001"/);
  });

  it("findTaskBoard throws instead of resolving an ambiguous id", async () => {
    await initStorage(root);
    const board = (await readBoard(root, "b_home_main"))!;
    await writeBoardRaw({ ...board, tasks: [task("home_001", "old", "done"), task("home_001", "new")] });

    await expect(findTaskBoard(root, "home_001")).rejects.toThrow(/matches 2 tasks/);
    await expect(showTask(root, "home_001")).rejects.toThrow(/matches 2 tasks/);
    // Unaffected ids still resolve.
    expect(await findTaskBoard(root, "home_999")).toBeNull();
  });

  it("move-batch refuses duplicate ids instead of resolving the wrong task", async () => {
    await initStorage(root);
    const board = (await readBoard(root, "b_home_main"))!;
    // The confirmed field failure: move-batch on a duplicated id resolved the
    // already-done copy and reported from:"done" to:"done" with ok:true.
    await writeBoardRaw({ ...board, tasks: [task("home_001", "old", "done"), task("home_001", "new")] });

    await expect(moveTasksBatch(root, [{ id: "home_001", column: "done" }])).rejects.toThrow(
      /duplicate task id "home_001"/,
    );
  });
});

describe("initStorage on partial storage", () => {
  it("does not clobber surviving boards when meta.yaml was lost", async () => {
    await initStorage(root);
    const board = (await readBoard(root, "b_home_main"))!;
    await writeBoard(root, { ...board, tasks: [task("home_001", "survivor")] });

    await fs.rm(paths(root).meta);
    await initStorage(root);

    const after = await readBoard(root, "b_home_main");
    expect(after?.tasks.map((t) => t.title)).toEqual(["survivor"]);
  });
});
