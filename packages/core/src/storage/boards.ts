import { promises as fs } from "node:fs";
import YAML from "yaml";
import { BoardSchema, type Area, type Board } from "../types.js";
import { atomicWrite, readTextOrNull } from "./atomic.js";
import { boardFile, paths } from "./paths.js";

export async function listBoardFiles(root: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(paths(root).boards);
    return entries.filter((e) => e.endsWith(".yaml"));
  } catch (err: any) {
    if (err?.code === "ENOENT") return [];
    throw err;
  }
}

export async function readBoard(root: string, boardId: string): Promise<Board | null> {
  const text = await readTextOrNull(boardFile(root, boardId));
  if (!text) return null;
  return BoardSchema.parse(YAML.parse(text));
}

export async function readAllBoards(root: string): Promise<Board[]> {
  const files = await listBoardFiles(root);
  const out: Board[] = [];
  for (const f of files) {
    const id = f.replace(/\.yaml$/, "");
    const b = await readBoard(root, id);
    if (b) out.push(b);
  }
  return out;
}

/**
 * Duplicate task ids are how data gets destroyed: every id-keyed update
 * overwrites all copies with the same record. Refuse to persist that state.
 */
function assertUniqueTaskIds(board: Board): void {
  const seen = new Set<string>();
  for (const t of board.tasks) {
    if (seen.has(t.id)) {
      throw new Error(
        `duplicate task id "${t.id}" on board ${board.id} — refusing to save; ` +
          `repair the board YAML (original task snapshots are in events.jsonl)`,
      );
    }
    seen.add(t.id);
  }
}

export async function writeBoard(root: string, board: Board): Promise<void> {
  const validated = BoardSchema.parse(board);
  assertUniqueTaskIds(validated);
  await atomicWrite(boardFile(root, validated.id), YAML.stringify(validated));
}

export async function updateBoard(
  root: string,
  boardId: string,
  fn: (b: Board) => Board,
): Promise<Board> {
  const cur = await readBoard(root, boardId);
  if (!cur) throw new Error(`board not found: ${boardId}`);
  const next = fn(cur);
  await writeBoard(root, next);
  return next;
}

export async function findDefaultBoard(root: string, area: Area): Promise<Board | null> {
  const all = await readAllBoards(root);
  const inArea = all.filter((b) => b.area === area);
  return inArea.find((b) => b.isDefault) ?? inArea[0] ?? null;
}

/**
 * Resolves the board holding `taskId`. Throws when the id matches more than one
 * task (within a board or across boards): resolving ambiguously would read or
 * mutate the wrong record, so corruption must surface instead of being guessed
 * around. Every single-task operation (show/edit/move/reschedule/delete) goes
 * through here, which makes this the choke point for duplicate detection.
 */
export async function findTaskBoard(root: string, taskId: string): Promise<Board | null> {
  const all = await readAllBoards(root);
  let found: Board | null = null;
  let matches = 0;
  const boardsWithId: string[] = [];
  for (const b of all) {
    const inBoard = b.tasks.filter((t) => t.id === taskId).length;
    if (inBoard === 0) continue;
    matches += inBoard;
    boardsWithId.push(b.id);
    found ??= b;
  }
  if (matches > 1) {
    throw new Error(
      `task id "${taskId}" matches ${matches} tasks (boards: ${boardsWithId.join(", ")}) — ` +
        `duplicate ids in board YAML; repair before continuing (original task snapshots are in events.jsonl)`,
    );
  }
  return found;
}
