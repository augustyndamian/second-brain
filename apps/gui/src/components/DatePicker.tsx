import { useMemo, useState } from "react";
import { useDroppable } from "@dnd-kit/core";

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function toIso(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function DatePicker({
  value,
  activeDate,
  onPick,
  onClose,
}: {
  value: string;
  activeDate: string | null;
  onPick: (date: string) => void;
  onClose: () => void;
}) {
  const initial = new Date(value + "T12:00:00");
  const [year, setYear] = useState(initial.getFullYear());
  const [month, setMonth] = useState(initial.getMonth());

  const grid = useMemo(() => {
    const firstOfMonth = new Date(year, month, 1);
    // Monday=0..Sunday=6 (PL convention)
    const startDow = (firstOfMonth.getDay() + 6) % 7;
    const lastOfMonth = new Date(year, month + 1, 0).getDate();
    const cells: (number | null)[] = [];
    for (let i = 0; i < startDow; i++) cells.push(null);
    for (let d = 1; d <= lastOfMonth; d++) cells.push(d);
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [year, month]);

  const today = new Date();
  const todayIso = toIso(today.getFullYear(), today.getMonth(), today.getDate());

  const prevMonth = () => {
    if (month === 0) { setYear(year - 1); setMonth(11); } else setMonth(month - 1);
  };
  const nextMonth = () => {
    if (month === 11) { setYear(year + 1); setMonth(0); } else setMonth(month + 1);
  };

  return (
    <div className="absolute z-40 top-full left-0 mt-2 bg-slate-900 border border-slate-700 rounded-lg shadow-xl p-3 w-80">
      <div className="flex items-center justify-between mb-2">
        <button onClick={prevMonth} className="px-2 py-1 text-slate-400 hover:text-white hover:bg-slate-800 rounded">‹</button>
        <div className="text-sm font-semibold text-slate-200">{MONTHS[month]} {year}</div>
        <button onClick={nextMonth} className="px-2 py-1 text-slate-400 hover:text-white hover:bg-slate-800 rounded">›</button>
      </div>
      <div className="grid grid-cols-7 gap-1 mb-1">
        {WEEKDAYS.map((w) => (
          <div key={w} className="text-xs text-center text-slate-500 font-medium py-1">{w}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {grid.map((d, i) => {
          if (d === null) return <div key={i} />;
          const iso = toIso(year, month, d);
          return (
            <DateCell
              key={i}
              iso={iso}
              day={d}
              isSelected={iso === value}
              isActive={iso === activeDate}
              isToday={iso === todayIso}
              isPast={iso < todayIso}
              onPick={() => { onPick(iso); onClose(); }}
            />
          );
        })}
      </div>
      <div className="flex items-center justify-between mt-3 pt-2 border-t border-slate-700 text-xs text-slate-500">
        <div className="flex items-center gap-2">
          <span className="w-1 h-1 bg-emerald-500 rounded-full" />
          <span>active session · drop a task on a day to reschedule</span>
        </div>
        <button onClick={onClose} className="text-slate-400 hover:text-white">close</button>
      </div>
    </div>
  );
}

function DateCell({
  iso,
  day,
  isSelected,
  isActive,
  isToday,
  isPast,
  onPick,
}: {
  iso: string;
  day: number;
  isSelected: boolean;
  isActive: boolean;
  isToday: boolean;
  isPast: boolean;
  onPick: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `date:${iso}`,
    disabled: isPast, // reschedule do past odrzucany — disable jako drop target
    data: { kind: "date", iso },
  });
  return (
    <button
      ref={setNodeRef}
      onClick={onPick}
      className={`
        text-sm py-1.5 rounded transition-colors relative
        ${isSelected ? "bg-blue-600 text-white" : "text-slate-300 hover:bg-slate-800"}
        ${isToday && !isSelected ? "ring-1 ring-slate-600" : ""}
        ${isOver && !isPast ? "ring-2 ring-emerald-400 bg-emerald-900/30" : ""}
        ${isPast ? "opacity-60" : ""}
      `}
    >
      {day}
      {isActive && !isSelected && (
        <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 bg-emerald-500 rounded-full" />
      )}
    </button>
  );
}
