import type {
  ActiveSession,
  Area,
  AreaConfig,
  Board,
  CloseSessionResult,
  Column,
  DayViewPayload,
  FocusSession,
  OpenSessionResult,
  RecurringRule,
  Schedule,
  Task,
  TodayPayload,
  TrackingItem,
  TrackingKind,
  TrackingStatus,
} from "@second-brain/core";

interface FocusApi {
  get: () => Promise<FocusSession | null>;
  set: (session: FocusSession) => Promise<void>;
  clear: () => Promise<void>;
}

interface AreasApi {
  list: () => Promise<AreaConfig[]>;
}

interface BoardsApi {
  list: (area?: Area) => Promise<Board[]>;
  create: (input: { area: Area; name: string; isDefault?: boolean }) => Promise<Board>;
}

interface TaskWithBoard {
  task: Task;
  board: Board;
}

interface TasksApi {
  list: (filter?: { area?: Area; boardId?: string; column?: Column; dueBefore?: string }) => Promise<TaskWithBoard[]>;
  show: (id: string) => Promise<TaskWithBoard | null>;
  create: (input: {
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
  }) => Promise<{ task: Task; boardId: string }>;
  edit: (
    id: string,
    input: {
      title?: string;
      description?: string;
      dueDate?: string | null;
      plannedDate?: string | null;
      parentGoalRef?: string | null;
      priority?: number;
      note?: string | null;
      area?: Area;
      boardId?: string;
    },
  ) => Promise<TaskWithBoard>;
  move: (id: string, to: Column) => Promise<TaskWithBoard>;
  reschedule: (
    id: string,
    toDate: string,
    reason?: string | null,
  ) => Promise<{
    task: Task;
    board: Board;
    fromPlanned: string | null;
    toPlanned: string;
    fromColumn: Column;
  }>;
  delete: (id: string) => Promise<Task>;
}

interface TrackingApi {
  list: (filter?: {
    area?: Area;
    kind?: TrackingKind;
    assignee?: string | null;
    status?: TrackingStatus;
    dueBefore?: string;
    dueAfter?: string;
    notDone?: boolean;
  }) => Promise<TrackingItem[]>;
  create: (input: {
    kind: TrackingKind;
    area: Area;
    title: string;
    assignee?: string | null;
    dueDate?: string | null;
    status?: TrackingStatus;
    note?: string;
  }) => Promise<TrackingItem>;
  edit: (
    id: string,
    input: {
      kind?: TrackingKind;
      area?: Area;
      title?: string;
      assignee?: string | null;
      dueDate?: string | null;
      status?: TrackingStatus;
      note?: string;
    },
  ) => Promise<TrackingItem>;
  delete: (id: string) => Promise<TrackingItem>;
}

interface RecurringApi {
  list: (area?: Area) => Promise<RecurringRule[]>;
  create: (input: {
    area: Area;
    title: string;
    description?: string;
    schedule: Schedule;
    startsOn?: string;
    endsOn?: string | null;
    parentGoalRef?: string | null;
    boardId?: string | null;
  }) => Promise<RecurringRule>;
  delete: (id: string) => Promise<RecurringRule>;
  toggle: (id: string) => Promise<RecurringRule>;
  done: (id: string, date?: string) => Promise<void>;
  skip: (id: string, date?: string, reason?: string) => Promise<void>;
  reschedule: (id: string, from: string, to: string, reason?: string) => Promise<void>;
}

declare global {
  interface Window {
    api: {
      init: () => Promise<{ root: string }>;
      areas: AreasApi;
      boards: BoardsApi;
      tasks: TasksApi;
      recurring: RecurringApi;
      today: ((date?: string) => Promise<TodayPayload>) & {
        trigger: (date?: string) => Promise<void>;
      };
      session: {
        active: () => Promise<ActiveSession | null>;
        close: () => Promise<CloseSessionResult | null>;
        ensure: () => Promise<OpenSessionResult>;
      };
      day: {
        view: (date: string) => Promise<DayViewPayload>;
      };
      notes: {
        read: (date: string, archive?: boolean) => Promise<string | null>;
        append: (date: string, text: string) => Promise<void>;
        write: (date: string, content: string) => Promise<void>;
        autolog: (date: string, source: string, message: string) => Promise<void>;
        archive: (date: string) => Promise<{ archived: boolean; path?: string }>;
        listArchive: () => Promise<string[]>;
      };
      focus: FocusApi;
      tracking: TrackingApi;
      openObsidian: (ref: string) => Promise<void>;
      openExternal: (url: string) => Promise<void>;
      onStorageChanged: (cb: (info: { eventType: string; filePath: string }) => void) => () => void;
    };
  }
}

export {};
