import { Modal } from "./Modal";
import type { FocusDuration } from "@second-brain/core";

const DURATIONS: FocusDuration[] = [5, 10, 15, 30, 60];

export function PomodoroPicker({
  taskTitle,
  onPick,
  onClose,
}: {
  taskTitle: string;
  onPick: (durationMin: FocusDuration) => void;
  onClose: () => void;
}) {
  return (
    <Modal title="Start Focus Session" onClose={onClose}>
      <div className="mb-4">
        <div className="text-xs uppercase tracking-wider text-slate-500 mb-1">Task</div>
        <div className="text-sm text-slate-200">{taskTitle}</div>
      </div>
      <div className="text-xs uppercase tracking-wider text-slate-500 mb-2">Duration</div>
      <div className="grid grid-cols-5 gap-2">
        {DURATIONS.map((d) => (
          <button
            key={d}
            onClick={() => onPick(d)}
            className="py-3 rounded-lg bg-slate-800 hover:bg-emerald-700 border border-slate-700 hover:border-emerald-500 text-slate-100 font-mono text-lg transition-colors"
          >
            {d}m
          </button>
        ))}
      </div>
    </Modal>
  );
}
