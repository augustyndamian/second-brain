import { readAllBoards } from "../storage/boards.js";
import { readEvents, appendEvent, nowIso } from "../storage/events.js";
import { listRules } from "../storage/recurring.js";
import {
  appendRecurringStat,
  readRecurringStats,
  readSessionSnapshot,
  saveSessionSnapshot,
  type TodaySessionSnapshot,
} from "../storage/today-session.js";
import {
  readActive,
  writeActive,
  clearActive,
  isStaleSession,
  STALE_SESSION_HOURS,
} from "../storage/active-session.js";
import { localToday } from "../schedule/dates.js";
import { expandRulesForDate } from "../schedule/engine.js";
import type { ActiveSession } from "../types.js";

export interface OpenSessionResult {
  session: ActiveSession;
  autoClosed: { date: string; hoursOpen: number; missedCount: number } | null;
}

export interface CloseSessionResult {
  date: string;
  status: "closed" | "auto-closed";
  missedMarked: string[];
  doingCount: number;
  unfinishedTaskIds: string[];
}

/**
 * Snapshot doing tasks + mark pending recurring as missed + write closed snapshot.
 * Returns details for UI/CLI reporting.
 */
async function persistClose(root: string, session: ActiveSession, status: "closed" | "auto-closed"): Promise<CloseSessionResult> {
  const closedAt = nowIso();
  const date = session.date;

  // Snapshot is immutable once closed — skip overwrite if already finalized.
  const existingSnapshot = await readSessionSnapshot(root, date);
  if (existingSnapshot && existingSnapshot.status !== "open") {
    return {
      date,
      status: existingSnapshot.status as "closed" | "auto-closed",
      missedMarked: [],
      doingCount: (existingSnapshot.doingSnapshot ?? []).length,
      unfinishedTaskIds: [],
    };
  }

  const [rules, events, boards] = await Promise.all([
    listRules(root),
    readEvents(root),
    readAllBoards(root),
  ]);

  // Mark pending recurring as missed (idempotent: skip already-logged ruleIds for this date)
  const stats = await readRecurringStats(root);
  const alreadyLogged = new Set(stats.filter((s) => s.date === date).map((s) => s.ruleId));
  const missedMarked: string[] = [];
  const instances = expandRulesForDate(date, rules, events);
  for (const inst of instances) {
    if (inst.status !== "pending") continue;
    if (alreadyLogged.has(inst.ruleId)) continue;
    const rule = rules.find((r) => r.id === inst.ruleId);
    const points = rule?.points ?? 1;
    await appendRecurringStat(root, {
      date,
      ruleId: inst.ruleId,
      status: "missed",
      points: -points,
    });
    missedMarked.push(inst.ruleId);
  }

  // Build doing snapshot (frozen state of doing tasks at close)
  const doingSnapshot = boards.flatMap((b) =>
    b.tasks
      .filter((t) => t.column === "doing")
      .map((t) => ({ id: t.id, title: t.title, area: b.area, column: t.column })),
  );

  const recurringForSnapshot = instances.map((i) => {
    const rule = rules.find((r) => r.id === i.ruleId);
    // Re-derive status post missed-marking
    const wasMissed = missedMarked.includes(i.ruleId);
    const finalStatus = wasMissed ? "missed" : i.status;
    return {
      ruleId: i.ruleId,
      title: rule?.title ?? "",
      area: rule?.area ?? "",
      status: finalStatus,
    };
  });

  const snapshot: TodaySessionSnapshot = {
    date,
    triggeredAt: existingSnapshot?.triggeredAt ?? session.startedAt,
    tasks: doingSnapshot,
    recurring: recurringForSnapshot,
    status,
    startedAt: session.startedAt,
    closedAt,
    anchoredTaskIds: session.anchoredTaskIds,
    doingSnapshot,
  };
  await saveSessionSnapshot(root, snapshot);

  // Find unfinished tasks (anchored but still doing)
  const stillDoing = new Set(doingSnapshot.map((t) => t.id));
  const unfinishedTaskIds = session.anchoredTaskIds.filter((id) => stillDoing.has(id));

  return {
    date,
    status,
    missedMarked,
    doingCount: doingSnapshot.length,
    unfinishedTaskIds,
  };
}

/** Close current active session explicitly. No-op if none open. */
export async function closeSession(root: string): Promise<CloseSessionResult | null> {
  const active = await readActive(root);
  if (!active || active.status !== "open") return null;
  let result: CloseSessionResult;
  try {
    result = await persistClose(root, active, "closed");
  } finally {
    await clearActive(root);
  }
  const closedAt = nowIso();
  await appendEvent(root, {
    ts: closedAt,
    type: "session.closed",
    date: active.date,
    startedAt: active.startedAt,
    closedAt,
    status: "closed",
    missedCount: result!.missedMarked.length,
    doingCount: result!.doingCount,
  });
  return result!;
}

/**
 * Lazy-open: ensure an active session exists. If a stale (>36h) session is open,
 * auto-close it first. Returns the (possibly newly-created) active session and
 * info about any auto-close that happened.
 */
export async function ensureSession(root: string): Promise<OpenSessionResult> {
  const existing = await readActive(root);
  let autoClosed: OpenSessionResult["autoClosed"] = null;

  if (existing && existing.status === "open" && !isStaleSession(existing)) {
    return { session: existing, autoClosed: null };
  }

  if (existing && existing.status === "open" && isStaleSession(existing)) {
    const hoursOpen = Math.round((Date.now() - Date.parse(existing.startedAt)) / 3600 / 1000);
    let autoCloseResult: CloseSessionResult;
    try {
      autoCloseResult = await persistClose(root, existing, "auto-closed");
    } finally {
      await clearActive(root);
    }
    const closedAt = nowIso();
    await appendEvent(root, {
      ts: closedAt,
      type: "session.closed",
      date: existing.date,
      startedAt: existing.startedAt,
      closedAt,
      status: "auto-closed",
      missedCount: autoCloseResult!.missedMarked.length,
      doingCount: autoCloseResult!.doingCount,
    });
    autoClosed = { date: existing.date, hoursOpen, missedCount: autoCloseResult!.missedMarked.length };
  }

  // Anchor new session on current calendar date and seed anchoredTaskIds.
  // Carry-over rule:
  //   - any task with plannedDate <= today AND column !== 'done' (planned for today or earlier)
  //   - PLUS legacy fallback: column === 'doing' AND plannedDate === null (pre-v2 tasks)
  const boards = await readAllBoards(root);
  const today = localToday();
  const carried = boards.flatMap((b) =>
    b.tasks
      .filter((t) => {
        if (t.column === "done") return false;
        if (t.plannedDate !== null) return t.plannedDate <= today;
        return t.column === "doing";
      })
      .map((t) => t.id),
  );

  const session: ActiveSession = {
    schemaVersion: 1,
    date: today,
    startedAt: nowIso(),
    closedAt: null,
    status: "open",
    anchoredTaskIds: Array.from(new Set(carried)),
  };
  await writeActive(root, session);
  await appendEvent(root, {
    ts: session.startedAt,
    type: "session.opened",
    date: session.date,
    startedAt: session.startedAt,
    autoClosedPrev: autoClosed?.date ?? null,
  });

  // Persist initial trigger snapshot so /today-sessions/{date}.json exists immediately
  const [rules, events] = await Promise.all([listRules(root), readEvents(root)]);
  const instances = expandRulesForDate(session.date, rules, events);
  const snapshot: TodaySessionSnapshot = {
    date: session.date,
    triggeredAt: session.startedAt,
    tasks: boards.flatMap((b) =>
      b.tasks
        .filter((t) => t.column === "doing")
        .map((t) => ({ id: t.id, title: t.title, area: b.area, column: t.column })),
    ),
    recurring: instances.map((i) => {
      const rule = rules.find((r) => r.id === i.ruleId);
      return {
        ruleId: i.ruleId,
        title: rule?.title ?? "",
        area: rule?.area ?? "",
        status: i.status,
      };
    }),
    status: "open",
    startedAt: session.startedAt,
    closedAt: null,
    anchoredTaskIds: session.anchoredTaskIds,
  };
  await saveSessionSnapshot(root, snapshot);

  return { session, autoClosed };
}

/** Open or replace active session anchored to a specific date (debug/backfill). */
export async function openSession(root: string, date: string): Promise<ActiveSession> {
  const session: ActiveSession = {
    schemaVersion: 1,
    date,
    startedAt: nowIso(),
    closedAt: null,
    status: "open",
    anchoredTaskIds: [],
  };
  await writeActive(root, session);
  return session;
}

/** Add taskId to active.anchoredTaskIds if a session is open (idempotent). */
export async function anchorTaskToActive(root: string, taskId: string): Promise<void> {
  const active = await readActive(root);
  if (!active || active.status !== "open") return;
  if (active.anchoredTaskIds.includes(taskId)) return;
  const next: ActiveSession = {
    ...active,
    anchoredTaskIds: [...active.anchoredTaskIds, taskId],
  };
  await writeActive(root, next);
}

export { STALE_SESSION_HOURS };
