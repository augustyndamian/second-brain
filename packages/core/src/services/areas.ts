import { promises as fs } from "node:fs";
import { AreaConfigSchema, readAreas, writeAreas, type AreaConfig } from "../storage/areas.js";
import { readAllBoards, writeBoard } from "../storage/boards.js";
import { appendEvent, nowIso } from "../storage/events.js";
import { boardFile } from "../storage/paths.js";
import { readRecurring } from "../storage/recurring.js";
import { readTracking } from "../storage/tracking.js";
import type { Area, Board } from "../types.js";

export interface CreateAreaInput {
  id: string;
  label: string;
  emoji?: string;
  color?: string;
  prefix?: string;
}

export type EditAreaInput = Partial<Omit<CreateAreaInput, "id">>;

export async function listAreas(root: string): Promise<AreaConfig[]> {
  return readAreas(root);
}

export async function findArea(root: string, id: string): Promise<AreaConfig | null> {
  return (await readAreas(root)).find((a) => a.id === id) ?? null;
}

/**
 * Rejects mutations targeting an unconfigured area. Reads stay permissive so that
 * data written before an area was removed remains readable.
 */
export async function assertValidArea(root: string, area: Area): Promise<void> {
  const areas = await readAreas(root);
  if (areas.some((a) => a.id === area)) return;
  const known = areas.map((a) => a.id).join(", ");
  throw new Error(
    `unknown area: ${area}\n  configured areas: ${known}\n  add one with: kb area add --id ${area} --label "<Label>"`,
  );
}

/** Creates the area and its default board (`b_{id}_main`). */
export async function createArea(root: string, input: CreateAreaInput): Promise<AreaConfig> {
  const cfg = AreaConfigSchema.parse(input);
  const areas = await readAreas(root);
  if (areas.some((a) => a.id === cfg.id)) throw new Error(`area already exists: ${cfg.id}`);

  await writeAreas(root, [...areas, cfg]);

  const boardId = `b_${cfg.id}_main`;
  const existing = await readAllBoards(root);
  if (!existing.some((b) => b.id === boardId)) {
    const ts = nowIso();
    const board: Board = {
      id: boardId,
      area: cfg.id,
      name: `${cfg.label} — Main`,
      isDefault: true,
      createdAt: ts,
      tasks: [],
    };
    await writeBoard(root, board);
    await appendEvent(root, { ts, type: "board.created", boardId, snapshot: board });
  }
  return cfg;
}

/** Updates label/emoji/color/prefix. The id is immutable — it is baked into board and task ids. */
export async function editArea(root: string, id: string, patch: EditAreaInput): Promise<AreaConfig> {
  const areas = await readAreas(root);
  const idx = areas.findIndex((a) => a.id === id);
  if (idx === -1) throw new Error(`unknown area: ${id}`);
  const next = AreaConfigSchema.parse({ ...areas[idx], ...patch, id });
  const updated = [...areas];
  updated[idx] = next;
  await writeAreas(root, updated);
  return next;
}

export interface AreaUsage {
  tasks: number;
  boards: number;
  recurring: number;
  tracking: number;
}

export async function areaUsage(root: string, id: string): Promise<AreaUsage> {
  const [boards, recurring, tracking] = await Promise.all([
    readAllBoards(root),
    readRecurring(root),
    readTracking(root),
  ]);
  const inArea = boards.filter((b) => b.area === id);
  return {
    boards: inArea.length,
    tasks: inArea.reduce((n, b) => n + b.tasks.length, 0),
    recurring: recurring.rules.filter((r) => r.area === id).length,
    tracking: tracking.items.filter((t) => t.area === id).length,
  };
}

/** Removes an area. Refuses while any data still references it — nothing is orphaned silently. */
export async function removeArea(root: string, id: string): Promise<void> {
  const areas = await readAreas(root);
  if (!areas.some((a) => a.id === id)) throw new Error(`unknown area: ${id}`);

  const usage = await areaUsage(root, id);
  if (usage.tasks > 0 || usage.recurring > 0 || usage.tracking > 0) {
    throw new Error(
      `cannot remove area "${id}": still referenced by ` +
        `${usage.tasks} task(s), ${usage.recurring} recurring rule(s), ${usage.tracking} tracked item(s).\n` +
        `  move or delete them first.`,
    );
  }
  // Boards of a task-free area are empty by definition — drop them so no orphans linger.
  const boards = await readAllBoards(root);
  for (const b of boards.filter((b) => b.area === id)) {
    await fs.rm(boardFile(root, b.id), { force: true });
  }
  await writeAreas(root, areas.filter((a) => a.id !== id));
}
