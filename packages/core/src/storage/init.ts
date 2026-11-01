import { promises as fs } from "node:fs";
import path from "node:path";
import { MetaSchema, SCHEMA_VERSION, type Board } from "../types.js";
import { DEFAULT_AREAS, areasFileExists, readAreas, writeAreas } from "./areas.js";
import { writeBoard } from "./boards.js";
import { appendEvent, nowIso } from "./events.js";
import { writeMeta } from "./meta.js";
import { paths } from "./paths.js";
import { writeRecurring } from "./recurring.js";
import { runMigrations } from "./migrate.js";

export interface InitOpts {
  /** if true, do not overwrite an existing initialized storage */
  skipIfExists?: boolean;
}

export async function isInitialized(root: string): Promise<boolean> {
  try {
    await fs.access(paths(root).meta);
    return true;
  } catch {
    return false;
  }
}

/**
 * Single entry point used by CLI/GUI before any read/write:
 *   - bootstraps storage if missing
 *   - runs schema migrations (idempotent, fast no-op when up-to-date)
 */
export async function ensureStorageReady(root: string): Promise<void> {
  if (!(await isInitialized(root))) {
    await initStorage(root);
    return; // initStorage writes SCHEMA_VERSION, no migration needed
  }
  await runMigrations(root);
  // Ensure post-v1 dirs exist on legacy installs.
  const p = paths(root);
  await fs.mkdir(p.dailyNotes, { recursive: true });
  await fs.mkdir(p.dailyNotesArchive, { recursive: true });
  // Ensure default board exists for every area (handles areas added after initial storage creation).
  const ts = nowIso();
  for (const area of await readAreas(root)) {
    const boardId = `b_${area.id}_main`;
    try {
      await fs.access(path.join(p.boards, `${boardId}.yaml`));
    } catch {
      const board: Board = {
        id: boardId,
        area: area.id,
        name: `${area.label} — Main`,
        isDefault: true,
        createdAt: ts,
        tasks: [],
      };
      await writeBoard(root, board);
      await appendEvent(root, { ts, type: "board.created", boardId, snapshot: board });
    }
  }
}

export async function initStorage(root: string, opts: InitOpts = {}): Promise<void> {
  const p = paths(root);
  await fs.mkdir(p.root, { recursive: true });
  await fs.mkdir(p.boards, { recursive: true });
  await fs.mkdir(p.dailyNotes, { recursive: true });
  await fs.mkdir(p.dailyNotesArchive, { recursive: true });

  if (opts.skipIfExists && (await isInitialized(root))) return;

  // Respect a pre-seeded areas.yaml (e.g. written by an installer or a test fixture).
  if (!(await areasFileExists(root))) await writeAreas(root, DEFAULT_AREAS);
  const areas = await readAreas(root);
  const ts = nowIso();

  await writeMeta(root, MetaSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    nextTaskId: 1,
    nextBoardId: areas.length + 1,
    nextRuleId: 1,
  }));

  await writeRecurring(root, { schemaVersion: SCHEMA_VERSION, rules: [] });

  for (const area of areas) {
    const id = `b_${area.id}_main`;
    // Never clobber a board file that already exists: isInitialized() only
    // checks meta.yaml, so a lost meta with surviving boards would otherwise
    // get its boards overwritten with empty ones here.
    try {
      await fs.access(path.join(p.boards, `${id}.yaml`));
      continue;
    } catch {
      // board missing — create it below
    }
    const board: Board = {
      id,
      area: area.id,
      name: `${area.label} — Main`,
      isDefault: true,
      createdAt: ts,
      tasks: [],
    };
    await writeBoard(root, board);
    await appendEvent(root, { ts, type: "board.created", boardId: id, snapshot: board });
  }
}
