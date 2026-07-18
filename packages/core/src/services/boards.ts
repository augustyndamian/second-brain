import { type Area, type Board } from "../types.js";
import { readAllBoards, writeBoard } from "../storage/boards.js";
import { appendEvent, nowIso } from "../storage/events.js";
import { nextBoardId } from "../storage/meta.js";
import { assertValidArea } from "./areas.js";

export interface CreateBoardInput {
  area: Area;
  name: string;
  isDefault?: boolean;
}

export async function createBoard(root: string, input: CreateBoardInput): Promise<Board> {
  await assertValidArea(root, input.area);
  const id = await nextBoardId(root, input.area, input.name);
  const ts = nowIso();
  const board: Board = {
    id,
    area: input.area,
    name: input.name,
    isDefault: !!input.isDefault,
    createdAt: ts,
    tasks: [],
  };

  if (board.isDefault) {
    // Demote previous default in the same area.
    const all = await readAllBoards(root);
    for (const b of all) {
      if (b.area === input.area && b.isDefault) {
        await writeBoard(root, { ...b, isDefault: false });
      }
    }
  }

  await writeBoard(root, board);
  await appendEvent(root, { ts, type: "board.created", boardId: id, snapshot: board });
  return board;
}

export async function listBoards(root: string, area?: Area): Promise<Board[]> {
  const all = await readAllBoards(root);
  return area ? all.filter((b) => b.area === area) : all;
}
