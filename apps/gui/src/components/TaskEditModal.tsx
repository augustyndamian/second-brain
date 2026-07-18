import { useEffect, useState } from "react";
import type { Area, Column, Task } from "@second-brain/core";
import { Button, Field, Input, Modal, Select, TextArea } from "./Modal";
import { useAreas } from "../areas-context";

interface Props {
  mode: "create" | "edit";
  area: Area;
  boardId: string;
  task?: Task;
  onClose: () => void;
  areaSelectable?: boolean;
  defaultColumn?: Column;
}

const todayIsoNow = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export function TaskEditModal({ mode, area, boardId, task, onClose, areaSelectable, defaultColumn }: Props) {
  const createDefault = mode === "create" ? todayIsoNow() : "";
  const { areas } = useAreas();
  const [title, setTitle] = useState(task?.title ?? "");
  const [description, setDescription] = useState(task?.description ?? "");
  const [dueDate, setDueDate] = useState(task?.dueDate ?? createDefault);
  const [plannedDate, setPlannedDate] = useState(task?.plannedDate ?? createDefault);
  const [column, setColumn] = useState<Column>(task?.column ?? defaultColumn ?? "todo");
  const [parentGoalRef, setParentGoalRef] = useState(task?.parentGoalRef ?? "");
  const [priority, setPriority] = useState<number>(task?.priority ?? 5);
  const [note, setNote] = useState(task?.note ?? "");
  const [busy, setBusy] = useState(false);
  const [moveTarget, setMoveTarget] = useState("");
  const [moveReason, setMoveReason] = useState("");
  const [moveError, setMoveError] = useState<string | null>(null);

  const [selectedArea, setSelectedArea] = useState<Area>(area);
  const [resolvedBoardId, setResolvedBoardId] = useState<string>(boardId);

  useEffect(() => {
    if (areaSelectable) {
      window.api.boards.list(selectedArea).then((boards) => {
        const def = boards.find((b) => b.isDefault) ?? boards[0];
        setResolvedBoardId(def?.id ?? `b_${selectedArea}_main`);
      });
    }
  }, [selectedArea, areaSelectable]);

  const save = async () => {
    if (!title.trim()) return;
    setBusy(true);
    try {
      if (mode === "create") {
        await window.api.tasks.create({
          area: areaSelectable ? selectedArea : area,
          title: title.trim(),
          description,
          dueDate: dueDate || null,
          plannedDate: plannedDate || null,
          parentGoalRef: parentGoalRef || null,
          priority,
          note: note.trim() ? note : null,
          column,
          boardId: areaSelectable ? resolvedBoardId : boardId,
        });
      } else if (task) {
        // NOTE: plannedDate is intentionally NOT edited here for existing tasks —
        // changes go through `tasks.reschedule` (button below) so the audit trail
        // captures intent (event task.rescheduled + auto-log) instead of a generic edit.
        await window.api.tasks.edit(task.id, {
          title: title.trim(),
          description,
          dueDate: dueDate || null,
          parentGoalRef: parentGoalRef || null,
          priority,
          note: note.trim() ? note : null,
        });
        if (column !== task.column) {
          await window.api.tasks.move(task.id, column);
        }
      }
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!task) return;
    if (!confirm(`Delete task ${task.id}?`)) return;
    setBusy(true);
    await window.api.tasks.delete(task.id);
    onClose();
  };

  const openObsidian = () => {
    if (parentGoalRef) window.api.openObsidian(parentGoalRef);
  };

  const todayIso = todayIsoNow();

  const reschedule = async () => {
    if (!task) return;
    if (!moveTarget) {
      setMoveError("Pick a date");
      return;
    }
    if (moveTarget < todayIso) {
      setMoveError("Cannot reschedule into the past");
      return;
    }
    setBusy(true);
    setMoveError(null);
    try {
      await window.api.tasks.reschedule(task.id, moveTarget, moveReason.trim() || null);
      onClose();
    } catch (e) {
      setMoveError((e as Error).message ?? "reschedule failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={mode === "create" ? "New task" : `Edit ${task?.id}`}
      onClose={onClose}
      footer={
        <>
          {mode === "edit" && (
            <Button variant="danger" onClick={remove} disabled={busy}>
              Delete
            </Button>
          )}
          <div className="flex-1" />
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} disabled={busy || !title.trim()}>
            {mode === "create" ? "Create" : "Save"}
          </Button>
        </>
      }
    >
      <Field label="Title">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
      </Field>
      <Field label="Description">
        <TextArea value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <Field label="Note (follow-up after closing — shows up in /today-eod)">
        <TextArea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. hand over to alice, finish X, remember Y"
          rows={3}
        />
      </Field>
      {areaSelectable && (
        <Field label="Area">
          <Select value={selectedArea} onChange={(e) => setSelectedArea(e.target.value as Area)}>
            {areas.map((a) => (
              <option key={a.id} value={a.id}>{a.emoji} {a.label}</option>
            ))}
          </Select>
        </Field>
      )}
      <div className="grid grid-cols-3 gap-3">
        <Field label="Column">
          <Select value={column} onChange={(e) => setColumn(e.target.value as Column)}>
            <option value="todo">To do</option>
            <option value="doing">Doing</option>
            <option value="done">Done</option>
          </Select>
        </Field>
        <Field label="Due date (deadline)">
          <Input type="date" value={dueDate ?? ""} onChange={(e) => setDueDate(e.target.value)} />
        </Field>
        <Field label="Priority (1–10)">
          <Input
            type="number"
            min={1}
            max={10}
            value={priority}
            onChange={(e) => setPriority(Math.min(10, Math.max(1, parseInt(e.target.value, 10) || 5)))}
          />
        </Field>
      </div>
      {mode === "create" ? (
        <Field label="Planned day (when you intend to do it)">
          <Input
            type="date"
            value={plannedDate ?? ""}
            onChange={(e) => setPlannedDate(e.target.value)}
          />
        </Field>
      ) : (
        <Field label="Planned day">
          <div className="flex flex-col gap-2">
            <div className="text-sm text-slate-300">
              {task?.plannedDate
                ? <>Currently planned for <span className="font-mono">{task.plannedDate}</span></>
                : <span className="text-slate-500">(not planned)</span>}
            </div>
            <div className="flex gap-2 items-end">
              <div className="flex-1">
                <Input
                  type="date"
                  value={moveTarget}
                  min={todayIso}
                  onChange={(e) => { setMoveTarget(e.target.value); setMoveError(null); }}
                  placeholder="YYYY-MM-DD"
                />
              </div>
              <div className="flex-1">
                <Input
                  value={moveReason}
                  onChange={(e) => setMoveReason(e.target.value)}
                  placeholder="reason (opcjonalnie)"
                />
              </div>
              <Button onClick={reschedule} disabled={busy || !moveTarget}>
                Move to day…
              </Button>
            </div>
            {moveError && <div className="text-xs text-red-400">{moveError}</div>}
            <div className="text-xs text-slate-500">
              Rescheduling emits a <code className="text-slate-400">task.rescheduled</code> event and un-anchors the task from today\u2019s session. Changing the <em>due date</em> above is a separate operation (deadline \u2260 plan).
            </div>
          </div>
        </Field>
      )}
      <Field label="Parent goal ref (Obsidian)">
        <div className="flex gap-2">
          <Input
            value={parentGoalRef}
            onChange={(e) => setParentGoalRef(e.target.value)}
            placeholder="areas/Work/planning/2026-07.md#goal-1"
            className="flex-1"
          />
          {parentGoalRef && (
            <Button onClick={openObsidian} disabled={busy}>
              Open in Obsidian
            </Button>
          )}
        </div>
      </Field>
    </Modal>
  );
}
