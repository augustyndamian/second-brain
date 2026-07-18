import type { Area, Column, RecurringRule } from "../types.js";
import { readAllBoards } from "../storage/boards.js";
import { readEvents } from "../storage/events.js";
import { listRules } from "../storage/recurring.js";
import { readActive, writeActive } from "../storage/active-session.js";
import { localDateOf } from "../schedule/dates.js";
import { expandRulesForDate, type RecurringStatus } from "../schedule/engine.js";
import { ensureSession } from "../services/session.js";

export interface TodayRecurringItem {
  ruleId: string;
  title: string;
  area: Area;
  boardId: string | null;
  status: RecurringStatus;
  reason?: string | null;
  rescheduledFrom?: string;
}

export interface TodayTaskItem {
  id: string;
  title: string;
  area: Area;
  boardId: string;
  column: Column;
  dueDate: string | null;
  plannedDate?: string | null;
  parentGoalRef: string | null;
  priority: number;
  note?: string | null;
}

export interface OverdueItem extends TodayTaskItem {
  daysOverdue: number;
}

export interface TodayPayload {
  date: string;
  recurring: TodayRecurringItem[];
  recurringDone: TodayRecurringItem[];
  tasks: TodayTaskItem[];
  overdue: OverdueItem[];
  doneTasks: TodayTaskItem[];
  /** Tasks whose dueDate=today but are not planned for today (informational, not anchored). */
  dueOnlyToday: TodayTaskItem[];
  autoClosed?: { date: string; hoursOpen: number; missedCount: number } | null;
}

function ruleById(rules: RecurringRule[], id: string): RecurringRule | undefined {
  return rules.find((r) => r.id === id);
}

export async function today(root: string, dateOverride?: string): Promise<TodayPayload> {
  let autoClosed: TodayPayload["autoClosed"] = null;
  let date: string;
  if (dateOverride) {
    date = dateOverride;
  } else {
    const opened = await ensureSession(root);
    date = opened.session.date;
    autoClosed = opened.autoClosed;
  }
  const [rules, events, boards, active] = await Promise.all([
    listRules(root),
    readEvents(root),
    readAllBoards(root),
    readActive(root),
  ]);
  const anchored = new Set(
    active && active.status === "open" && active.date === date ? active.anchoredTaskIds : [],
  );

  // Self-heal anchor drift: any non-done task planned for `date` or earlier
  // belongs in today's view — re-anchor it if it fell out of the anchor set
  // (e.g. historical de-anchor on reschedule-to-today). Persist so subsequent
  // reads and session.close see the same set.
  if (active && active.status === "open" && active.date === date) {
    const missing: string[] = [];
    for (const b of boards) {
      for (const t of b.tasks) {
        if (t.column === "done" || anchored.has(t.id)) continue;
        const belongsToday = t.plannedDate !== null ? t.plannedDate <= date : t.column === "doing";
        if (belongsToday) missing.push(t.id);
      }
    }
    if (missing.length > 0) {
      for (const id of missing) anchored.add(id);
      await writeActive(root, {
        ...active,
        anchoredTaskIds: [...active.anchoredTaskIds, ...missing],
      });
    }
  }

  const instances = expandRulesForDate(date, rules, events);
  const allRecurring: TodayRecurringItem[] = instances.map((i) => {
    const r = ruleById(rules, i.ruleId);
    return {
      ruleId: i.ruleId,
      title: r?.title ?? "(unknown)",
      area: r?.area ?? "unknown",
      boardId: r?.boardId ?? null,
      status: i.status,
      reason: i.reason ?? null,
      rescheduledFrom: i.rescheduledFrom,
    };
  });
  const recurring = allRecurring.filter((r) => r.status !== "done");
  const recurringDone = allRecurring.filter((r) => r.status === "done");

  const tasks: TodayTaskItem[] = [];
  const overdue: OverdueItem[] = [];
  const doneTasks: TodayTaskItem[] = [];
  const dueOnlyToday: TodayTaskItem[] = [];

  for (const b of boards) {
    for (const t of b.tasks) {
      if (t.column === "done") {
        const sessionDate = t.completedSessionDate ?? (t.completedAt ? localDateOf(t.completedAt) : null);
        if (sessionDate === date) {
          doneTasks.push({
            id: t.id,
            title: t.title,
            area: b.area,
            boardId: b.id,
            column: t.column,
            dueDate: t.dueDate,
            plannedDate: t.plannedDate,
            parentGoalRef: t.parentGoalRef,
            priority: t.priority,
            note: t.note ?? null,
          });
        }
        continue;
      }
      const item: TodayTaskItem = {
        id: t.id,
        title: t.title,
        area: b.area,
        boardId: b.id,
        column: t.column,
        dueDate: t.dueDate,
        plannedDate: t.plannedDate,
        parentGoalRef: t.parentGoalRef,
        priority: t.priority,
      };

      const isAnchored = anchored.has(t.id);
      if (isAnchored) {
        if (t.dueDate && t.dueDate < date) {
          overdue.push({ ...item, daysOverdue: daysBetween(t.dueDate, date) });
        } else {
          tasks.push(item);
        }
        continue;
      }

      // Not anchored: surface as informational if dueDate=today and not planned for today.
      if (t.column !== "doing" && t.dueDate === date && t.plannedDate !== date) {
        dueOnlyToday.push(item);
      } else if (t.column === "doing") {
        // Legacy fallback: doing tasks not yet anchored (e.g. session opened in offline GUI).
        if (t.dueDate && t.dueDate < date) {
          overdue.push({ ...item, daysOverdue: daysBetween(t.dueDate, date) });
        } else {
          tasks.push(item);
        }
      }
    }
  }

  return { date, recurring, recurringDone, tasks, overdue, doneTasks, dueOnlyToday, autoClosed };
}

function daysBetween(from: string, to: string): number {
  const a = Date.parse(from + "T00:00:00Z");
  const b = Date.parse(to + "T00:00:00Z");
  return Math.round((b - a) / 86400000);
}

export async function overdue(root: string, dateOverride?: string): Promise<OverdueItem[]> {
  const t = await today(root, dateOverride);
  return t.overdue;
}
