import { useEffect, useRef, useState } from "react";
import {
  DndContext,
  PointerSensor,
  useDraggable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import type { ActiveSession, Area, DayViewPayload, FocusDuration, FocusRef, FocusSession, Task, TodayPayload, TodayRecurringItem, TodayTaskItem } from "@second-brain/core";
import { useAreas } from "../areas-context";
import { TaskEditModal } from "../components/TaskEditModal";
import { FocusPanel } from "../components/FocusPanel";
import { PomodoroPicker } from "../components/PomodoroPicker";
import { Modal, Button } from "../components/Modal";
import { DatePicker } from "../components/DatePicker";

type SubTab = "tasks" | "recurring" | "notes";

export function TodayView({ reloadKey }: { reloadKey: number }) {
  const { areas } = useAreas();
  const [subTab, setSubTab] = useState<SubTab>("tasks");
  const [payload, setPayload] = useState<TodayPayload | null>(null);
  const [doneTasks, setDoneTasks] = useState<TodayTaskItem[]>([]);
  const [addTaskOpen, setAddTaskOpen] = useState(false);
  const [detailTask, setDetailTask] = useState<{ task: Task; area: Area; boardId: string } | null>(null);
  const [focus, setFocus] = useState<FocusSession | null>(null);
  const [pickerFor, setPickerFor] = useState<{ ref: FocusRef; title: string; description: string; area: Area } | null>(null);
  const [confirmSwitch, setConfirmSwitch] = useState<{ ref: FocusRef; title: string; description: string; area: Area; duration: FocusDuration } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [activeSession, setActiveSession] = useState<ActiveSession | null>(null);
  const [viewDate, setViewDate] = useState<string | null>(null);
  const [pastView, setPastView] = useState<DayViewPayload | null>(null);
  const [autoCloseInfo, setAutoCloseInfo] = useState<{ date: string; hoursOpen: number; missedCount: number } | null>(null);
  const [autoCloseDismissed, setAutoCloseDismissed] = useState(false);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const datePickerRef = useRef<HTMLDivElement | null>(null);

  const [notesContent, setNotesContent] = useState<string>("");
  const [notesQuickAdd, setNotesQuickAdd] = useState<string>("");
  const [notesSaveStatus, setNotesSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const notesDirtyRef = useRef(false);
  const notesSaveTimeoutRef = useRef<number | null>(null);
  const lastLoadedNotesDateRef = useRef<string | null>(null);

  const [loadError, setLoadError] = useState<string | null>(null);

  const [areaFilter, setAreaFilter] = useState<Area | "all">("all");
  const [prioritySort, setPrioritySort] = useState<"high" | "low">("high");

  // Drag-drop sensors must be declared before any early return (Rules of Hooks).
  const dragSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  // Initial: ensure session + load active day
  useEffect(() => {
    (async () => {
      try {
        const p: TodayPayload = await window.api.today();
        setPayload(p);
        setDoneTasks(p.doneTasks ?? []);
        try {
          const active = await window.api.session.active();
          setActiveSession(active);
          const targetDate = active?.date ?? p.date;
          setViewDate((cur) => cur ?? targetDate);
        } catch (e) {
          // Fallback: session API not available — anchor on payload.date
          console.warn("[TodayView] session.active failed; falling back to payload.date", e);
          setActiveSession(null);
          setViewDate((cur) => cur ?? p.date);
        }
        if (p.autoClosed && !autoCloseDismissed) setAutoCloseInfo(p.autoClosed);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[TodayView] today() failed:", e);
        setLoadError(msg);
      }
    })();
    window.api.focus.get().then((f: FocusSession | null) => setFocus(f)).catch(() => {});
  }, [reloadKey]);

  // When viewDate diverges from anchor date → fetch dayView
  useEffect(() => {
    if (!viewDate || !payload) return;
    const anchor = activeSession?.date ?? payload.date;
    if (viewDate === anchor) {
      setPastView(null);
      return;
    }
    window.api.day.view(viewDate).then((dv: DayViewPayload) => setPastView(dv)).catch((e) => {
      console.warn("[TodayView] day.view failed", e);
    });
  }, [viewDate, activeSession, payload, reloadKey]);

  // Click-outside for date picker
  useEffect(() => {
    if (!datePickerOpen) return;
    const onClick = (e: MouseEvent) => {
      if (datePickerRef.current && !datePickerRef.current.contains(e.target as Node)) {
        setDatePickerOpen(false);
      }
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [datePickerOpen]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(id);
  }, [toast]);

  const handleCheckTask = async (task: TodayTaskItem) => {
    await window.api.tasks.move(task.id, "done");
    setPayload((prev) => prev ? {
      ...prev,
      tasks: prev.tasks.filter((t) => t.id !== task.id),
      overdue: prev.overdue.filter((t) => t.id !== task.id),
    } : prev);
    setDoneTasks((prev) => {
      if (prev.some((t) => t.id === task.id)) return prev;
      return [...prev, { ...task, column: "done" }];
    });
  };

  const handleUncheckTask = async (task: TodayTaskItem) => {
    await window.api.tasks.move(task.id, "doing");
    setDoneTasks((prev) => prev.filter((t) => t.id !== task.id));
    setPayload((prev) => prev ? { ...prev, tasks: [...prev.tasks, { ...task, column: "doing" }] } : prev);
  };

  const handleCheckRecurring = async (item: TodayRecurringItem) => {
    await window.api.recurring.done(item.ruleId);
    setPayload((prev) => prev ? {
      ...prev,
      recurring: prev.recurring.filter((r) => r.ruleId !== item.ruleId),
      recurringDone: [...(prev.recurringDone ?? []), { ...item, status: "done" }],
    } : prev);
  };

  const handleStartFocusForTask = async (t: TodayTaskItem) => {
    const result = await window.api.tasks.show(t.id);
    const description = result?.task?.description ?? "";
    openPicker({ kind: "task", id: t.id }, t.title, description, t.area);
  };

  const handleStartFocusForRecurring = (r: TodayRecurringItem) => {
    if (!payload) return;
    openPicker({ kind: "recurring", ruleId: r.ruleId, date: payload.date }, r.title, "", r.area);
  };

  const openPicker = (ref: FocusRef, title: string, description: string, area: Area) => {
    setPickerFor({ ref, title, description, area });
  };

  const startFocusSession = async (ref: FocusRef, title: string, description: string, area: Area, durationMin: FocusDuration) => {
    if (!payload) return;
    const session: FocusSession = {
      schemaVersion: 1,
      date: payload.date,
      ref,
      area,
      title,
      description,
      durationMin,
      startedAt: new Date().toISOString(),
      pausedAt: null,
      accumulatedPausedMs: 0,
    };
    await window.api.focus.set(session);
    setFocus(session);
  };

  const handlePickDuration = async (durationMin: FocusDuration) => {
    if (!pickerFor) return;
    const next = pickerFor;
    setPickerFor(null);
    if (focus) {
      setConfirmSwitch({ ...next, duration: durationMin });
      return;
    }
    await startFocusSession(next.ref, next.title, next.description, next.area, durationMin);
  };

  const handleConfirmSwitch = async () => {
    if (!confirmSwitch) return;
    const c = confirmSwitch;
    setConfirmSwitch(null);
    await startFocusSession(c.ref, c.title, c.description, c.area, c.duration);
  };

  const handleFocusDone = async () => {
    if (!focus) return;
    const minutesFocused = Math.max(1, Math.round((Date.now() - Date.parse(focus.startedAt) - focus.accumulatedPausedMs) / 60_000));
    if (focus.ref.kind === "task") {
      await window.api.tasks.move(focus.ref.id, "done");
      const taskId = focus.ref.id;
      setPayload((prev) => prev ? {
        ...prev,
        tasks: prev.tasks.filter((t) => t.id !== taskId),
        overdue: prev.overdue.filter((t) => t.id !== taskId),
      } : prev);
    } else {
      await window.api.recurring.done(focus.ref.ruleId);
      const ruleId = focus.ref.ruleId;
      setPayload((prev) => prev ? {
        ...prev,
        recurring: prev.recurring.filter((r) => r.ruleId !== ruleId),
      } : prev);
    }
    await window.api.focus.clear();
    setFocus(null);
    setToast(`✓ Focused for ${minutesFocused} min`);
  };

  const handleFocusStop = async () => {
    if (!focus) return;
    await window.api.focus.clear();
    setFocus(null);
  };

  const handleFocusPauseToggle = async () => {
    if (!focus) return;
    const now = new Date().toISOString();
    const next: FocusSession = focus.pausedAt
      ? { ...focus, pausedAt: null, accumulatedPausedMs: focus.accumulatedPausedMs + (Date.now() - Date.parse(focus.pausedAt)) }
      : { ...focus, pausedAt: now };
    await window.api.focus.set(next);
    setFocus(next);
  };

  useEffect(() => {
    if (!focus) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const inField = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
      if (inField) return;
      if (pickerFor || confirmSwitch || addTaskOpen || detailTask) return;
      if (e.key === "Escape") { e.preventDefault(); handleFocusStop(); }
      else if (e.code === "Space") { e.preventDefault(); handleFocusDone(); }
      else if (e.code === "KeyP") { e.preventDefault(); handleFocusPauseToggle(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focus, pickerFor, confirmSwitch, addTaskOpen, detailTask]);

  // Load notes whenever the visible date changes (active or past).
  useEffect(() => {
    if (!viewDate) return;
    // Don't clobber user's in-flight edits on the SAME date when storage echoes back.
    if (notesDirtyRef.current && lastLoadedNotesDateRef.current === viewDate) return;
    let cancelled = false;
    (async () => {
      try {
        const isViewingActiveLocal = viewDate === (activeSession?.date ?? payload?.date);
        // For past closed sessions, prefer archive/ if it exists.
        let content: string | null = null;
        if (!isViewingActiveLocal) {
          content = await window.api.notes.read(viewDate, true);
        }
        if (content == null) {
          content = await window.api.notes.read(viewDate, false);
        }
        if (cancelled) return;
        setNotesContent(content ?? "");
        notesDirtyRef.current = false;
        setNotesSaveStatus("idle");
        lastLoadedNotesDateRef.current = viewDate;
      } catch (e) {
        console.error("notes load failed:", e);
      }
    })();
    return () => { cancelled = true; };
  }, [viewDate, activeSession?.date, payload?.date, reloadKey]);

  // Autosave notes (debounced 600ms) — only for active day.
  useEffect(() => {
    if (!viewDate) return;
    if (!notesDirtyRef.current) return;
    if (lastLoadedNotesDateRef.current !== viewDate) return;
    const isViewingActiveLocal = viewDate === (activeSession?.date ?? payload?.date);
    if (!isViewingActiveLocal) return; // past days are read-only
    setNotesSaveStatus("saving");
    if (notesSaveTimeoutRef.current != null) {
      window.clearTimeout(notesSaveTimeoutRef.current);
    }
    notesSaveTimeoutRef.current = window.setTimeout(async () => {
      try {
        await window.api.notes.write(viewDate, notesContent);
        notesDirtyRef.current = false;
        setNotesSaveStatus("saved");
        window.setTimeout(() => setNotesSaveStatus("idle"), 1200);
      } catch (e) {
        console.error("notes write failed:", e);
        setNotesSaveStatus("idle");
      }
    }, 600);
    return () => {
      if (notesSaveTimeoutRef.current != null) {
        window.clearTimeout(notesSaveTimeoutRef.current);
      }
    };
  }, [notesContent, viewDate, activeSession?.date, payload?.date]);

  const handleNotesQuickAdd = async () => {
    if (!viewDate) return;
    const text = notesQuickAdd.trim();
    if (!text) return;
    const isViewingActiveLocal = viewDate === (activeSession?.date ?? payload?.date);
    if (!isViewingActiveLocal) return;
    try {
      await window.api.notes.append(viewDate, text);
      setNotesQuickAdd("");
      // Re-read to pick up the new auto-timestamped block.
      const fresh = await window.api.notes.read(viewDate, false);
      setNotesContent(fresh ?? "");
      notesDirtyRef.current = false;
    } catch (e) {
      console.error("notes append failed:", e);
    }
  };

  const isFocusedItem = (ref: FocusRef): boolean => {
    if (!focus) return false;
    if (focus.ref.kind !== ref.kind) return false;
    if (focus.ref.kind === "task" && ref.kind === "task") return focus.ref.id === ref.id;
    if (focus.ref.kind === "recurring" && ref.kind === "recurring") return focus.ref.ruleId === ref.ruleId;
    return false;
  };

  const handleOpenTask = async (id: string) => {
    const result = await window.api.tasks.show(id);
    if (result) setDetailTask({ task: result.task, area: result.board.area, boardId: result.board.id });
  };

  if (loadError) return (
    <div className="p-8 text-red-400">
      <div className="font-semibold mb-2">Failed to load Today</div>
      <pre className="text-xs whitespace-pre-wrap text-red-300">{loadError}</pre>
    </div>
  );
  if (!payload || !viewDate) return <div className="p-8 text-slate-400">Loading...</div>;

  const anchorDate = activeSession?.date ?? payload.date;
  const isViewingActive = viewDate === anchorDate;
  const displayDate = viewDate;
  const date = new Date(displayDate + "T12:00:00");
  const dateStr = date.toLocaleDateString("pl-PL", { weekday: "long", year: "numeric", month: "long", day: "numeric" });

  const todoTasks = isViewingActive
    ? [...payload.tasks, ...payload.overdue]
        .filter((t) => areaFilter === "all" || t.area === areaFilter)
        .sort((a, b) =>
          prioritySort === "high"
            ? (b.priority ?? 5) - (a.priority ?? 5)
            : (a.priority ?? 5) - (b.priority ?? 5),
        )
    : [];
  const recurringForView = isViewingActive ? payload.recurring : (pastView?.recurring ?? []).map((r) => ({
    ruleId: r.ruleId,
    title: r.title,
    area: r.area,
    boardId: null,
    status: (r.status === "missed" ? "skipped" : r.status) as "pending" | "done" | "skipped",
    reason: null,
  })) as TodayRecurringItem[];
  const doneTasksForView = isViewingActive ? doneTasks : (pastView?.doneTasks ?? []).map((t) => ({
    id: t.id,
    title: t.title,
    area: t.area,
    boardId: t.boardId,
    column: t.column,
    dueDate: t.dueDate,
    parentGoalRef: null,
    note: null,
  })) as TodayTaskItem[];
  const pastDoingTasks: TodayTaskItem[] = (!isViewingActive && pastView)
    ? pastView.doingTasks.map((t) => ({
      id: t.id,
      title: t.title,
      area: t.area,
      boardId: t.boardId,
      column: t.column,
      dueDate: t.dueDate,
      parentGoalRef: null,
      priority: (t as any).priority ?? 5,
      note: null,
    }))
    : [];
  const pastEmpty = !isViewingActive && pastView?.state === "empty";
  const pastFuture = !isViewingActive && pastView?.state === "future";
  const pastClosed = !isViewingActive && (pastView?.state === "closed" || pastView?.state === "auto-closed");
  const futurePlannedTasks: TodayTaskItem[] = pastFuture
    ? (pastView?.plannedTasks ?? []).map((t) => ({
      id: t.id,
      title: t.title,
      area: t.area,
      boardId: t.boardId,
      column: t.column,
      dueDate: t.dueDate,
      parentGoalRef: null,
      priority: (t as any).priority ?? 5,
      note: null,
    }))
    : [];
  const futureDueOnlyTasks: TodayTaskItem[] = pastFuture
    ? (pastView?.dueOnlyTasks ?? []).map((t) => ({
      id: t.id,
      title: t.title,
      area: t.area,
      boardId: t.boardId,
      column: t.column,
      dueDate: t.dueDate,
      parentGoalRef: null,
      priority: (t as any).priority ?? 5,
      note: null,
    }))
    : [];

  const onDragEnd = async (e: DragEndEvent) => {
    const overId = e.over?.id as string | undefined;
    if (!overId || !overId.startsWith("date:")) return;
    const activeId = e.active.id as string;
    if (!activeId.startsWith("task:")) return;
    const taskId = activeId.slice("task:".length);
    if (!taskId || taskId === "_none_") return;
    const iso = overId.slice("date:".length);
    try {
      await window.api.tasks.reschedule(taskId, iso, "drag-drop in date picker");
    } catch (err) {
      console.error("reschedule via drag failed:", err);
    }
  };

  return (
    <DndContext sensors={dragSensors} onDragEnd={onDragEnd}>
    <div className="flex flex-col h-full">
      {autoCloseInfo && !autoCloseDismissed && (
        <div className="px-6 py-2 bg-amber-900/30 border-b border-amber-700/40 flex items-center gap-3 text-sm">
          <span className="text-amber-300">⚠️</span>
          <span className="text-amber-100">
            Session {autoCloseInfo.date} was auto-closed after {autoCloseInfo.hoursOpen}h
            ({autoCloseInfo.missedCount} recurring marked as missed).
          </span>
          <button
            onClick={() => setAutoCloseDismissed(true)}
            className="ml-auto text-amber-300 hover:text-white text-xs px-2 py-1 rounded hover:bg-amber-800/40"
          >
            OK
          </button>
        </div>
      )}
      {!isViewingActive && (
        <div className="px-6 py-2 bg-slate-800/60 border-b border-slate-700 flex items-center gap-3 text-sm">
          <span className="text-slate-400">
            📅 Viewing {
              pastView?.state === "empty" ? "a day with no session"
              : pastView?.state === "future" ? "a future day (session not opened yet)"
              : "a closed session"
            }.
          </span>
          {activeSession && (
            <button
              onClick={() => setViewDate(activeSession.date)}
              className="ml-auto text-blue-400 hover:text-blue-300 text-xs"
            >
              ← back to today ({activeSession.date})
            </button>
          )}
        </div>
      )}
      <div className="flex border-b border-slate-700">
        <div className="flex-1 px-6 py-4 border-r border-slate-700 min-w-0">
          <div className="text-xs text-slate-500 uppercase tracking-wider mb-1">
            {isViewingActive ? "Today" : "Day"}
          </div>
          <div className="relative inline-block" ref={datePickerRef}>
            <button
              onClick={() => setDatePickerOpen((o) => !o)}
              className="text-lg font-semibold capitalize hover:text-blue-300 transition-colors flex items-center gap-2"
            >
              {dateStr}
              <span className="text-xs text-slate-500">▾</span>
            </button>
            {datePickerOpen && (
              <DatePicker
                value={viewDate}
                activeDate={activeSession?.date ?? null}
                onPick={(d) => setViewDate(d)}
                onClose={() => setDatePickerOpen(false)}
              />
            )}
          </div>
          <div className="flex gap-2 mt-3">
            <SubTabButton active={subTab === "tasks"} onClick={() => setSubTab("tasks")}>
              Tasks {(isViewingActive ? todoTasks.length : pastDoingTasks.length) > 0 && <span className="ml-1 text-xs bg-slate-700 px-1.5 rounded-full">{isViewingActive ? todoTasks.length : pastDoingTasks.length}</span>}
            </SubTabButton>
            <SubTabButton active={subTab === "recurring"} onClick={() => setSubTab("recurring")}>
              Recurring {recurringForView.length > 0 && <span className="ml-1 text-xs bg-slate-700 px-1.5 rounded-full">{recurringForView.length}</span>}
            </SubTabButton>
            <SubTabButton active={subTab === "notes"} onClick={() => setSubTab("notes")}>
              Notes
            </SubTabButton>
          </div>
        </div>
        <div className="flex-1 px-6 py-4 min-w-0">
          <FocusPanel
            session={focus}
            onDone={handleFocusDone}
            onStop={handleFocusStop}
            onPauseToggle={handleFocusPauseToggle}
          />
        </div>
      </div>

      <div className="flex-1 overflow-auto px-6 py-4">
        {!isViewingActive && pastEmpty && subTab !== "notes" && (
          <div className="text-center py-12 text-slate-500">
            <div className="text-4xl mb-3">📭</div>
            <div className="text-sm mb-2">No session on this day.</div>
            <div className="text-xs text-slate-600">
              /today-morning was not run on this day. You can mark recurring instances (if any) in the per-area views.
            </div>
          </div>
        )}
        {!isViewingActive && pastFuture && (
          <div className="space-y-6">
            {subTab === "tasks" && (
              <>
                <Section title={`📌 Planned for ${viewDate}`} count={futurePlannedTasks.length}>
                  {futurePlannedTasks.length === 0
                    ? <Empty>No tasks planned for this day.</Empty>
                    : futurePlannedTasks.map((t) => (
                      <CheckItem
                        key={t.id}
                        taskId={t.id}
                        displayId={t.id}
                        label={t.title}
                        area={t.area}
                        onCheck={() => {/* future — session not active yet */}}
                        onOpen={() => handleOpenTask(t.id)}
                      />
                    ))}
                </Section>
                <Section title={`⏰ Due that day (deadline, not planned)`} count={futureDueOnlyTasks.length}>
                  {futureDueOnlyTasks.length === 0
                    ? <Empty>—</Empty>
                    : futureDueOnlyTasks.map((t) => (
                      <CheckItem
                        key={t.id}
                        taskId={t.id}
                        displayId={t.id}
                        label={`${t.title}  ·  due ${t.dueDate}`}
                        area={t.area}
                        onCheck={() => {/* read-only */}}
                        onOpen={() => handleOpenTask(t.id)}
                      />
                    ))}
                </Section>
              </>
            )}
            {subTab === "recurring" && (
              <Section title={`Recurring (${viewDate})`} count={recurringForView.length}>
                {recurringForView.length === 0
                  ? <Empty>No recurring items for this day.</Empty>
                  : recurringForView.map((r) => (
                    <CheckItem
                      key={r.ruleId}
                      label={r.title}
                      area={r.area}
                      checked={r.status === "done"}
                      tag={r.status === "skipped" ? "missed" : undefined}
                      readOnly
                      onCheck={() => {}}
                    />
                  ))}
              </Section>
            )}
          </div>
        )}
        {!isViewingActive && pastClosed && (
          <div className="space-y-6">
            {subTab === "tasks" && (
              <>
                <Section title="Doing (snapshot)" count={pastDoingTasks.length}>
                  {pastDoingTasks.length === 0
                    ? <Empty>—</Empty>
                    : pastDoingTasks.map((t) => (
                      <CheckItem
                        key={t.id}
                        displayId={t.id}
                        label={t.title}
                        area={t.area}
                        onCheck={() => {/* read-only past doing */}}
                        onOpen={() => handleOpenTask(t.id)}
                      />
                    ))}
                </Section>
                <Section title="Done" count={doneTasksForView.length}>
                  {doneTasksForView.length === 0
                    ? <Empty>—</Empty>
                    : doneTasksForView.map((t) => (
                      <CheckItem
                        key={t.id}
                        displayId={t.id}
                        label={t.title}
                        area={t.area}
                        checked
                        onCheck={() => {/* past — read-only */}}
                        onOpen={() => handleOpenTask(t.id)}
                      />
                    ))}
                </Section>
              </>
            )}
            {subTab === "recurring" && (
              <Section title={`Recurring (${viewDate})`} count={recurringForView.length}>
                {recurringForView.length === 0
                  ? <Empty>No recurring items for this day.</Empty>
                  : recurringForView.map((r) => (
                    <CheckItem
                      key={r.ruleId}
                      label={r.title}
                      area={r.area}
                      checked={r.status === "done"}
                      tag={r.status === "skipped" ? "missed" : undefined}
                      readOnly
                      onCheck={() => {}}
                    />
                  ))}
              </Section>
            )}
          </div>
        )}
        {isViewingActive && subTab === "tasks" && (
          <div className="space-y-6">
            <Section
              title="To Do"
              count={todoTasks.length}
              action={
                <div className="flex items-center gap-2">
                  <select
                    value={areaFilter}
                    onChange={(e) => setAreaFilter(e.target.value as Area | "all")}
                    className="bg-slate-800 border border-slate-700 rounded px-2 py-0.5 text-xs focus:outline-none focus:border-blue-500"
                  >
                    <option value="all">All areas</option>
                    {areas.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.emoji} {a.label}
                      </option>
                    ))}
                  </select>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setPrioritySort("high")}
                      className={`px-1.5 py-0.5 rounded text-[10px] transition-colors ${prioritySort === "high" ? "bg-blue-600 text-white" : "bg-slate-700 hover:bg-slate-600"}`}
                      title="Priority: highest first"
                    >
                      ↓ Prio
                    </button>
                    <button
                      onClick={() => setPrioritySort("low")}
                      className={`px-1.5 py-0.5 rounded text-[10px] transition-colors ${prioritySort === "low" ? "bg-blue-600 text-white" : "bg-slate-700 hover:bg-slate-600"}`}
                      title="Priority: lowest first"
                    >
                      ↑ Prio
                    </button>
                  </div>
                  <button
                    onClick={() => setAddTaskOpen(true)}
                    className="text-xs text-slate-400 hover:text-white px-2 py-0.5 rounded hover:bg-slate-700 transition-colors"
                  >
                    + Add task
                  </button>
                </div>
              }
            >
              {todoTasks.length === 0
                ? <Empty>Nothing for today. Move tasks to "Doing" on the kanban board.</Empty>
                : todoTasks.map((t) => (
                  <CheckItem
                    key={t.id}
                    taskId={t.id}
                    displayId={t.id}
                    label={t.title}
                    area={t.area}
                    tag={(t as any).daysOverdue ? `overdue ${(t as any).daysOverdue}d` : undefined}
                    onCheck={() => handleCheckTask(t)}
                    onOpen={() => handleOpenTask(t.id)}
                    onFocus={() => handleStartFocusForTask(t)}
                    focusActive={isFocusedItem({ kind: "task", id: t.id })}
                  />
                ))}
            </Section>
            <Section title="Done" count={doneTasks.length}>
              {doneTasks.length === 0
                ? <Empty>—</Empty>
                : doneTasks.map((t) => (
                  <CheckItem
                    key={t.id}
                    displayId={t.id}
                    label={t.note ? `📝 ${t.title}` : t.title}
                    area={t.area}
                    checked
                    onCheck={() => handleUncheckTask(t)}
                    onOpen={() => handleOpenTask(t.id)}
                  />
                ))}
            </Section>
          </div>
        )}

        {isViewingActive && subTab === "recurring" && (
          <div className="space-y-6">
            <Section title="To Do" count={payload.recurring.filter(r => r.status === "pending").length}>
              {payload.recurring.filter(r => r.status === "pending").length === 0
                ? <Empty>All recurring items done for today!</Empty>
                : payload.recurring.filter(r => r.status === "pending").map((r) => (
                  <CheckItem
                    key={r.ruleId}
                    label={r.title}
                    area={r.area}
                    onCheck={() => handleCheckRecurring(r)}
                    onFocus={() => handleStartFocusForRecurring(r)}
                    focusActive={isFocusedItem({ kind: "recurring", ruleId: r.ruleId, date: payload.date })}
                  />
                ))}
            </Section>
            <Section title="Done" count={(payload.recurringDone ?? []).length}>
              {(payload.recurringDone ?? []).length === 0
                ? <Empty>—</Empty>
                : (payload.recurringDone ?? []).map((r) => (
                  <CheckItem key={r.ruleId} label={`🔁 ${r.title}`} area={r.area} checked onCheck={() => {/* recurring done is sticky for active day */}} />
                ))}
            </Section>
          </div>
        )}

        {subTab === "notes" && (
          <NotesPanel
            date={viewDate ?? ""}
            readOnly={!isViewingActive}
            content={notesContent}
            onChange={(v) => { setNotesContent(v); notesDirtyRef.current = true; }}
            quickAddValue={notesQuickAdd}
            onQuickAddChange={setNotesQuickAdd}
            onQuickAddSubmit={handleNotesQuickAdd}
            saveStatus={notesSaveStatus}
          />
        )}
      </div>

      {addTaskOpen && (
        <TaskEditModal
          mode="create"
          area={areas[0]?.id ?? ""}
          boardId=""
          areaSelectable
          defaultColumn="doing"
          onClose={() => setAddTaskOpen(false)}
        />
      )}

      {detailTask && (
        <TaskEditModal
          mode="edit"
          area={detailTask.area}
          boardId={detailTask.boardId}
          task={detailTask.task}
          onClose={() => setDetailTask(null)}
        />
      )}

      {pickerFor && (
        <PomodoroPicker
          taskTitle={pickerFor.title}
          onPick={handlePickDuration}
          onClose={() => setPickerFor(null)}
        />
      )}

      {confirmSwitch && focus && (
        <Modal
          title="Abandon current focus?"
          onClose={() => setConfirmSwitch(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setConfirmSwitch(null)}>Cancel</Button>
              <Button variant="danger" onClick={handleConfirmSwitch}>Abandon &amp; switch</Button>
            </>
          }
        >
          <div className="text-sm text-slate-300">
            Abandon current focus on <span className="font-semibold text-slate-100">"{focus.title}"</span>
            {(() => {
              const min = Math.max(0, Math.round((Date.now() - Date.parse(focus.startedAt) - focus.accumulatedPausedMs) / 60_000));
              return ` (${min}m in)`;
            })()}
            ?
          </div>
          <div className="text-sm text-slate-400 mt-2">
            New focus: <span className="text-slate-200">"{confirmSwitch.title}"</span> — {confirmSwitch.duration}m
          </div>
        </Modal>
      )}

      {toast && (
        <div className="fixed bottom-4 right-4 z-50 px-4 py-2 rounded-lg bg-emerald-900 border border-emerald-700 text-emerald-100 text-sm shadow-lg">
          {toast}
        </div>
      )}
    </div>
    </DndContext>
  );
}

function NotesPanel({
  date,
  readOnly,
  content,
  onChange,
  quickAddValue,
  onQuickAddChange,
  onQuickAddSubmit,
  saveStatus,
}: {
  date: string;
  readOnly: boolean;
  content: string;
  onChange: (v: string) => void;
  quickAddValue: string;
  onQuickAddChange: (v: string) => void;
  onQuickAddSubmit: () => void;
  saveStatus: "idle" | "saving" | "saved";
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-xs text-slate-500">
          {readOnly
            ? "📅 Past day — notes read-only"
            : "Quick-add (Enter) appends an entry with an automatic ### HH:MM timestamp. Editing below saves the whole file (autosave 600ms)."}
        </div>
        <div className="text-xs text-slate-500">
          {saveStatus === "saving" && <span>zapisywanie…</span>}
          {saveStatus === "saved" && <span className="text-emerald-400">zapisano</span>}
        </div>
      </div>

      {!readOnly && (
        <div className="flex gap-2">
          <input
            value={quickAddValue}
            onChange={(e) => onQuickAddChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onQuickAddSubmit();
              }
            }}
            placeholder="Quick-add: a short note, Enter adds the entry"
            className="flex-1 bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-slate-500"
          />
          <button
            onClick={onQuickAddSubmit}
            disabled={!quickAddValue.trim()}
            className="px-3 py-2 text-sm bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:text-slate-500 rounded text-white"
          >
            Add
          </button>
        </div>
      )}

      <textarea
        value={content}
        onChange={(e) => onChange(e.target.value)}
        readOnly={readOnly}
        placeholder={readOnly
          ? "(no notes for this day)"
          : `Plain markdown. /today-eod reviews this file in the evening and proposes an action per entry.\nLines tagged [auto:source] are appended automatically (tracker status, reschedule, skip).`}
        spellCheck={false}
        className={`w-full h-[60vh] bg-slate-800/60 border border-slate-700 rounded p-3 text-sm font-mono text-slate-200 placeholder-slate-600 focus:outline-none focus:border-slate-500 ${readOnly ? "opacity-80" : ""}`}
      />

      <div className="text-xs text-slate-600">
        Source file: <code className="text-slate-500">.kanban/daily-notes/{date}.md</code>
        {readOnly && <span> (archive/ once /today-eod has run)</span>}
      </div>
    </div>
  );
}

function SubTabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
        active ? "bg-slate-700 text-white" : "text-slate-400 hover:text-white hover:bg-slate-800"
      }`}
    >
      {children}
    </button>
  );
}

function Section({
  title,
  count,
  children,
  action,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          {title} {count > 0 && <span className="text-slate-600">({count})</span>}
        </div>
        {action && <div className="ml-auto">{action}</div>}
      </div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="text-sm text-slate-600 py-1">{children}</div>;
}

function CheckItem({
  label,
  area,
  tag,
  checked = false,
  readOnly = false,
  onCheck,
  onOpen,
  onFocus,
  focusActive = false,
  taskId,
  displayId,
}: {
  label: string;
  area: string;
  tag?: string;
  checked?: boolean;
  readOnly?: boolean;
  onCheck: () => void;
  onOpen?: () => void;
  onFocus?: () => void;
  focusActive?: boolean;
  taskId?: string;
  displayId?: string;
}) {
  const { byId } = useAreas();
  const areaInfo = byId(area);
  // Drag handle is conditional — only real tasks (with taskId) drop onto date cells.
  const draggable = useDraggable({
    id: `task:${taskId ?? "_none_"}`,
    disabled: !taskId || checked || readOnly,
    data: { kind: "task", taskId },
  });
  return (
    <div
      ref={taskId ? draggable.setNodeRef : undefined}
      {...(taskId ? draggable.attributes : {})}
      {...(taskId ? draggable.listeners : {})}
      style={
        taskId && draggable.transform
          ? { transform: `translate(${draggable.transform.x}px, ${draggable.transform.y}px)`, zIndex: 50 }
          : undefined
      }
      className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-colors group ${
        readOnly ? "opacity-60" : checked ? "bg-slate-800/40" : "bg-slate-800/60 hover:bg-slate-800"
      } ${taskId && draggable.isDragging ? "opacity-60 ring-2 ring-blue-500" : ""} ${taskId && !checked && !readOnly ? "cursor-grab active:cursor-grabbing" : ""}`}
    >
      <div
        className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${
          readOnly ? "cursor-default border-slate-700" : checked ? "bg-blue-600 border-blue-600 cursor-pointer" : "border-slate-600 group-hover:border-slate-400 cursor-pointer"
        }`}
        onClick={(e) => { if (readOnly) return; e.stopPropagation(); onCheck(); }}
      >
        {checked && (
          <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 12 12">
            <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </div>
      <span
        className={`flex-1 text-sm cursor-pointer ${checked ? "line-through text-slate-500" : "text-slate-200"}`}
        onClick={() => onOpen?.()}
      >
        {label}
      </span>
      {tag && <span className="text-xs text-red-400 bg-red-900/30 px-1.5 py-0.5 rounded">{tag}</span>}
      {onFocus && !checked && (
        <button
          onClick={(e) => { e.stopPropagation(); onFocus(); }}
          title={focusActive ? "Focus active" : "Start focus"}
          className={`w-6 h-6 rounded flex items-center justify-center text-xs transition-colors ${
            focusActive
              ? "text-emerald-400 bg-emerald-900/30"
              : "text-slate-500 hover:text-emerald-400 hover:bg-slate-700"
          }`}
        >
          {focusActive ? "⏸" : "▶"}
        </button>
      )}
      {displayId && (
        <span
          className="text-xs font-mono text-slate-400 bg-slate-700/50 px-1.5 py-0.5 rounded"
          title="Task ID"
        >
          {displayId}
        </span>
      )}
      <span
        className="text-xs px-1.5 py-0.5 rounded-full text-white/80"
        style={{ backgroundColor: byId(area).color }}
      >
        {areaInfo.emoji} {area}
      </span>
    </div>
  );
}
