import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import YAML from "yaml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_AREAS, readAreas, writeAreas } from "../storage/areas.js";
import { readAllBoards } from "../storage/boards.js";
import { initStorage } from "../storage/init.js";
import { readMeta, nextTaskId } from "../storage/meta.js";
import { runMigrations } from "../storage/migrate.js";
import { paths } from "../storage/paths.js";
import { createArea, editArea, listAreas, removeArea, assertValidArea } from "./areas.js";
import { createTask } from "./tasks.js";

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), "kb-areas-"));
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("areas storage", () => {
  it("returns defaults when areas.yaml is missing, without writing it", async () => {
    expect(await readAreas(root)).toEqual(DEFAULT_AREAS);
    await expect(fs.access(paths(root).areas)).rejects.toThrow();
  });

  it("bootstraps the starter area on init", async () => {
    await initStorage(root);
    const areas = await listAreas(root);
    expect(areas.map((a) => a.id)).toEqual(["personal"]);
    const boards = await readAllBoards(root);
    expect(boards.map((b) => b.id)).toEqual(["b_personal_main"]);
  });
});

describe("area CRUD", () => {
  beforeEach(async () => {
    await initStorage(root);
  });

  it("createArea adds the area and its default board", async () => {
    await createArea(root, { id: "work", label: "Work", emoji: "💼", color: "#3b82f6" });
    expect((await listAreas(root)).map((a) => a.id)).toEqual(["personal", "work"]);
    const board = (await readAllBoards(root)).find((b) => b.id === "b_work_main");
    expect(board).toMatchObject({ area: "work", name: "Work — Main", isDefault: true });
  });

  it("rejects duplicate ids and malformed ids", async () => {
    await createArea(root, { id: "work", label: "Work" });
    await expect(createArea(root, { id: "work", label: "Dup" })).rejects.toThrow(/already exists/);
    await expect(createArea(root, { id: "Work", label: "Bad" })).rejects.toThrow();
    await expect(createArea(root, { id: "9lives", label: "Bad" })).rejects.toThrow();
  });

  it("editArea updates presentation but keeps the id", async () => {
    await createArea(root, { id: "work", label: "Work" });
    const next = await editArea(root, "work", { label: "Day Job", emoji: "🏢" });
    expect(next).toMatchObject({ id: "work", label: "Day Job", emoji: "🏢" });
  });

  it("removeArea refuses while tasks still reference the area", async () => {
    await createArea(root, { id: "work", label: "Work" });
    await createTask(root, { area: "work", title: "t" });
    await expect(removeArea(root, "work")).rejects.toThrow(/still referenced by/);
  });

  it("removeArea drops an empty area together with its board", async () => {
    await createArea(root, { id: "work", label: "Work" });
    await removeArea(root, "work");
    expect((await listAreas(root)).map((a) => a.id)).toEqual(["personal"]);
    expect((await readAllBoards(root)).some((b) => b.area === "work")).toBe(false);
  });

  it("assertValidArea names the configured areas in its error", async () => {
    await expect(assertValidArea(root, "nope")).rejects.toThrow(/configured areas: personal/);
  });
});

describe("task ids", () => {
  it("derive their prefix from the area config", async () => {
    await writeAreas(root, [
      { id: "side-projects", label: "Side Projects", emoji: "🚀", color: "#10b981" },
      { id: "work", label: "Work", emoji: "💼", color: "#3b82f6", prefix: "wk" },
    ]);
    await initStorage(root);
    expect(await nextTaskId(root, "side-projects")).toBe("sideprojects_001");
    expect(await nextTaskId(root, "work")).toBe("wk_001");
    expect(await nextTaskId(root, "work")).toBe("wk_002");
  });
});

describe("v2 -> v3 migration", () => {
  it("carries legacy per-area counters into taskCounters and derives areas from boards", async () => {
    await initStorage(root);

    // Rewrite storage to look like a v2 install: fixed counter fields, no areas.yaml.
    await fs.writeFile(
      paths(root).meta,
      YAML.stringify({
        schemaVersion: 2,
        nextTaskId: 1,
        nextBoardId: 3,
        nextRuleId: 4,
        nextTaskIdAlpha: 7,
        nextTaskIdSideQuests: 2,
        nextTrackingId: 5,
      }),
      "utf8",
    );
    await fs.rm(paths(root).areas);

    await runMigrations(root);

    const meta = await readMeta(root);
    expect(meta.schemaVersion).toBe(3);
    expect(meta.taskCounters).toEqual({ alpha: 7, sidequests: 2 });
    expect(meta.nextRuleId).toBe(4);
    expect(meta.nextTrackingId).toBe(5);
    expect((meta as Record<string, unknown>).nextTaskIdAlpha).toBeUndefined();

    // areas.yaml is reconstructed from the boards that exist.
    expect((await listAreas(root)).map((a) => a.id)).toEqual(["personal"]);
  });

  it("is a no-op on storage already at the current version", async () => {
    await initStorage(root);
    const before = await readMeta(root);
    await runMigrations(root);
    expect(await readMeta(root)).toEqual(before);
  });
});
