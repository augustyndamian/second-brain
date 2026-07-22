import { promises as fs } from "node:fs";
import YAML from "yaml";
import { SCHEMA_VERSION } from "../types.js";
import { DEFAULT_AREAS, areasFileExists, writeAreas, type AreaConfig } from "./areas.js";
import { atomicWrite } from "./atomic.js";
import { readAllBoards } from "./boards.js";
import { readMeta, reconcileTaskCounters, writeMeta } from "./meta.js";
import { paths } from "./paths.js";

export type Migration = (root: string) => Promise<void>;

/** Title-cases an area id for a human-readable label: `side-projects` → `Side Projects`. */
function labelFromId(id: string): string {
  return id
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/**
 * Folds legacy fixed `nextTaskId<Area>` fields into the `taskCounters` map and
 * drops them from meta.yaml. Reads raw YAML on purpose: readMeta() parses through
 * MetaSchema, which strips the very legacy fields this needs to carry over.
 * On key overlap the larger value wins — never lower a counter.
 */
async function foldLegacyTaskCounters(root: string): Promise<void> {
  const raw = await fs.readFile(paths(root).meta, "utf8").catch(() => null);
  const legacy = (raw ? YAML.parse(raw) : null) ?? {};

  const taskCounters: Record<string, number> = { ...(legacy.taskCounters ?? {}) };
  for (const [key, value] of Object.entries(legacy)) {
    const m = /^nextTaskId([A-Z][A-Za-z]*)$/.exec(key);
    if (!m?.[1] || typeof value !== "number") continue;
    const area = m[1].toLowerCase();
    taskCounters[area] = Math.max(taskCounters[area] ?? 0, value);
  }

  const next = { ...legacy, taskCounters };
  for (const key of Object.keys(legacy)) {
    if (/^nextTaskId([A-Z][A-Za-z]*)$/.test(key)) delete next[key];
  }
  await atomicWrite(paths(root).meta, YAML.stringify(next));
}

const migrations: Record<number, Migration> = {
  // v1 -> v2: introduce Task.plannedDate (defaults to null via Zod schema).
  // No data rewrite needed — readBoard() applies Zod defaults on read,
  // and the next writeBoard() persists plannedDate=null on every existing task.
  1: async (_root) => {
    // no-op: the schema default covers it
  },

  // v2 -> v3: fixed per-area counters (nextTaskId<Area>) become the generic
  // `taskCounters` map, and areas move out of the code into areas.yaml.
  2: async (root) => {
    await foldLegacyTaskCounters(root);

    // Derive areas.yaml from existing boards so pre-v3 storage keeps working.
    if (!(await areasFileExists(root))) {
      const ids = [...new Set((await readAllBoards(root)).map((b) => b.area))].sort();
      const areas: AreaConfig[] = ids.map((id) => ({
        id,
        label: labelFromId(id),
        emoji: "📁",
        color: "#64748b",
      }));
      await writeAreas(root, areas.length > 0 ? areas : DEFAULT_AREAS);
    }
  },

  // v3 -> v4: seed task counters from the boards. Counters were never
  // reconciled against existing data, so an install whose counters lag its
  // boards (stale v2 counters carried through 2->3, a meta stamped v3 that
  // still holds nextTaskId<Area> fields, a meta.yaml restored without its
  // boards' history) mints duplicate task ids — which the id-keyed update
  // paths then silently destroy. Fold any stray legacy fields first (they
  // would otherwise be stripped by MetaSchema), then raise each counter to
  // max existing id + 1.
  3: async (root) => {
    await foldLegacyTaskCounters(root);
    await reconcileTaskCounters(root);
  },
};

export async function runMigrations(root: string): Promise<void> {
  const startVersion = (await readMeta(root)).schemaVersion;
  let v = startVersion;
  while (v < SCHEMA_VERSION) {
    const m = migrations[v];
    if (!m) throw new Error(`no migration registered from schemaVersion ${v}`);
    await m(root);
    v++;
  }
  if (startVersion !== v) {
    // Re-read: migrations rewrite meta.yaml, so the pre-loop copy is stale.
    const fresh = await readMeta(root);
    await writeMeta(root, { ...fresh, schemaVersion: v });
  }
}
