import {
  type Area,
  type Board,
  type Column,
  type Task,
} from "../types.js";
import {
  findDefaultBoard,
  findTaskBoard,
  readAllBoards,
  readBoard,
  updateBoard,
  writeBoard,
} from "../storage/boards.js";
import { appendEvent, nowIso } from "../storage/events.js";
import { nextTaskId, nextTaskIds } from "../storage/meta.js";
import { readActive, writeActive } from "../storage/active-session.js";
import { anchorTaskToActive } from "./session.js";
import { localToday } from "../schedule/dates.js";
import { appendAutoLog } from "../storage/daily-notes.js";
import { assertValidArea } from "./areas.js";
import { readAreas } from "../storage/areas.js";

export interface CreateTaskInput {
  area: Area;
  title: string;
  description?: string;
  dueDate?: string | null;
  plannedDate?: string | null;
  parentGoalRef?: string | null;
  priority?: number;
  note?: string | null;
  column?: Column;
  boardId?: string;
}

function normalizeNote(input: string | null | undefined): string | null {
  if (input == null) return null;
  const trimmed = input.trim();
  return trimmed.length === 0 ? null : input;
}

export interface CreatedTask {
  task: Task;
  boardId: string;
}

export async function createTask(root: string, input: CreateTaskInput): Promise<CreatedTask> {
  await assertValidArea(root, input.area);
  let boardId = input.boardId;
  if (!boardId) {
    const def = await findDefaultBoard(root, input.area);
    if (!def) throw new Error(`no default board for area ${input.area}`);
    boardId = def.id;
  } else {
    const b = await readBoard(root, boardId);
    if (!b) throw new Error(`board not found: ${boardId}`);
    if (b.area !== input.area) {
      throw new Error(`board ${boardId} belongs to area ${b.area}, not ${input.area}`);
    }
  }

  const id = await nextTaskId(root, input.area);
  const ts = nowIso();
  const column: Column = input.column ?? "todo";
  const active = await readActive(root);
  const sessionDate = active?.status === "open" ? active.date : localToday();
  const task: Task = {
    id,
    title: input.title,
    description: input.description ?? "",
    column,
    dueDate: input.dueDate ?? null,
    plannedDate: input.plannedDate ?? null,
    parentGoalRef: input.parentGoalRef ?? null,
    priority: input.priority ?? 5,
    note: normalizeNote(input.note),
    createdAt: ts,
    updatedAt: ts,
    completedAt: column === "done" ? ts : null,
    completedSessionDate: column === "done" ? sessionDate : null,
  };

  await updateBoard(root, boardId, (b) => ({ ...b, tasks: [...b.tasks, task] }));
  await appendEvent(root, {
    ts,
    type: "task.created",
    taskId: id,
    boardId,
    snapshot: task,
  });
  if (column === "doing") {
    await anchorTaskToActive(root, id);
  }
  return { task, boardId };
}

export interface BatchItemError {
  index: number;
  field: string;
  reason: string;
}

export class BatchValidationError extends Error {
  errors: BatchItemError[];
  constructor(errors: BatchItemError[]) {
    super(`batch validation failed: ${errors.length} error(s)`);
    this.name = "BatchValidationError";
    this.errors = errors;
  }
}

export async function createTasksBatch(
  root: string,
  inputs: CreateTaskInput[],
): Promise<CreatedTask[]> {
  if (!Array.isArray(inputs) || inputs.length === 0) {
    throw new BatchValidationError([{ index: -1, field: "items", reason: "empty or non-array" }]);
  }

  const errors: BatchItemError[] = [];
  const knownAreas = new Set((await readAreas(root)).map((a) => a.id));

  // Phase 1: per-item shape validation (cheap, before any IO).
  inputs.forEach((it, i) => {
    if (!it || typeof it !== "object") {
      errors.push({ index: i, field: "item", reason: "not an object" });
      return;
    }
    if (typeof it.title !== "string" || it.title.length === 0) {
      errors.push({ index: i, field: "title", reason: "required non-empty string" });
    }
    if (typeof it.area !== "string") {
      errors.push({ index: i, field: "area", reason: "required" });
    } else if (!knownAreas.has(it.area)) {
      errors.push({
        index: i,
        field: "area",
        reason: `unknown area: ${it.area} (configured: ${[...knownAreas].join(", ")})`,
      });
    }
    if (it.priority !== undefined && (!Number.isInteger(it.priority) || it.priority < 1 || it.priority > 10)) {
      errors.push({ index: i, field: "priority", reason: "integer 1-10" });
    }
    if (it.dueDate != null && !/^\d{4}-\d{2}-\d{2}$/.test(it.dueDate)) {
      errors.push({ index: i, field: "dueDate", reason: "expected YYYY-MM-DD" });
    }
    if (it.plannedDate != null && !/^\d{4}-\d{2}-\d{2}$/.test(it.plannedDate)) {
      errors.push({ index: i, field: "plannedDate", reason: "expected YYYY-MM-DD" });
    }
  });
  if (errors.length > 0) throw new BatchValidationError(errors);

  // Phase 2: resolve target board per item (read all boards once for efficiency).
  const allBoards = await readAllBoards(root);
  const boardsById = new Map(allBoards.map((b) => [b.id, b]));
  const defaultByArea = new Map<Area, Board>();
  for (const b of allBoards) {
    if (b.isDefault && !defaultByArea.has(b.area)) defaultByArea.set(b.area, b);
  }
  for (const b of allBoards) {
    if (!defaultByArea.has(b.area)) defaultByArea.set(b.area, b);
  }

  const resolved: { input: CreateTaskInput; boardId: string; area: Area }[] = [];
  inputs.forEach((it, i) => {
    let boardId = it.boardId;
    if (boardId) {
      const b = boardsById.get(boardId);
      if (!b) {
        errors.push({ index: i, field: "boardId", reason: `board not found: ${boardId}` });
        return;
      }
      if (b.area !== it.area) {
        errors.push({ index: i, field: "boardId", reason: `board ${boardId} belongs to area ${b.area}, not ${it.area}` });
        return;
      }
    } else {
      const def = defaultByArea.get(it.area);
      if (!def) {
        errors.push({ index: i, field: "area", reason: `no default board for area ${it.area}` });
        return;
      }
      boardId = def.id;
    }
    resolved.push({ input: it, boardId: boardId!, area: it.area });
  });
  if (errors.length > 0) throw new BatchValidationError(errors);

  // Phase 3: allocate IDs, grouped per area (one meta write per area).
  const byArea = new Map<Area, number[]>(); // area -> indices into resolved[]
  resolved.forEach((r, idx) => {
    const arr = byArea.get(r.area) ?? [];
    arr.push(idx);
    byArea.set(r.area, arr);
  });

  const taskIds: string[] = new Array(resolved.length).fill("");
  for (const [area, indices] of byArea) {
    const ids = await nextTaskIds(root, area, indices.length);
    indices.forEach((resolvedIdx, k) => {
      taskIds[resolvedIdx] = ids[k]!;
    });
  }

  // Phase 4: build tasks, group by board, one writeBoard per board.
  const ts = nowIso();
  const active = await readActive(root);
  const sessionDate = active?.status === "open" ? active.date : localToday();
  const built: { task: Task; boardId: string }[] = resolved.map((r, idx) => {
    const column: Column = r.input.column ?? "todo";
    const task: Task = {
      id: taskIds[idx]!,
      title: r.input.title,
      description: r.input.description ?? "",
      column,
      dueDate: r.input.dueDate ?? null,
      plannedDate: r.input.plannedDate ?? null,
      parentGoalRef: r.input.parentGoalRef ?? null,
      priority: r.input.priority ?? 5,
      note: normalizeNote(r.input.note),
      createdAt: ts,
      updatedAt: ts,
      completedAt: column === "done" ? ts : null,
      completedSessionDate: column === "done" ? sessionDate : null,
    };
    return { task, boardId: r.boardId };
  });

  const byBoard = new Map<string, Task[]>();
  for (const b of built) {
    const arr = byBoard.get(b.boardId) ?? [];
    arr.push(b.task);
    byBoard.set(b.boardId, arr);
  }

  for (const [boardId, newTasks] of byBoard) {
    const cur = boardsById.get(boardId)!;
    await writeBoard(root, { ...cur, tasks: [...cur.tasks, ...newTasks] });
  }

  // Phase 5: append per-item events (audit trail consistent with single-add).
  for (const b of built) {
    await appendEvent(root, {
      ts,
      type: "task.created",
      taskId: b.task.id,
      boardId: b.boardId,
      snapshot: b.task,
    });
    if (b.task.column === "doing") {
      await anchorTaskToActive(root, b.task.id);
    }
  }

  return built.map((b) => ({ task: b.task, boardId: b.boardId }));
}

export interface ListTasksFilter {
  area?: Area;
  boardId?: string;
  column?: Column;
  dueBefore?: string;
}

export interface TaskWithBoard {
  task: Task;
  board: Board;
}

export async function listTasks(root: string, filter: ListTasksFilter = {}): Promise<TaskWithBoard[]> {
  const boards = await readAllBoards(root);
  const out: TaskWithBoard[] = [];
  for (const b of boards) {
    if (filter.area && b.area !== filter.area) continue;
    if (filter.boardId && b.id !== filter.boardId) continue;
    for (const t of b.tasks) {
      if (filter.column && t.column !== filter.column) continue;
      if (filter.dueBefore && (t.dueDate === null || t.dueDate >= filter.dueBefore)) continue;
      out.push({ task: t, board: b });
    }
  }
  return out;
}

export async function showTask(root: string, taskId: string): Promise<TaskWithBoard | null> {
  const board = await findTaskBoard(root, taskId);
  if (!board) return null;
  const task = board.tasks.find((t) => t.id === taskId);
  return task ? { task, board } : null;
}

export interface EditTaskInput {
  title?: string;
  description?: string;
  dueDate?: string | null;
  plannedDate?: string | null;
  parentGoalRef?: string | null;
  priority?: number;
  note?: string | null;
  area?: Area;
  boardId?: string;
}

export async function editTask(root: string, taskId: string, input: EditTaskInput): Promise<TaskWithBoard> {
  if (input.area) await assertValidArea(root, input.area);
  const cur = await findTaskBoard(root, taskId);
  if (!cur) throw new Error(`task not found: ${taskId}`);
  const task = cur.tasks.find((t) => t.id === taskId)!;

  // Resolve target board if area/boardId changed.
  let targetBoardId = cur.id;
  if (input.boardId && input.boardId !== cur.id) {
    const b = await readBoard(root, input.boardId);
    if (!b) throw new Error(`board not found: ${input.boardId}`);
    if (input.area && b.area !== input.area) {
      throw new Error(`board ${b.id} belongs to area ${b.area}, not ${input.area}`);
    }
    targetBoardId = b.id;
  } else if (input.area && input.area !== cur.area) {
    const def = await findDefaultBoard(root, input.area);
    if (!def) throw new Error(`no default board for area ${input.area}`);
    targetBoardId = def.id;
  }

  const ts = nowIso();
  const changes: Record<string, [unknown, unknown]> = {};
  const next: Task = { ...task, updatedAt: ts };
  if (input.title !== undefined && input.title !== task.title) {
    changes.title = [task.title, input.title];
    next.title = input.title;
  }
  if (input.description !== undefined && input.description !== task.description) {
    changes.description = [task.description, input.description];
    next.description = input.description;
  }
  if (input.dueDate !== undefined && input.dueDate !== task.dueDate) {
    changes.dueDate = [task.dueDate, input.dueDate];
    next.dueDate = input.dueDate;
  }
  if (input.plannedDate !== undefined && input.plannedDate !== task.plannedDate) {
    if (input.plannedDate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(input.plannedDate)) {
      throw new Error(`invalid plannedDate: expected YYYY-MM-DD or null, got ${input.plannedDate}`);
    }
    changes.plannedDate = [task.plannedDate, input.plannedDate];
    next.plannedDate = input.plannedDate;
  }
  if (input.parentGoalRef !== undefined && input.parentGoalRef !== task.parentGoalRef) {
    changes.parentGoalRef = [task.parentGoalRef, input.parentGoalRef];
    next.parentGoalRef = input.parentGoalRef;
  }
  if (input.priority !== undefined && input.priority !== task.priority) {
    changes.priority = [task.priority, input.priority];
    next.priority = input.priority;
  }
  if (input.note !== undefined) {
    const normalized = normalizeNote(input.note);
    if (normalized !== task.note) {
      changes.note = [task.note, normalized];
      next.note = normalized;
    }
  }
  if (targetBoardId !== cur.id) {
    changes.boardId = [cur.id, targetBoardId];
  }

  if (Object.keys(changes).length === 0) {
    return { task, board: cur };
  }

  if (targetBoardId === cur.id) {
    const updated = await updateBoard(root, cur.id, (b) => ({
      ...b,
      tasks: b.tasks.map((t) => (t.id === taskId ? next : t)),
    }));
    await appendEvent(root, {
      ts,
      type: "task.edited",
      taskId,
      boardId: cur.id,
      changes,
    });
    return { task: next, board: updated };
  }

  // Move to a different board: remove from cur, add to target.
  await updateBoard(root, cur.id, (b) => ({ ...b, tasks: b.tasks.filter((t) => t.id !== taskId) }));
  const updated = await updateBoard(root, targetBoardId, (b) => ({ ...b, tasks: [...b.tasks, next] }));
  await appendEvent(root, {
    ts,
    type: "task.edited",
    taskId,
    boardId: targetBoardId,
    changes,
  });
  return { task: next, board: updated };
}

export async function moveTask(root: string, taskId: string, to: Column): Promise<TaskWithBoard> {
  const board = await findTaskBoard(root, taskId);
  if (!board) throw new Error(`task not found: ${taskId}`);
  const task = board.tasks.find((t) => t.id === taskId)!;
  if (task.column === to) return { task, board };

  const ts = nowIso();
  const active = await readActive(root);
  const sessionDate = active?.status === "open" ? active.date : localToday();
  const next: Task = {
    ...task,
    column: to,
    updatedAt: ts,
    completedAt: to === "done" ? ts : null,
    completedSessionDate: to === "done" ? sessionDate : null,
  };
  const updated = await updateBoard(root, board.id, (b) => ({
    ...b,
    tasks: b.tasks.map((t) => (t.id === taskId ? next : t)),
  }));
  await appendEvent(root, {
    ts,
    type: "task.moved",
    taskId,
    boardId: board.id,
    from: task.column,
    to,
  });
  if (to === "doing") {
    await anchorTaskToActive(root, taskId);
  }
  return { task: next, board: updated };
}

export interface RescheduleResult {
  task: Task;
  board: Board;
  fromPlanned: string | null;
  toPlanned: string;
  fromColumn: Column;
}

/**
 * Atomic reschedule: set plannedDate, demote from `doing` to `todo`, and emit a
 * single `task.rescheduled` event. Anchor bookkeeping: rescheduling to the active
 * session's date anchors the task (keeps it in today's view); any other date
 * de-anchors it.
 *
 * Validation:
 *   - toDate is YYYY-MM-DD and not before localToday() (no past reschedules)
 *   - task must exist and not be in `done` column
 */
export async function rescheduleTask(
  root: string,
  taskId: string,
  toDate: string,
  reason?: string | null,
): Promise<RescheduleResult> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(toDate)) {
    throw new Error(`invalid toDate: expected YYYY-MM-DD, got ${toDate}`);
  }
  const today = localToday();
  if (toDate < today) {
    throw new Error(`cannot reschedule to past date ${toDate} (today=${today})`);
  }

  const cur = await findTaskBoard(root, taskId);
  if (!cur) throw new Error(`task not found: ${taskId}`);
  const task = cur.tasks.find((t) => t.id === taskId)!;
  if (task.column === "done") {
    throw new Error(`cannot reschedule done task ${taskId}`);
  }

  const ts = nowIso();
  const fromPlanned = task.plannedDate;
  const fromColumn = task.column;
  const nextColumn: Column = task.column === "doing" ? "todo" : task.column;

  const next: Task = {
    ...task,
    plannedDate: toDate,
    column: nextColumn,
    updatedAt: ts,
  };

  const updated = await updateBoard(root, cur.id, (b) => ({
    ...b,
    tasks: b.tasks.map((t) => (t.id === taskId ? next : t)),
  }));

  // Anchor bookkeeping: reschedule to the session's own date keeps the task
  // in today's view (anchor if missing); a future date de-anchors it.
  const active = await readActive(root);
  let sessionDate: string | null = null;
  if (active && active.status === "open") {
    sessionDate = active.date;
    const isAnchored = active.anchoredTaskIds.includes(taskId);
    if (toDate === active.date && !isAnchored) {
      await writeActive(root, {
        ...active,
        anchoredTaskIds: [...active.anchoredTaskIds, taskId],
      });
    } else if (toDate !== active.date && isAnchored) {
      await writeActive(root, {
        ...active,
        anchoredTaskIds: active.anchoredTaskIds.filter((id) => id !== taskId),
      });
    }
  }

  await appendEvent(root, {
    ts,
    type: "task.rescheduled",
    taskId,
    boardId: cur.id,
    fromPlanned,
    toPlanned: toDate,
    fromColumn,
    sessionDate,
    reason: reason ?? null,
  });

  // Auto-log into today's scratchpad (best-effort; non-blocking).
  const reasonSuffix = reason && reason.trim() ? ` (reason: ${reason.trim()})` : "";
  const fromSuffix = fromPlanned ? `${fromPlanned} → ` : "";
  await appendAutoLog(
    root,
    localToday(),
    "reschedule",
    `${taskId} [${cur.area}] "${task.title}" — rescheduled: ${fromSuffix}${toDate}${reasonSuffix}`,
  );

  return { task: next, board: updated, fromPlanned, toPlanned: toDate, fromColumn };
}

// ─── Batch ops (v0.0.2) ──────────────────────────────────────────────────────

function makeBatchId(): string {
  return `b_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Build a taskId→Board map from a pre-fetched boards array (no extra IO).
 * Throws on duplicate task ids — batch ops resolve every task through this map,
 * and a silent "last one wins" here would patch or report the wrong record.
 */
function buildTaskBoardMap(allBoards: Board[]): Map<string, Board> {
  const m = new Map<string, Board>();
  for (const b of allBoards) {
    for (const t of b.tasks) {
      const prev = m.get(t.id);
      if (prev) {
        const where = prev.id === b.id ? `twice on board ${b.id}` : `on boards ${prev.id} and ${b.id}`;
        throw new Error(
          `duplicate task id "${t.id}" (${where}) — repair the board YAML before running batch operations`,
        );
      }
      m.set(t.id, b);
    }
  }
  return m;
}

// ── move-batch ────────────────────────────────────────────────────────────────

export interface MoveBatchItem {
  id: string;
  column: Column;
}

export interface MoveBatchResult {
  id: string;
  from: Column;
  to: Column;
  boardId: string;
}

export async function moveTasksBatch(
  root: string,
  items: MoveBatchItem[],
): Promise<MoveBatchResult[]> {
  if (!Array.isArray(items) || items.length === 0) {
    throw new BatchValidationError([{ index: -1, field: "items", reason: "empty or non-array" }]);
  }

  const errors: BatchItemError[] = [];
  const validColumns = ["todo", "doing", "done"];
  items.forEach((it, i) => {
    if (!it?.id || typeof it.id !== "string") errors.push({ index: i, field: "id", reason: "required string" });
    if (!validColumns.includes(it?.column)) errors.push({ index: i, field: "column", reason: "must be todo|doing|done" });
  });
  if (errors.length > 0) throw new BatchValidationError(errors);

  const allBoards = await readAllBoards(root);
  const taskBoardMap = buildTaskBoardMap(allBoards);

  const resolved: { item: MoveBatchItem; task: Task; board: Board }[] = [];
  items.forEach((it, i) => {
    const board = taskBoardMap.get(it.id);
    if (!board) { errors.push({ index: i, field: "id", reason: `task not found: ${it.id}` }); return; }
    const task = board.tasks.find((t) => t.id === it.id)!;
    resolved.push({ item: it, task, board });
  });
  if (errors.length > 0) throw new BatchValidationError(errors);

  const ts = nowIso();
  const batchId = makeBatchId();
  const active = await readActive(root);
  const sessionDate = active?.status === "open" ? active.date : localToday();

  // Group updates by board (in memory — no IO yet).
  const boardUpdates = new Map<string, { board: Board; patches: Map<string, Task> }>();
  for (const { item, task, board } of resolved) {
    if (!boardUpdates.has(board.id)) boardUpdates.set(board.id, { board, patches: new Map() });
    boardUpdates.get(board.id)!.patches.set(task.id, {
      ...task,
      column: item.column,
      updatedAt: ts,
      completedAt: item.column === "done" ? ts : null,
      completedSessionDate: item.column === "done" ? sessionDate : null,
    });
  }

  // Atomic write per board.
  for (const [, { board, patches }] of boardUpdates) {
    await writeBoard(root, { ...board, tasks: board.tasks.map((t) => patches.get(t.id) ?? t) });
  }

  // Per-item events with batchId.
  const results: MoveBatchResult[] = [];
  for (const { item, task, board } of resolved) {
    if (task.column !== item.column) {
      await appendEvent(root, { ts, type: "task.moved", taskId: task.id, boardId: board.id, from: task.column, to: item.column, batchId });
      if (item.column === "doing") await anchorTaskToActive(root, task.id);
    }
    results.push({ id: task.id, from: task.column, to: item.column, boardId: board.id });
  }
  return results;
}

// ── reschedule-batch ──────────────────────────────────────────────────────────

export interface RescheduleBatchItem {
  id: string;
  to: string;
  reason?: string | null;
}

export interface RescheduleBatchResult {
  id: string;
  fromPlanned: string | null;
  toPlanned: string;
  fromColumn: Column;
  boardId: string;
}

export async function rescheduleTasksBatch(
  root: string,
  items: RescheduleBatchItem[],
): Promise<RescheduleBatchResult[]> {
  if (!Array.isArray(items) || items.length === 0) {
    throw new BatchValidationError([{ index: -1, field: "items", reason: "empty or non-array" }]);
  }

  const today = localToday();
  const errors: BatchItemError[] = [];
  items.forEach((it, i) => {
    if (!it?.id || typeof it.id !== "string") errors.push({ index: i, field: "id", reason: "required string" });
    if (!it?.to || !/^\d{4}-\d{2}-\d{2}$/.test(it.to)) errors.push({ index: i, field: "to", reason: "expected YYYY-MM-DD" });
    else if (it.to < today) errors.push({ index: i, field: "to", reason: `cannot reschedule to past: ${it.to}` });
  });
  if (errors.length > 0) throw new BatchValidationError(errors);

  const allBoards = await readAllBoards(root);
  const taskBoardMap = buildTaskBoardMap(allBoards);

  const resolved: { item: RescheduleBatchItem; task: Task; board: Board }[] = [];
  items.forEach((it, i) => {
    const board = taskBoardMap.get(it.id);
    if (!board) { errors.push({ index: i, field: "id", reason: `task not found: ${it.id}` }); return; }
    const task = board.tasks.find((t) => t.id === it.id)!;
    if (task.column === "done") { errors.push({ index: i, field: "id", reason: `cannot reschedule done task: ${it.id}` }); return; }
    resolved.push({ item: it, task, board });
  });
  if (errors.length > 0) throw new BatchValidationError(errors);

  const ts = nowIso();
  const batchId = makeBatchId();

  // Anchor bookkeeping in one write: reschedule to the session's own date
  // anchors the task (keeps it in today's view); a future date de-anchors it.
  const active = await readActive(root);
  const sessionDate = active?.status === "open" ? active.date : null;
  if (active?.status === "open") {
    const futureIds = new Set(resolved.filter((r) => r.item.to !== active.date).map((r) => r.task.id));
    const kept = active.anchoredTaskIds.filter((id) => !futureIds.has(id));
    const added = resolved
      .filter((r) => r.item.to === active.date && !active.anchoredTaskIds.includes(r.task.id))
      .map((r) => r.task.id);
    if (kept.length !== active.anchoredTaskIds.length || added.length > 0) {
      await writeActive(root, { ...active, anchoredTaskIds: [...kept, ...added] });
    }
  }

  // Group updates by board.
  const boardUpdates = new Map<string, { board: Board; patches: Map<string, Task> }>();
  for (const { item, task, board } of resolved) {
    if (!boardUpdates.has(board.id)) boardUpdates.set(board.id, { board, patches: new Map() });
    const nextColumn: Column = task.column === "doing" ? "todo" : task.column;
    boardUpdates.get(board.id)!.patches.set(task.id, { ...task, plannedDate: item.to, column: nextColumn, updatedAt: ts });
  }

  for (const [, { board, patches }] of boardUpdates) {
    await writeBoard(root, { ...board, tasks: board.tasks.map((t) => patches.get(t.id) ?? t) });
  }

  const results: RescheduleBatchResult[] = [];
  for (const { item, task, board } of resolved) {
    await appendEvent(root, {
      ts, type: "task.rescheduled", taskId: task.id, boardId: board.id,
      fromPlanned: task.plannedDate, toPlanned: item.to,
      fromColumn: task.column, sessionDate, reason: item.reason ?? null, batchId,
    });
    const reasonSuffix = item.reason?.trim() ? ` (reason: ${item.reason.trim()})` : "";
    const fromSuffix = task.plannedDate ? `${task.plannedDate} → ` : "";
    await appendAutoLog(root, today, "reschedule-batch", `${task.id} [${board.area}] "${task.title}" — rescheduled: ${fromSuffix}${item.to}${reasonSuffix}`);
    results.push({ id: task.id, fromPlanned: task.plannedDate, toPlanned: item.to, fromColumn: task.column, boardId: board.id });
  }
  return results;
}

// ── edit-batch ────────────────────────────────────────────────────────────────

export interface EditBatchItem {
  id: string;
  title?: string;
  description?: string;
  dueDate?: string | null;
  plannedDate?: string | null;
  parentGoalRef?: string | null;
  priority?: number;
  note?: string | null;
}

export interface EditBatchResult {
  id: string;
  boardId: string;
  changes: Record<string, [unknown, unknown]>;
}

export async function editTasksBatch(
  root: string,
  items: EditBatchItem[],
): Promise<EditBatchResult[]> {
  if (!Array.isArray(items) || items.length === 0) {
    throw new BatchValidationError([{ index: -1, field: "items", reason: "empty or non-array" }]);
  }

  const errors: BatchItemError[] = [];
  items.forEach((it, i) => {
    if (!it?.id || typeof it.id !== "string") errors.push({ index: i, field: "id", reason: "required string" });
    const editKeys = ["title", "description", "dueDate", "plannedDate", "parentGoalRef", "priority", "note"];
    if (!editKeys.some((k) => Object.prototype.hasOwnProperty.call(it, k))) {
      errors.push({ index: i, field: "fields", reason: "at least one edit field required" });
    }
    if (it?.priority !== undefined && (!Number.isInteger(it.priority) || it.priority < 1 || it.priority > 10)) {
      errors.push({ index: i, field: "priority", reason: "integer 1-10" });
    }
    if (it?.dueDate != null && !/^\d{4}-\d{2}-\d{2}$/.test(it.dueDate)) {
      errors.push({ index: i, field: "dueDate", reason: "expected YYYY-MM-DD" });
    }
    if (it?.plannedDate != null && !/^\d{4}-\d{2}-\d{2}$/.test(it.plannedDate)) {
      errors.push({ index: i, field: "plannedDate", reason: "expected YYYY-MM-DD" });
    }
  });
  if (errors.length > 0) throw new BatchValidationError(errors);

  const allBoards = await readAllBoards(root);
  const taskBoardMap = buildTaskBoardMap(allBoards);

  const resolved: { item: EditBatchItem; task: Task; board: Board }[] = [];
  items.forEach((it, i) => {
    const board = taskBoardMap.get(it.id);
    if (!board) { errors.push({ index: i, field: "id", reason: `task not found: ${it.id}` }); return; }
    const task = board.tasks.find((t) => t.id === it.id)!;
    resolved.push({ item: it, task, board });
  });
  if (errors.length > 0) throw new BatchValidationError(errors);

  const ts = nowIso();
  const batchId = makeBatchId();

  const boardUpdates = new Map<string, { board: Board; patches: Map<string, Task> }>();
  const perItemChanges: Record<string, [unknown, unknown]>[] = [];

  for (const { item, task, board } of resolved) {
    if (!boardUpdates.has(board.id)) boardUpdates.set(board.id, { board, patches: new Map() });
    const changes: Record<string, [unknown, unknown]> = {};
    const next: Task = { ...task, updatedAt: ts };
    if (item.title !== undefined && item.title !== task.title) { changes.title = [task.title, item.title]; next.title = item.title; }
    if (item.description !== undefined && item.description !== task.description) { changes.description = [task.description, item.description]; next.description = item.description; }
    if (item.dueDate !== undefined && item.dueDate !== task.dueDate) { changes.dueDate = [task.dueDate, item.dueDate]; next.dueDate = item.dueDate; }
    if (item.plannedDate !== undefined && item.plannedDate !== task.plannedDate) { changes.plannedDate = [task.plannedDate, item.plannedDate]; next.plannedDate = item.plannedDate; }
    if (item.parentGoalRef !== undefined && item.parentGoalRef !== task.parentGoalRef) { changes.parentGoalRef = [task.parentGoalRef, item.parentGoalRef]; next.parentGoalRef = item.parentGoalRef; }
    if (item.priority !== undefined && item.priority !== task.priority) { changes.priority = [task.priority, item.priority]; next.priority = item.priority; }
    if (item.note !== undefined) { const norm = normalizeNote(item.note); if (norm !== task.note) { changes.note = [task.note, norm]; next.note = norm; } }
    boardUpdates.get(board.id)!.patches.set(task.id, next);
    perItemChanges.push(changes);
  }

  for (const [, { board, patches }] of boardUpdates) {
    await writeBoard(root, { ...board, tasks: board.tasks.map((t) => patches.get(t.id) ?? t) });
  }

  const results: EditBatchResult[] = [];
  for (let i = 0; i < resolved.length; i++) {
    const { task, board } = resolved[i]!;
    const changes = perItemChanges[i]!;
    if (Object.keys(changes).length > 0) {
      await appendEvent(root, { ts, type: "task.edited", taskId: task.id, boardId: board.id, changes, batchId });
    }
    results.push({ id: task.id, boardId: board.id, changes });
  }
  return results;
}

export async function deleteTask(root: string, taskId: string): Promise<Task> {
  const board = await findTaskBoard(root, taskId);
  if (!board) throw new Error(`task not found: ${taskId}`);
  const task = board.tasks.find((t) => t.id === taskId)!;
  const ts = nowIso();
  await updateBoard(root, board.id, (b) => ({ ...b, tasks: b.tasks.filter((t) => t.id !== taskId) }));

  // De-anchor from active session so we don't leave a dangling reference.
  const active = await readActive(root);
  if (active && active.status === "open" && active.anchoredTaskIds.includes(taskId)) {
    await writeActive(root, {
      ...active,
      anchoredTaskIds: active.anchoredTaskIds.filter((id) => id !== taskId),
    });
  }

  await appendEvent(root, {
    ts,
    type: "task.deleted",
    taskId,
    boardId: board.id,
    snapshot: task,
  });
  return task;
}
