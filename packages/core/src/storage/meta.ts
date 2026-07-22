import YAML from "yaml";
import { MetaSchema, SCHEMA_VERSION, type Area, type Board, type Meta } from "../types.js";
import { areaPrefix, readAreas } from "./areas.js";
import { atomicWrite, readTextOrNull } from "./atomic.js";
import { readAllBoards } from "./boards.js";
import { paths } from "./paths.js";

/** Task-id prefix for an area, from areas.yaml; unknown areas fall back to their id. */
async function prefixFor(root: string, area: Area): Promise<string> {
  const cfg = (await readAreas(root)).find((a) => a.id === area);
  return cfg ? areaPrefix(cfg) : area.replace(/-/g, "");
}

export async function readMeta(root: string): Promise<Meta> {
  const text = await readTextOrNull(paths(root).meta);
  if (text === null || text.trim() === "") {
    return MetaSchema.parse({ schemaVersion: SCHEMA_VERSION, nextTaskId: 1, nextBoardId: 1, nextRuleId: 1 });
  }
  return MetaSchema.parse(YAML.parse(text));
}

export async function writeMeta(root: string, meta: Meta): Promise<void> {
  await atomicWrite(paths(root).meta, YAML.stringify(MetaSchema.parse(meta)));
}

export async function updateMeta(root: string, fn: (m: Meta) => Meta): Promise<Meta> {
  const m = await readMeta(root);
  const next = fn({ ...m });
  await writeMeta(root, next);
  return next;
}

export async function nextTaskId(root: string, area: Area): Promise<string> {
  const prefix = await prefixFor(root, area);
  const [num] = await bumpTaskCounter(root, area, prefix, 1);
  return `${prefix}_${num}`;
}

export async function nextTaskIds(root: string, area: Area, n: number): Promise<string[]> {
  if (!Number.isInteger(n) || n <= 0) throw new Error(`nextTaskIds: n must be positive integer (got ${n})`);
  const prefix = await prefixFor(root, area);
  const nums = await bumpTaskCounter(root, area, prefix, n);
  return nums.map((num) => `${prefix}_${num}`);
}

/** Highest numeric suffix among `${prefix}_<n>` task ids across the given boards (0 if none). */
function maxTaskNumber(boards: Board[], prefix: string): number {
  const re = new RegExp(`^${prefix}_(\\d+)$`);
  let max = 0;
  for (const b of boards) {
    for (const t of b.tasks) {
      const m = re.exec(t.id);
      if (m?.[1]) max = Math.max(max, parseInt(m[1], 10));
    }
  }
  return max;
}

/**
 * Reserves `n` consecutive task numbers for `area`, returning them zero-padded.
 * The counter is only trusted as a lower bound: allocation never mints a number
 * at or below the highest `${prefix}_<n>` already on a board, so a counter that
 * lags the data (stale migration, restored backup, lost meta.yaml) produces a
 * gap instead of a duplicate id.
 */
async function bumpTaskCounter(root: string, area: Area, prefix: string, n: number): Promise<string[]> {
  const floor = maxTaskNumber(await readAllBoards(root), prefix) + 1;
  let start = 1;
  await updateMeta(root, (m) => {
    start = Math.max(m.taskCounters[area] ?? 1, floor);
    return { ...m, taskCounters: { ...m.taskCounters, [area]: start + n } };
  });
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(String(start + i).padStart(3, "0"));
  return out;
}

/**
 * Raises each area's task counter to (highest existing task number + 1) where it
 * lags the boards. Idempotent, never lowers a counter. Covers areas present in
 * areas.yaml and any extra areas found on boards (same prefix fallback as
 * prefixFor).
 */
export async function reconcileTaskCounters(root: string): Promise<void> {
  const [areas, boards] = await Promise.all([readAreas(root), readAllBoards(root)]);
  const prefixes = new Map(areas.map((a) => [a.id, areaPrefix(a)]));
  for (const b of boards) {
    if (!prefixes.has(b.area)) prefixes.set(b.area, b.area.replace(/-/g, ""));
  }

  const floors: Record<string, number> = {};
  for (const [area, prefix] of prefixes) {
    const max = maxTaskNumber(boards, prefix);
    if (max > 0) floors[area] = max + 1;
  }
  if (Object.keys(floors).length === 0) return;

  await updateMeta(root, (m) => {
    const taskCounters = { ...m.taskCounters };
    for (const [area, floor] of Object.entries(floors)) {
      taskCounters[area] = Math.max(taskCounters[area] ?? 1, floor);
    }
    return { ...m, taskCounters };
  });
}

export async function nextBoardId(root: string, area: string, name: string): Promise<string> {
  const m = await updateMeta(root, (m) => ({ ...m, nextBoardId: m.nextBoardId + 1 }));
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "board";
  return `b_${area}_${slug}_${m.nextBoardId - 1}`;
}

export async function nextRuleId(root: string): Promise<string> {
  const m = await updateMeta(root, (m) => ({ ...m, nextRuleId: m.nextRuleId + 1 }));
  return `r_${String(m.nextRuleId - 1).padStart(3, "0")}`;
}

export async function nextRuleIds(root: string, n: number): Promise<string[]> {
  if (!Number.isInteger(n) || n <= 0) throw new Error(`nextRuleIds: n must be positive integer (got ${n})`);
  const m = await updateMeta(root, (m) => ({ ...m, nextRuleId: m.nextRuleId + n }));
  const end = m.nextRuleId;
  const start = end - n;
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    ids.push(`r_${String(start + i).padStart(3, "0")}`);
  }
  return ids;
}

export async function nextTrackingId(root: string): Promise<string> {
  const m = await updateMeta(root, (m) => ({ ...m, nextTrackingId: m.nextTrackingId + 1 }));
  return `trk_${String(m.nextTrackingId - 1).padStart(3, "0")}`;
}
