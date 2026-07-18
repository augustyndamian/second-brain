import { useState } from "react";
import type { Area, RecurringRule } from "@second-brain/core";
import { Button } from "../components/Modal";
import { RecurringEditModal } from "../components/RecurringEditModal";

export function RecurringList({ area, rules }: { area: Area; rules: RecurringRule[] }) {
  const [editing, setEditing] = useState<RecurringRule | null>(null);
  const [creating, setCreating] = useState(false);

  return (
    <div className="p-6 flex flex-col gap-4">
      <div className="flex justify-between items-center">
        <div className="text-sm text-slate-400">{rules.length} rule{rules.length === 1 ? "" : "s"}</div>
        <Button variant="primary" onClick={() => setCreating(true)}>
          + Add rule
        </Button>
      </div>
      {rules.length === 0 ? (
        <div className="text-sm text-slate-500">No recurring rules yet.</div>
      ) : (
        <ul className="flex flex-col gap-2">
          {rules.map((r) => (
            <li
              key={r.id}
              className={`flex items-center gap-3 px-3 py-2 rounded-md border ${
                r.active ? "bg-slate-800 border-slate-700" : "bg-slate-900 border-slate-800 opacity-60"
              }`}
            >
              <button
                onClick={() => window.api.recurring.toggle(r.id)}
                className={`w-9 h-5 rounded-full transition-colors ${r.active ? "bg-emerald-500" : "bg-slate-600"}`}
                title="Toggle active"
              >
                <span
                  className={`block w-4 h-4 rounded-full bg-white transition-transform ${
                    r.active ? "translate-x-4" : "translate-x-0.5"
                  }`}
                />
              </button>
              <div className="flex-1 cursor-pointer" onClick={() => setEditing(r)}>
                <div className="font-medium">{r.title}</div>
                <div className="text-xs text-slate-400">
                  {describeSchedule(r)} · starts {r.startsOn}
                  {r.endsOn ? ` · ends ${r.endsOn}` : ""}
                </div>
              </div>
              <span className="text-xs text-slate-500">{r.id}</span>
              <Button
                variant="primary"
                onClick={() => window.api.recurring.done(r.id)}
                title="Mark today as done"
              >
                ✓
              </Button>
            </li>
          ))}
        </ul>
      )}
      {creating && <RecurringEditModal area={area} onClose={() => setCreating(false)} />}
      {editing && <RecurringEditModal area={area} rule={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function describeSchedule(r: RecurringRule): string {
  const s = r.schedule;
  switch (s.type) {
    case "daily":
      return "daily";
    case "weekdays":
      return "weekdays (Mon-Fri)";
    case "weekly":
      return `weekly: ${s.daysOfWeek.join(", ")}`;
    case "interval":
      return `every ${s.everyNDays} days`;
    case "monthly":
      return `monthly on day ${s.dayOfMonth}`;
  }
}
