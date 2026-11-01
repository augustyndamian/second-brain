import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initStorage } from "../storage/init.js";
import { writeAreas } from "../storage/areas.js";
import { readActive, writeActive } from "../storage/active-session.js";
import { localToday } from "../schedule/dates.js";
import { createTask, editTask, editTasksBatch, rescheduleTask, rescheduleTasksBatch } from "./tasks.js";
import { ensureSession } from "./session.js";
import { today } from "../queries/today.js";

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), "kb-anchor-"));
  await writeAreas(root, [{ id: "work", label: "Work", emoji: "💼", color: "#3b82f6" }]);
  await initStorage(root);
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

function tomorrow(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

async function anchoredIds(): Promise<string[]> {
  const active = await readActive(root);
  return active?.anchoredTaskIds ?? [];
}

// Regression: /today-eod 2026-07-16 — no-op reschedule (today→today) de-anchored
// tasks, making them invisible in today() (neither tasks[] nor overdue[]).

describe("rescheduleTask anchor bookkeeping", () => {
  it("reschedule to today keeps task anchored (no-op date)", async () => {
    const date = localToday();
    const { task } = await createTask(root, { area: "work", title: "t", plannedDate: date });
    await ensureSession(root);
    expect(await anchoredIds()).toContain(task.id);

    await rescheduleTask(root, task.id, date, "no-op");
    expect(await anchoredIds()).toContain(task.id);

    const view = await today(root);
    expect(view.tasks.map((t) => t.id)).toContain(task.id);
  });

  it("reschedule to today anchors a previously un-anchored task", async () => {
    await ensureSession(root);
    const date = localToday();
    const { task } = await createTask(root, { area: "work", title: "t", plannedDate: tomorrow() });
    await rescheduleTask(root, task.id, date);
    expect(await anchoredIds()).toContain(task.id);
  });

  it("reschedule to future de-anchors", async () => {
    const date = localToday();
    const { task } = await createTask(root, { area: "work", title: "t", plannedDate: date });
    await ensureSession(root);
    await rescheduleTask(root, task.id, tomorrow());
    expect(await anchoredIds()).not.toContain(task.id);
  });
});

describe("rescheduleTasksBatch anchor bookkeeping", () => {
  it("mixed batch: today-targets stay anchored, future-targets de-anchor", async () => {
    const date = localToday();
    const a = await createTask(root, { area: "work", title: "a", plannedDate: date });
    const b = await createTask(root, { area: "work", title: "b", plannedDate: date });
    await ensureSession(root);

    await rescheduleTasksBatch(root, [
      { id: a.task.id, to: date }, // no-op → must stay visible
      { id: b.task.id, to: tomorrow() },
    ]);

    const ids = await anchoredIds();
    expect(ids).toContain(a.task.id);
    expect(ids).not.toContain(b.task.id);

    const view = await today(root);
    expect(view.tasks.map((t) => t.id)).toContain(a.task.id);
    expect(view.tasks.map((t) => t.id)).not.toContain(b.task.id);
  });
});

// Regression: `kb task edit <id> --planned null` cleared the date but left the
// task in anchoredTaskIds, so it stayed visible in today() forever (self-heal
// only ADDS anchors, it never removes them).

describe("editTask anchor bookkeeping", () => {
  it("clearing plannedDate on an anchored todo task de-anchors and removes it from today()", async () => {
    const date = localToday();
    const { task } = await createTask(root, { area: "work", title: "t", plannedDate: date });
    await ensureSession(root);
    expect(await anchoredIds()).toContain(task.id);

    await editTask(root, task.id, { plannedDate: null });
    expect(await anchoredIds()).not.toContain(task.id);

    const view = await today(root);
    expect(view.tasks.map((t) => t.id)).not.toContain(task.id);
    expect(view.overdue.map((t) => t.id)).not.toContain(task.id);
  });

  it("clearing plannedDate on a doing task keeps the anchor (parity with self-heal)", async () => {
    await ensureSession(root);
    const date = localToday();
    const { task } = await createTask(root, {
      area: "work",
      title: "t",
      plannedDate: date,
      column: "doing",
    });
    expect(await anchoredIds()).toContain(task.id);

    await editTask(root, task.id, { plannedDate: null });
    expect(await anchoredIds()).toContain(task.id);

    const view = await today(root);
    expect(view.tasks.map((t) => t.id)).toContain(task.id);
  });

  it("edit plannedDate to the session date anchors a previously un-anchored task", async () => {
    await ensureSession(root);
    const date = localToday();
    const { task } = await createTask(root, { area: "work", title: "t", plannedDate: tomorrow() });
    expect(await anchoredIds()).not.toContain(task.id);

    await editTask(root, task.id, { plannedDate: date });
    expect(await anchoredIds()).toContain(task.id);

    const view = await today(root);
    expect(view.tasks.map((t) => t.id)).toContain(task.id);
  });

  it("edit plannedDate to tomorrow de-anchors", async () => {
    const date = localToday();
    const { task } = await createTask(root, { area: "work", title: "t", plannedDate: date });
    await ensureSession(root);
    expect(await anchoredIds()).toContain(task.id);

    await editTask(root, task.id, { plannedDate: tomorrow() });
    expect(await anchoredIds()).not.toContain(task.id);

    const view = await today(root);
    expect(view.tasks.map((t) => t.id)).not.toContain(task.id);
  });
});

describe("editTasksBatch anchor bookkeeping", () => {
  it("mixed batch: null-on-todo de-anchors, null-on-doing keeps, session-date anchors", async () => {
    const date = localToday();
    const a = await createTask(root, { area: "work", title: "a", plannedDate: date });
    await ensureSession(root);
    const b = await createTask(root, {
      area: "work",
      title: "b",
      plannedDate: date,
      column: "doing",
    });
    const c = await createTask(root, { area: "work", title: "c", plannedDate: tomorrow() });

    let ids = await anchoredIds();
    expect(ids).toContain(a.task.id);
    expect(ids).toContain(b.task.id);
    expect(ids).not.toContain(c.task.id);

    await editTasksBatch(root, [
      { id: a.task.id, plannedDate: null },
      { id: b.task.id, plannedDate: null },
      { id: c.task.id, plannedDate: date },
    ]);

    ids = await anchoredIds();
    expect(ids).not.toContain(a.task.id);
    expect(ids).toContain(b.task.id);
    expect(ids).toContain(c.task.id);

    const view = await today(root);
    const viewIds = view.tasks.map((t) => t.id);
    expect(viewIds).not.toContain(a.task.id);
    expect(viewIds).toContain(b.task.id);
    expect(viewIds).toContain(c.task.id);
  });
});

describe("today() self-heals anchor drift", () => {
  it("re-anchors a planned-today task missing from anchor set", async () => {
    const date = localToday();
    const { task } = await createTask(root, {
      area: "work",
      title: "t",
      plannedDate: date,
      dueDate: "2020-01-01", // long overdue
    });
    await ensureSession(root);

    // Simulate historical drift: force-remove from anchors.
    const active = (await readActive(root))!;
    await writeActive(root, {
      ...active,
      anchoredTaskIds: active.anchoredTaskIds.filter((id) => id !== task.id),
    });

    const view = await today(root);
    expect(view.overdue.map((t) => t.id)).toContain(task.id);
    expect(await anchoredIds()).toContain(task.id); // persisted, not just in-memory
  });
});
