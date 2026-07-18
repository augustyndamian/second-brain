import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

/** Thrown when no workspace can be resolved — callers surface the message verbatim. */
export class WorkspaceNotFoundError extends Error {
  constructor() {
    super(
      "No workspace found.\n" +
        "  - run `kb workspace init` inside your Second Brain workspace, or\n" +
        "  - set KB_KANBAN_ROOT to a storage directory.",
    );
    this.name = "WorkspaceNotFoundError";
  }
}

/** Storage subdirectory: KB_DEV=1 isolates a dev sandbox from real data. */
export function storageDirName(): string {
  return process.env.KB_DEV === "1" ? ".kanban-dev" : ".kanban";
}

/** Pointer file written by `kb workspace init` — a single line holding the workspace path. */
export function workspacePointerFile(): string {
  return join(homedir(), ".config", "kb", "workspace");
}

/** Walks up from `startDir` looking for a storage directory, the way git finds `.git`. */
function findStorageUpwards(startDir: string, subdir: string): string | null {
  let dir = resolve(startDir);
  for (;;) {
    const candidate = join(dir, subdir);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function readPointer(): string | null {
  try {
    const raw = readFileSync(workspacePointerFile(), "utf8").trim();
    return raw === "" ? null : raw;
  } catch {
    return null;
  }
}

/**
 * Resolves the storage root, in precedence order:
 *   1. KB_KANBAN_ROOT (explicit override — used verbatim)
 *   2. walk-up from cwd for `.kanban/` (clone = workspace)
 *   3. `~/.config/kb/workspace` pointer (written by `kb workspace init`)
 *   4. throw WorkspaceNotFoundError
 */
export function defaultRoot(): string {
  if (process.env.KB_KANBAN_ROOT) return process.env.KB_KANBAN_ROOT;

  const subdir = storageDirName();

  const found = findStorageUpwards(process.cwd(), subdir);
  if (found) return found;

  const pointer = readPointer();
  if (pointer) return join(pointer, subdir);

  throw new WorkspaceNotFoundError();
}

/** Where the resolved root came from — surfaced by `kb workspace status`. */
export type RootSource = "env" | "walk-up" | "pointer" | "none";

export function resolveRootInfo(): { root: string | null; source: RootSource } {
  if (process.env.KB_KANBAN_ROOT) return { root: process.env.KB_KANBAN_ROOT, source: "env" };
  const subdir = storageDirName();
  const found = findStorageUpwards(process.cwd(), subdir);
  if (found) return { root: found, source: "walk-up" };
  const pointer = readPointer();
  if (pointer) return { root: join(pointer, subdir), source: "pointer" };
  return { root: null, source: "none" };
}

export interface StoragePaths {
  root: string;
  meta: string;
  areas: string;
  boards: string;
  recurring: string;
  events: string;
  tracking: string;
  dailyNotes: string;
  dailyNotesArchive: string;
}

export function paths(root: string = defaultRoot()): StoragePaths {
  return {
    root,
    meta: join(root, "meta.yaml"),
    areas: join(root, "areas.yaml"),
    boards: join(root, "boards"),
    recurring: join(root, "recurring.yaml"),
    events: join(root, "events.jsonl"),
    tracking: join(root, "tracking.yaml"),
    dailyNotes: join(root, "daily-notes"),
    dailyNotesArchive: join(root, "daily-notes", "archive"),
  };
}

export function boardFile(root: string, boardId: string): string {
  return join(paths(root).boards, `${boardId}.yaml`);
}

export function dailyNoteFile(root: string, date: string): string {
  return join(paths(root).dailyNotes, `${date}.md`);
}

export function dailyNoteArchiveFile(root: string, date: string): string {
  return join(paths(root).dailyNotesArchive, `${date}.md`);
}
