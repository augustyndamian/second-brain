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

export async function writeBoard(root: string, board: Board): Promise<void> {
  const validated = BoardSchema.parse(board);
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

export async function findTaskBoard(root: string, taskId: string): Promise<Board | null> {
  const all = await readAllBoards(root);
  return all.find((b) => b.tasks.some((t) => t.id === taskId)) ?? null;
}
