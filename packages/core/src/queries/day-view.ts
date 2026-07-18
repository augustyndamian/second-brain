import type { Area, Column } from "../types.js";
import { readAllBoards } from "../storage/boards.js";
import { readEvents } from "../storage/events.js";
import { listRules } from "../storage/recurring.js";
import { readSessionSnapshot } from "../storage/today-session.js";
import { readActive } from "../storage/active-session.js";
import { localDateOf } from "../schedule/dates.js";
import { expandRulesForDate, type RecurringStatus } from "../schedule/engine.js";

export interface DayViewRecurringItem {
  ruleId: string;
  title: string;
  area: Area;
  status: RecurringStatus | "missed";
}

export interface DayViewTaskItem {
  id: string;
  title: string;
  area: Area;
  boardId: string;
  column: Column;
  dueDate: string | null;
  plannedDate?: string | null;
}

export interface DayViewPayload {
  date: string;
  /** Whether this day is active, a closed snapshot, future (no session yet), or fully empty. */
  state: "active" | "closed" | "auto-closed" | "future" | "empty";
  recurring: DayViewRecurringItem[];
  /** For active day: live doing tasks. For closed days: frozen snapshot. */
  doingTasks: DayViewTaskItem[];
  doneTasks: DayViewTaskItem[];
  /** For future days: tasks whose plannedDate === date, not in column=done. */
  plannedTasks?: DayViewTaskItem[];
  /** For future days: tasks with dueDate === date but plannedDate !== date. */
  dueOnlyTasks?: DayViewTaskItem[];
  startedAt?: string;
  closedAt?: string | null;
  anchoredTaskIds?: string[];
}

/**
 * Read-only view of any day. For the currently active day, returns live data.
 * For past days with a snapshot, returns the frozen snapshot. For days without
 * a snapshot, returns empty (caller can offer "generate retroactively").
 */
export async function dayView(root: string, date: string): Promise<DayViewPayload> {
  const [rules, events, boards, snapshot, active] = await Promise.all([
    listRules(root),
    readEvents(root),
    readAllBoards(root),
    readSessionSnapshot(root, date),
    readActive(root),
  ]);

  const isActive = active?.status === "open" && active.date === date;

  // Done tasks = those with completedSessionDate === date (or fallback to completedAt's local date).
  const doneTasks: DayViewTaskItem[] = [];
  for (const b of boards) {
    for (const t of b.tasks) {
      if (t.column !== "done") continue;
      const sessionDate = t.completedSessionDate ?? (t.completedAt ? localDateOf(t.completedAt) : null);
      if (sessionDate === date) {
        doneTasks.push({
          id: t.id,
          title: t.title,
          area: b.area,
          boardId: b.id,
          column: t.column,
          dueDate: t.dueDate,
        });
      }
    }
  }

  // Recurring expansion always reflects the rules that were valid on `date`.
  const instances = expandRulesForDate(date, rules, events);
  const recurring: DayViewRecurringItem[] = instances.map((i) => {
    const rule = rules.find((r) => r.id === i.ruleId);
    return {
      ruleId: i.ruleId,
      title: rule?.title ?? "(unknown)",
      area: rule?.area ?? "unknown",
      status: i.status,
    };
  });

  let doingTasks: DayViewTaskItem[] = [];
  let plannedTasks: DayViewTaskItem[] | undefined;
  let dueOnlyTasks: DayViewTaskItem[] | undefined;
  let state: DayViewPayload["state"];
  let startedAt: string | undefined;
  let closedAt: string | null | undefined;
  let anchoredTaskIds: string[] | undefined;

  if (isActive) {
    state = "active";
    doingTasks = boards.flatMap((b) =>
      b.tasks
        .filter((t) => t.column === "doing")
        .map((t) => ({
          id: t.id,
          title: t.title,
          area: b.area,
          boardId: b.id,
          column: t.column,
          dueDate: t.dueDate,
        })),
    );
    startedAt = active!.startedAt;
    closedAt = null;
    anchoredTaskIds = active!.anchoredTaskIds;
  } else if (snapshot) {
    state = (snapshot.status === "auto-closed" ? "auto-closed" : "closed") as DayViewPayload["state"];
    const frozen = snapshot.doingSnapshot ?? snapshot.tasks ?? [];
    // Resolve boardId from current boards by task id (best-effort; falls back to "")
    const boardOfTask = new Map<string, string>();
    for (const b of boards) for (const t of b.tasks) boardOfTask.set(t.id, b.id);
    doingTasks = frozen.map((t) => ({
      id: t.id,
      title: t.title,
      area: t.area as Area,
      boardId: boardOfTask.get(t.id) ?? "",
      column: t.column as Column,
      dueDate: null,
    }));
    startedAt = snapshot.startedAt;
    closedAt = snapshot.closedAt ?? null;
    anchoredTaskIds = snapshot.anchoredTaskIds;
  } else {
    // No active and no snapshot — derive future/empty view from boards via plannedDate / dueDate.
    const planned: DayViewTaskItem[] = [];
    const dueOnly: DayViewTaskItem[] = [];
    for (const b of boards) {
      for (const t of b.tasks) {
        if (t.column === "done") continue;
        if (t.plannedDate === date) {
          planned.push({
            id: t.id,
            title: t.title,
            area: b.area,
            boardId: b.id,
            column: t.column,
            dueDate: t.dueDate,
            plannedDate: t.plannedDate,
          });
        } else if (t.dueDate === date) {
          dueOnly.push({
            id: t.id,
            title: t.title,
            area: b.area,
            boardId: b.id,
            column: t.column,
            dueDate: t.dueDate,
            plannedDate: t.plannedDate,
          });
        }
      }
    }
    plannedTasks = planned;
    dueOnlyTasks = dueOnly;
    const hasContent = planned.length > 0 || dueOnly.length > 0 || recurring.length > 0 || doneTasks.length > 0;
    state = hasContent ? "future" : "empty";
  }

  return {
    date,
    state,
    recurring,
    doingTasks,
    doneTasks,
    plannedTasks,
    dueOnlyTasks,
    startedAt,
    closedAt,
    anchoredTaskIds,
  };
}
