import type { Area, RecurringRule, Schedule } from "../types.js";
import { findDefaultBoard, readAllBoards, readBoard } from "../storage/boards.js";
import { appendEvent, nowIso } from "../storage/events.js";
import { nextRuleId, nextRuleIds } from "../storage/meta.js";
import { findRule, listRules, updateRecurring } from "../storage/recurring.js";
import { localToday } from "../schedule/dates.js";
import { readActive } from "../storage/active-session.js";
import { BatchValidationError, type BatchItemError } from "./tasks.js";
import { appendAutoLog } from "../storage/daily-notes.js";
import { assertValidArea } from "./areas.js";
import { readAreas } from "../storage/areas.js";

async function activeOrToday(root: string): Promise<string> {
  const active = await readActive(root);
  return active?.status === "open" ? active.date : localToday();
}

export interface CreateRuleInput {
  area: Area;
  title: string;
  description?: string;
  parentGoalRef?: string | null;
  schedule: Schedule;
  startsOn?: string;
  endsOn?: string | null;
  boardId?: string | null;
  points?: number;
}

export async function createRule(root: string, input: CreateRuleInput): Promise<RecurringRule> {
  await assertValidArea(root, input.area);
  let boardId = input.boardId ?? null;
  if (boardId) {
    const b = await readBoard(root, boardId);
    if (!b) throw new Error(`board not found: ${boardId}`);
    if (b.area !== input.area) {
      throw new Error(`board ${boardId} belongs to area ${b.area}, not ${input.area}`);
    }
  } else {
    const def = await findDefaultBoard(root, input.area);
    if (!def) throw new Error(`no default board for area ${input.area}`);
    boardId = def.id;
  }

  const id = await nextRuleId(root);
  const ts = nowIso();
  const rule: RecurringRule = {
    id,
    area: input.area,
    boardId,
    title: input.title,
    description: input.description ?? "",
    parentGoalRef: input.parentGoalRef ?? null,
    schedule: input.schedule,
    startsOn: input.startsOn ?? localToday(),
    endsOn: input.endsOn ?? null,
    active: true,
    points: input.points ?? 1,
    createdAt: ts,
  };
  await updateRecurring(root, (f) => ({ ...f, rules: [...f.rules, rule] }));
  await appendEvent(root, { ts, type: "recurring.created", ruleId: id, snapshot: rule });
  return rule;
}

export async function createRulesBatch(
  root: string,
  inputs: CreateRuleInput[],
): Promise<RecurringRule[]> {
  if (!Array.isArray(inputs) || inputs.length === 0) {
    throw new BatchValidationError([{ index: -1, field: "items", reason: "empty or non-array" }]);
  }

  const errors: BatchItemError[] = [];
  const knownAreas = new Set((await readAreas(root)).map((a) => a.id));

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
    if (!it.schedule || typeof it.schedule !== "object" || typeof (it.schedule as Schedule).type !== "string") {
      errors.push({ index: i, field: "schedule", reason: "required schedule object" });
    }
    if (it.startsOn != null && !/^\d{4}-\d{2}-\d{2}$/.test(it.startsOn)) {
      errors.push({ index: i, field: "startsOn", reason: "expected YYYY-MM-DD" });
    }
    if (it.endsOn != null && !/^\d{4}-\d{2}-\d{2}$/.test(it.endsOn)) {
      errors.push({ index: i, field: "endsOn", reason: "expected YYYY-MM-DD" });
    }
  });
  if (errors.length > 0) throw new BatchValidationError(errors);

  // Resolve boards (read once).
  const allBoards = await readAllBoards(root);
  const boardsById = new Map(allBoards.map((b) => [b.id, b]));
  const defaultByArea = new Map<Area, string>();
  for (const b of allBoards) {
    if (b.isDefault && !defaultByArea.has(b.area)) defaultByArea.set(b.area, b.id);
  }
  for (const b of allBoards) {
    if (!defaultByArea.has(b.area)) defaultByArea.set(b.area, b.id);
  }

  const resolved: { input: CreateRuleInput; boardId: string }[] = [];
  inputs.forEach((it, i) => {
    let boardId = it.boardId ?? null;
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
      boardId = def;
    }
    resolved.push({ input: it, boardId });
  });
  if (errors.length > 0) throw new BatchValidationError(errors);

  // One meta read+write for N rule IDs.
  const ids = await nextRuleIds(root, resolved.length);
  const ts = nowIso();
  const today = localToday();
  const rules: RecurringRule[] = resolved.map((r, idx) => ({
    id: ids[idx]!,
    area: r.input.area,
    boardId: r.boardId,
    title: r.input.title,
    description: r.input.description ?? "",
    parentGoalRef: r.input.parentGoalRef ?? null,
    schedule: r.input.schedule,
    startsOn: r.input.startsOn ?? today,
    endsOn: r.input.endsOn ?? null,
    active: true,
    points: r.input.points ?? 1,
    createdAt: ts,
  }));

  // One read+write of recurring.yaml for the whole batch.
  await updateRecurring(root, (f) => ({ ...f, rules: [...f.rules, ...rules] }));

  for (const rule of rules) {
    await appendEvent(root, { ts, type: "recurring.created", ruleId: rule.id, snapshot: rule });
  }

  return rules;
}

export async function deleteRule(root: string, ruleId: string): Promise<RecurringRule> {
  const rule = await findRule(root, ruleId);
  if (!rule) throw new Error(`rule not found: ${ruleId}`);
  await updateRecurring(root, (f) => ({ ...f, rules: f.rules.filter((r) => r.id !== ruleId) }));
  await appendEvent(root, {
    ts: nowIso(),
    type: "recurring.deleted",
    ruleId,
    snapshot: rule,
  });
  return rule;
}

export async function toggleRule(root: string, ruleId: string): Promise<RecurringRule> {
  const rule = await findRule(root, ruleId);
  if (!rule) throw new Error(`rule not found: ${ruleId}`);
  const next: RecurringRule = { ...rule, active: !rule.active };
  await updateRecurring(root, (f) => ({
    ...f,
    rules: f.rules.map((r) => (r.id === ruleId ? next : r)),
  }));
  await appendEvent(root, {
    ts: nowIso(),
    type: "recurring.toggled",
    ruleId,
    active: next.active,
  });
  return next;
}

export async function markRuleDone(root: string, ruleId: string, forDate?: string): Promise<void> {
  const rule = await findRule(root, ruleId);
  if (!rule) throw new Error(`rule not found: ${ruleId}`);
  await appendEvent(root, {
    ts: nowIso(),
    type: "recurring.done",
    ruleId,
    forDate: forDate ?? (await activeOrToday(root)),
  });
}

export async function markRuleSkipped(
  root: string,
  ruleId: string,
  forDate?: string,
  reason: string | null = null,
): Promise<void> {
  const rule = await findRule(root, ruleId);
  if (!rule) throw new Error(`rule not found: ${ruleId}`);
  const skipDate = forDate ?? (await activeOrToday(root));
  await appendEvent(root, {
    ts: nowIso(),
    type: "recurring.skipped",
    ruleId,
    forDate: skipDate,
    reason,
  });
  // Auto-log when reason given (silent skip = noise; reasoned skip = high signal).
  if (reason && reason.trim()) {
    await appendAutoLog(
      root,
      localToday(),
      "skip",
      `${ruleId} [${rule.area}] "${rule.title}" — skipped for ${skipDate} (reason: ${reason.trim()})`,
    );
  }
}

export async function rescheduleRule(
  root: string,
  ruleId: string,
  fromDate: string,
  toDate: string,
  reason: string | null = null,
): Promise<void> {
  const rule = await findRule(root, ruleId);
  if (!rule) throw new Error(`rule not found: ${ruleId}`);
  await appendEvent(root, {
    ts: nowIso(),
    type: "recurring.rescheduled",
    ruleId,
    fromDate,
    toDate,
    reason,
  });
}

export async function listAllRules(root: string, area?: Area): Promise<RecurringRule[]> {
  const all = await listRules(root);
  return area ? all.filter((r) => r.area === area) : all;
}
