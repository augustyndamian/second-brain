import { useState } from "react";
import type { Area, RecurringRule, Schedule, Weekday } from "@second-brain/core";
import { Button, Field, Input, Modal, Select, TextArea } from "./Modal";

const WEEKDAYS: Weekday[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

interface Props {
  area: Area;
  rule?: RecurringRule;
  onClose: () => void;
}

type ScheduleType = Schedule["type"];

export function RecurringEditModal({ area, rule, onClose }: Props) {
  const isEdit = !!rule;
  const [title, setTitle] = useState(rule?.title ?? "");
  const [description, setDescription] = useState(rule?.description ?? "");
  const [parentGoalRef, setParentGoalRef] = useState(rule?.parentGoalRef ?? "");
  const [scheduleType, setScheduleType] = useState<ScheduleType>(rule?.schedule.type ?? "daily");
  const [daysOfWeek, setDaysOfWeek] = useState<Weekday[]>(
    rule?.schedule.type === "weekly" ? rule.schedule.daysOfWeek : ["mon"],
  );
  const [everyNDays, setEveryNDays] = useState(
    rule?.schedule.type === "interval" ? rule.schedule.everyNDays : 2,
  );
  const [dayOfMonth, setDayOfMonth] = useState(
    rule?.schedule.type === "monthly" ? rule.schedule.dayOfMonth : 1,
  );
  const [startsOn, setStartsOn] = useState(rule?.startsOn ?? localTodayString());
  const [endsOn, setEndsOn] = useState(rule?.endsOn ?? "");
  const [busy, setBusy] = useState(false);

  const buildSchedule = (): Schedule => {
    switch (scheduleType) {
      case "daily":
        return { type: "daily" };
      case "weekdays":
        return { type: "weekdays" };
      case "weekly":
        return { type: "weekly", daysOfWeek: daysOfWeek.length ? daysOfWeek : ["mon"] };
      case "interval":
        return { type: "interval", everyNDays };
      case "monthly":
        return { type: "monthly", dayOfMonth };
    }
  };

  const save = async () => {
    if (!title.trim()) return;
    setBusy(true);
    try {
      if (isEdit) {
        // Edit not yet a service op — emulate via delete + create to keep it simple.
        // (V2 idea: dedicated editRule service in core.)
        await window.api.recurring.delete(rule!.id);
      }
      await window.api.recurring.create({
        area,
        title: title.trim(),
        description,
        schedule: buildSchedule(),
        startsOn,
        endsOn: endsOn || null,
        parentGoalRef: parentGoalRef || null,
      });
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!rule) return;
    if (!confirm(`Delete rule ${rule.id}?`)) return;
    setBusy(true);
    await window.api.recurring.delete(rule.id);
    onClose();
  };

  const toggleDay = (d: Weekday) => {
    setDaysOfWeek((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d]));
  };

  return (
    <Modal
      title={isEdit ? `Edit ${rule!.id}` : "New recurring rule"}
      onClose={onClose}
      footer={
        <>
          {isEdit && (
            <Button variant="danger" onClick={remove} disabled={busy}>
              Delete
            </Button>
          )}
          <div className="flex-1" />
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} disabled={busy || !title.trim()}>
            {isEdit ? "Save" : "Create"}
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

      <Field label="Schedule">
        <Select value={scheduleType} onChange={(e) => setScheduleType(e.target.value as ScheduleType)}>
          <option value="daily">Daily</option>
          <option value="weekdays">Weekdays (Mon-Fri)</option>
          <option value="weekly">Weekly (custom days)</option>
          <option value="interval">Every N days</option>
          <option value="monthly">Monthly (day of month)</option>
        </Select>
      </Field>

      {scheduleType === "weekly" && (
        <Field label="Days of week">
          <div className="flex gap-1 flex-wrap">
            {WEEKDAYS.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => toggleDay(d)}
                className={`px-2 py-1 text-xs rounded border ${
                  daysOfWeek.includes(d)
                    ? "bg-blue-600 border-blue-500 text-white"
                    : "bg-slate-800 border-slate-700 text-slate-300"
                }`}
              >
                {d}
              </button>
            ))}
          </div>
        </Field>
      )}

      {scheduleType === "interval" && (
        <Field label="Every N days">
          <Input
            type="number"
            min={1}
            value={everyNDays}
            onChange={(e) => setEveryNDays(Math.max(1, +e.target.value || 1))}
          />
        </Field>
      )}

      {scheduleType === "monthly" && (
        <Field label="Day of month (1-31; clamps to last day)">
          <Input
            type="number"
            min={1}
            max={31}
            value={dayOfMonth}
            onChange={(e) => setDayOfMonth(Math.min(31, Math.max(1, +e.target.value || 1)))}
          />
        </Field>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field label="Starts on">
          <Input type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
        </Field>
        <Field label="Ends on (optional)">
          <Input type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
        </Field>
      </div>

      <Field label="Parent goal ref (Obsidian)">
        <Input
          value={parentGoalRef}
          onChange={(e) => setParentGoalRef(e.target.value)}
          placeholder="Health/planning/2026-05.md#goal-1"
        />
      </Field>
    </Modal>
  );
}

function localTodayString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
