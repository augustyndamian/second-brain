import { z } from "zod";

export const SCHEMA_VERSION = 4;

/**
 * Areas are user-configurable (see storage/areas.ts) — this schema only enforces
 * the id format. Reads stay permissive; mutations are validated against the
 * configured area list via assertValidArea() in the services layer.
 */
export const AreaSchema = z.string().min(1).regex(/^[a-z][a-z0-9-]*$/);
export type Area = z.infer<typeof AreaSchema>;

export const ColumnSchema = z.enum(["todo", "doing", "done"]);
export type Column = z.infer<typeof ColumnSchema>;

export const WeekdaySchema = z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);
export type Weekday = z.infer<typeof WeekdaySchema>;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
const isoTs = z.string().datetime({ offset: true });

export const TaskSchema = z.object({
  id: z.string(),
  title: z.string().min(1),
  description: z.string().default(""),
  column: ColumnSchema,
  dueDate: isoDate.nullable().default(null),
  plannedDate: isoDate.nullable().default(null),
  parentGoalRef: z.string().nullable().default(null),
  priority: z.number().int().min(1).max(10).default(5),
  note: z.string().nullable().default(null),
  createdAt: isoTs,
  updatedAt: isoTs,
  completedAt: isoTs.nullable().default(null),
  completedSessionDate: isoDate.nullable().default(null),
});
export type Task = z.infer<typeof TaskSchema>;

export const BoardSchema = z.object({
  id: z.string(),
  area: AreaSchema,
  name: z.string().min(1),
  isDefault: z.boolean().default(false),
  createdAt: isoTs,
  tasks: z.array(TaskSchema).default([]),
});
export type Board = z.infer<typeof BoardSchema>;

export const ScheduleSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("daily") }),
  z.object({ type: z.literal("weekdays") }),
  z.object({ type: z.literal("weekly"), daysOfWeek: z.array(WeekdaySchema).min(1) }),
  z.object({ type: z.literal("interval"), everyNDays: z.number().int().positive() }),
  z.object({ type: z.literal("monthly"), dayOfMonth: z.number().int().min(1).max(31) }),
]);
export type Schedule = z.infer<typeof ScheduleSchema>;

export const RecurringRuleSchema = z.object({
  id: z.string(),
  area: AreaSchema,
  boardId: z.string().nullable().default(null),
  title: z.string().min(1),
  description: z.string().default(""),
  parentGoalRef: z.string().nullable().default(null),
  schedule: ScheduleSchema,
  startsOn: isoDate,
  endsOn: isoDate.nullable().default(null),
  active: z.boolean().default(true),
  points: z.number().int().default(1),
  createdAt: isoTs,
});
export type RecurringRule = z.infer<typeof RecurringRuleSchema>;

export const MetaSchema = z.object({
  schemaVersion: z.number().int().positive(),
  nextTaskId: z.number().int().nonnegative(),
  nextBoardId: z.number().int().nonnegative(),
  nextRuleId: z.number().int().nonnegative(),
  /** Per-area task counters, keyed by area id. Replaces the fixed nextTaskId* fields (schema v3). */
  taskCounters: z.record(z.string(), z.number().int().nonnegative()).default({}),
  nextTrackingId: z.number().int().nonnegative().default(1),
});
export type Meta = z.infer<typeof MetaSchema>;

export const TrackingKindSchema = z.enum(["commitment", "event", "external-task"]);
export type TrackingKind = z.infer<typeof TrackingKindSchema>;

export const TrackingStatusSchema = z.enum(["todo", "in-progress", "done", "cancelled"]);
export type TrackingStatus = z.infer<typeof TrackingStatusSchema>;

export const TrackingItemSchema = z.object({
  id: z.string(),
  kind: TrackingKindSchema,
  title: z.string().min(1),
  area: AreaSchema,
  assignee: z.string().nullable().default(null),
  dueDate: isoDate.nullable().default(null),
  status: TrackingStatusSchema.default("todo"),
  note: z.string().default(""),
  createdAt: isoTs,
  updatedAt: isoTs,
});
export type TrackingItem = z.infer<typeof TrackingItemSchema>;

export const TrackingFileSchema = z.object({
  schemaVersion: z.number().int().positive(),
  items: z.array(TrackingItemSchema).default([]),
});
export type TrackingFile = z.infer<typeof TrackingFileSchema>;

export const RecurringFileSchema = z.object({
  schemaVersion: z.number().int().positive(),
  rules: z.array(RecurringRuleSchema).default([]),
});
export type RecurringFile = z.infer<typeof RecurringFileSchema>;

export const ActiveSessionStatusSchema = z.enum(["open", "closed", "auto-closed"]);
export type ActiveSessionStatus = z.infer<typeof ActiveSessionStatusSchema>;

export const ActiveSessionSchema = z.object({
  schemaVersion: z.literal(1),
  date: isoDate,
  startedAt: isoTs,
  closedAt: isoTs.nullable().default(null),
  status: ActiveSessionStatusSchema,
  anchoredTaskIds: z.array(z.string()).default([]),
});
export type ActiveSession = z.infer<typeof ActiveSessionSchema>;

export const FocusRefSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("task"), id: z.string() }),
  z.object({ kind: z.literal("recurring"), ruleId: z.string(), date: isoDate }),
]);
export type FocusRef = z.infer<typeof FocusRefSchema>;

export const FocusDurationSchema = z.union([
  z.literal(5),
  z.literal(10),
  z.literal(15),
  z.literal(30),
  z.literal(60),
]);
export type FocusDuration = z.infer<typeof FocusDurationSchema>;

export const FocusSessionSchema = z.object({
  schemaVersion: z.literal(1),
  date: isoDate,
  ref: FocusRefSchema,
  area: AreaSchema,
  title: z.string(),
  description: z.string().default(""),
  durationMin: FocusDurationSchema,
  startedAt: isoTs,
  pausedAt: isoTs.nullable().default(null),
  accumulatedPausedMs: z.number().int().nonnegative().default(0),
});
export type FocusSession = z.infer<typeof FocusSessionSchema>;

export const EventSchema = z.discriminatedUnion("type", [
  z.object({ ts: isoTs, type: z.literal("task.created"), taskId: z.string(), boardId: z.string(), snapshot: TaskSchema }),
  z.object({ ts: isoTs, type: z.literal("task.edited"), taskId: z.string(), boardId: z.string(), changes: z.record(z.tuple([z.unknown(), z.unknown()])), batchId: z.string().optional() }),
  z.object({ ts: isoTs, type: z.literal("task.moved"), taskId: z.string(), boardId: z.string(), from: ColumnSchema, to: ColumnSchema, batchId: z.string().optional() }),
  z.object({ ts: isoTs, type: z.literal("task.deleted"), taskId: z.string(), boardId: z.string(), snapshot: TaskSchema }),
  z.object({
    ts: isoTs,
    type: z.literal("task.rescheduled"),
    taskId: z.string(),
    boardId: z.string(),
    fromPlanned: isoDate.nullable(),
    toPlanned: isoDate,
    fromColumn: ColumnSchema,
    sessionDate: isoDate.nullable().default(null),
    reason: z.string().nullable().default(null),
    batchId: z.string().optional(),
  }),
  z.object({ ts: isoTs, type: z.literal("board.created"), boardId: z.string(), snapshot: BoardSchema }),
  z.object({ ts: isoTs, type: z.literal("recurring.created"), ruleId: z.string(), snapshot: RecurringRuleSchema }),
  z.object({ ts: isoTs, type: z.literal("recurring.edited"), ruleId: z.string(), changes: z.record(z.tuple([z.unknown(), z.unknown()])) }),
  z.object({ ts: isoTs, type: z.literal("recurring.deleted"), ruleId: z.string(), snapshot: RecurringRuleSchema }),
  z.object({ ts: isoTs, type: z.literal("recurring.toggled"), ruleId: z.string(), active: z.boolean() }),
  z.object({ ts: isoTs, type: z.literal("recurring.done"), ruleId: z.string(), forDate: isoDate }),
  z.object({ ts: isoTs, type: z.literal("recurring.skipped"), ruleId: z.string(), forDate: isoDate, reason: z.string().nullable().default(null) }),
  z.object({ ts: isoTs, type: z.literal("recurring.rescheduled"), ruleId: z.string(), fromDate: isoDate, toDate: isoDate, reason: z.string().nullable().default(null) }),
  z.object({ ts: isoTs, type: z.literal("tracking.created"), itemId: z.string(), snapshot: TrackingItemSchema }),
  z.object({ ts: isoTs, type: z.literal("tracking.edited"), itemId: z.string(), changes: z.record(z.tuple([z.unknown(), z.unknown()])), batchId: z.string().optional() }),
  z.object({ ts: isoTs, type: z.literal("tracking.deleted"), itemId: z.string(), snapshot: TrackingItemSchema }),
  z.object({
    ts: isoTs,
    type: z.literal("session.opened"),
    date: isoDate,
    startedAt: isoTs,
    autoClosedPrev: z.string().nullable().default(null),
  }),
  z.object({
    ts: isoTs,
    type: z.literal("session.closed"),
    date: isoDate,
    startedAt: isoTs,
    closedAt: isoTs,
    status: z.enum(["closed", "auto-closed"]),
    missedCount: z.number().int(),
    doingCount: z.number().int(),
  }),
]);
export type Event = z.infer<typeof EventSchema>;
