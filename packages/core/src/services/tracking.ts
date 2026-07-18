import type { Area, TrackingItem, TrackingKind, TrackingStatus } from "../types.js";
import { appendEvent, nowIso } from "../storage/events.js";
import { nextTrackingId } from "../storage/meta.js";
import {
  findTrackingItem,
  listTrackingItems,
  updateTracking,
} from "../storage/tracking.js";
import { appendAutoLog } from "../storage/daily-notes.js";
import { localToday } from "../schedule/dates.js";
import { assertValidArea } from "./areas.js";
import { readAreas } from "../storage/areas.js";

export interface CreateTrackingInput {
  kind: TrackingKind;
  title: string;
  area: Area;
  assignee?: string | null;
  dueDate?: string | null;
  status?: TrackingStatus;
  note?: string;
}

export async function createTrackingItem(
  root: string,
  input: CreateTrackingInput,
): Promise<TrackingItem> {
  await assertValidArea(root, input.area);
  const id = await nextTrackingId(root);
  const ts = nowIso();
  const item: TrackingItem = {
    id,
    kind: input.kind,
    title: input.title,
    area: input.area,
    assignee: input.assignee ?? null,
    dueDate: input.dueDate ?? null,
    status: input.status ?? "todo",
    note: input.note ?? "",
    createdAt: ts,
    updatedAt: ts,
  };
  await updateTracking(root, (f) => ({ ...f, items: [...f.items, item] }));
  await appendEvent(root, { ts, type: "tracking.created", itemId: id, snapshot: item });
  return item;
}

export interface CreateTrackingBatchInput extends CreateTrackingInput {}

export async function createTrackingItemsBatch(
  root: string,
  inputs: CreateTrackingBatchInput[],
): Promise<TrackingItem[]> {
  if (!Array.isArray(inputs) || inputs.length === 0) {
    throw new Error("createTrackingItemsBatch: empty or non-array input");
  }
  const out: TrackingItem[] = [];
  // Sequential ID allocation; minor — tracking writes are infrequent.
  for (const inp of inputs) {
    out.push(await createTrackingItem(root, inp));
  }
  return out;
}

export interface EditTrackingInput {
  kind?: TrackingKind;
  title?: string;
  area?: Area;
  assignee?: string | null;
  dueDate?: string | null;
  status?: TrackingStatus;
  note?: string;
}

export async function editTrackingItem(
  root: string,
  id: string,
  input: EditTrackingInput,
): Promise<TrackingItem> {
  if (input.area) await assertValidArea(root, input.area);
  const cur = await findTrackingItem(root, id);
  if (!cur) throw new Error(`tracking item not found: ${id}`);
  const ts = nowIso();
  const changes: Record<string, [unknown, unknown]> = {};
  const next: TrackingItem = { ...cur, updatedAt: ts };
  for (const k of ["kind", "title", "area", "assignee", "dueDate", "status", "note"] as const) {
    if (input[k] !== undefined && input[k] !== cur[k]) {
      changes[k] = [cur[k], input[k]];
      (next as any)[k] = input[k];
    }
  }
  if (Object.keys(changes).length === 0) return cur;
  await updateTracking(root, (f) => ({
    ...f,
    items: f.items.map((i) => (i.id === id ? next : i)),
  }));
  await appendEvent(root, { ts, type: "tracking.edited", itemId: id, changes });

  // Auto-log: status change is a high-signal event for daily review.
  if (changes.status) {
    const [prev, nextStatus] = changes.status as [TrackingStatus, TrackingStatus];
    const assignee = next.assignee ? ` @${next.assignee}` : "";
    await appendAutoLog(
      root,
      localToday(),
      "tracker",
      `${id} [${next.area} ${next.kind}${assignee}] "${next.title}" — status: ${prev} → ${nextStatus}`,
    );
  }

  return next;
}

// ── tracking edit-batch (v0.0.2) ──────────────────────────────────────────────

export interface EditTrackingBatchItem {
  id: string;
  kind?: TrackingKind;
  title?: string;
  area?: Area;
  assignee?: string | null;
  dueDate?: string | null;
  status?: TrackingStatus;
  note?: string;
}

export interface EditTrackingBatchResult {
  id: string;
  changes: Record<string, [unknown, unknown]>;
}

export async function editTrackingItemsBatch(
  root: string,
  items: EditTrackingBatchItem[],
): Promise<EditTrackingBatchResult[]> {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("editTrackingItemsBatch: empty or non-array input");
  }

  const editKeys = ["kind", "title", "area", "assignee", "dueDate", "status", "note"];
  const errors: { index: number; field: string; reason: string }[] = [];
  const knownAreas = new Set((await readAreas(root)).map((a) => a.id));
  items.forEach((it, i) => {
    if (!it?.id || typeof it.id !== "string") errors.push({ index: i, field: "id", reason: "required string" });
    if (it?.area != null && !knownAreas.has(it.area)) {
      errors.push({ index: i, field: "area", reason: `unknown area: ${it.area}` });
    }
    if (!editKeys.some((k) => Object.prototype.hasOwnProperty.call(it, k))) {
      errors.push({ index: i, field: "fields", reason: "at least one edit field required" });
    }
    if (it?.dueDate != null && !/^\d{4}-\d{2}-\d{2}$/.test(it.dueDate)) {
      errors.push({ index: i, field: "dueDate", reason: "expected YYYY-MM-DD" });
    }
  });
  if (errors.length > 0) throw new Error(`editTrackingItemsBatch validation: ${JSON.stringify(errors)}`);

  // Read tracking file once; validate all IDs exist.
  const allItems = await listTrackingItems(root);
  const byId = new Map(allItems.map((i) => [i.id, i]));
  items.forEach((it, i) => {
    if (!byId.has(it.id)) errors.push({ index: i, field: "id", reason: `tracking item not found: ${it.id}` });
  });
  if (errors.length > 0) throw new Error(`editTrackingItemsBatch: items not found: ${JSON.stringify(errors)}`);

  const ts = nowIso();
  const batchId = `b_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  // Build in-memory patches.
  const patches = new Map<string, TrackingItem>();
  const perItemChanges: Record<string, [unknown, unknown]>[] = [];
  for (const item of items) {
    const cur = byId.get(item.id)!;
    const changes: Record<string, [unknown, unknown]> = {};
    const next: TrackingItem = { ...cur, updatedAt: ts };
    for (const k of editKeys as (keyof EditTrackingInput)[]) {
      if ((item as any)[k] !== undefined && (item as any)[k] !== cur[k]) {
        changes[k] = [cur[k], (item as any)[k]];
        (next as any)[k] = (item as any)[k];
      }
    }
    patches.set(item.id, next);
    perItemChanges.push(changes);
  }

  // Single atomic write of the entire tracking file.
  await updateTracking(root, (f) => ({
    ...f,
    items: f.items.map((i) => patches.get(i.id) ?? i),
  }));

  // Per-item events with batchId + auto-log for status changes.
  const results: EditTrackingBatchResult[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    const changes = perItemChanges[i]!;
    const next = patches.get(item.id)!;
    if (Object.keys(changes).length > 0) {
      await appendEvent(root, { ts, type: "tracking.edited", itemId: item.id, changes, batchId });
      if (changes.status) {
        const [prev, nextStatus] = changes.status as [TrackingStatus, TrackingStatus];
        const assignee = next.assignee ? ` @${next.assignee}` : "";
        await appendAutoLog(
          root, localToday(), "tracker-batch",
          `${item.id} [${next.area} ${next.kind}${assignee}] "${next.title}" — status: ${prev} → ${nextStatus}`,
        );
      }
    }
    results.push({ id: item.id, changes });
  }
  return results;
}

export async function deleteTrackingItem(root: string, id: string): Promise<TrackingItem> {
  const cur = await findTrackingItem(root, id);
  if (!cur) throw new Error(`tracking item not found: ${id}`);
  await updateTracking(root, (f) => ({ ...f, items: f.items.filter((i) => i.id !== id) }));
  await appendEvent(root, { ts: nowIso(), type: "tracking.deleted", itemId: id, snapshot: cur });
  return cur;
}

export interface ListTrackingFilter {
  area?: Area;
  kind?: TrackingKind;
  assignee?: string | null;
  status?: TrackingStatus;
  dueBefore?: string;
  dueAfter?: string;
  notDone?: boolean;
}

export async function listTracking(
  root: string,
  filter: ListTrackingFilter = {},
): Promise<TrackingItem[]> {
  let items = await listTrackingItems(root);
  if (filter.area) items = items.filter((i) => i.area === filter.area);
  if (filter.kind) items = items.filter((i) => i.kind === filter.kind);
  if (filter.assignee !== undefined) items = items.filter((i) => i.assignee === filter.assignee);
  if (filter.status) items = items.filter((i) => i.status === filter.status);
  if (filter.dueBefore) items = items.filter((i) => i.dueDate !== null && i.dueDate < filter.dueBefore!);
  if (filter.dueAfter) items = items.filter((i) => i.dueDate !== null && i.dueDate > filter.dueAfter!);
  if (filter.notDone) items = items.filter((i) => i.status !== "done" && i.status !== "cancelled");
  return items;
}
