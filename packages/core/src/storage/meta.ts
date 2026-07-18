import YAML from "yaml";
import { MetaSchema, SCHEMA_VERSION, type Area, type Meta } from "../types.js";
import { areaPrefix, readAreas } from "./areas.js";
import { atomicWrite, readTextOrNull } from "./atomic.js";
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
  const [prefix, ids] = await Promise.all([prefixFor(root, area), bumpTaskCounter(root, area, 1)]);
  return `${prefix}_${ids[0]}`;
}

export async function nextTaskIds(root: string, area: Area, n: number): Promise<string[]> {
  if (!Number.isInteger(n) || n <= 0) throw new Error(`nextTaskIds: n must be positive integer (got ${n})`);
  const [prefix, nums] = await Promise.all([prefixFor(root, area), bumpTaskCounter(root, area, n)]);
  return nums.map((num) => `${prefix}_${num}`);
}

/** Reserves `n` consecutive task numbers for `area`, returning them zero-padded. */
async function bumpTaskCounter(root: string, area: Area, n: number): Promise<string[]> {
  const m = await updateMeta(root, (m) => ({
    ...m,
    taskCounters: { ...m.taskCounters, [area]: (m.taskCounters[area] ?? 1) + n },
  }));
  const end = m.taskCounters[area] as number;
  const start = end - n;
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(String(start + i).padStart(3, "0"));
  return out;
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
