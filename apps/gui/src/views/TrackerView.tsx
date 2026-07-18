import { useEffect, useMemo, useState } from "react";
import type { Area, TrackingItem, TrackingKind, TrackingStatus } from "@second-brain/core";
import { useAreas } from "../areas-context";

const KINDS: TrackingKind[] = ["commitment", "event", "external-task"];
const STATUSES: TrackingStatus[] = ["todo", "in-progress", "done", "cancelled"];

type AreaFilter = Area | "all";
type KindFilter = TrackingKind | "all";

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function dateBucket(due: string | null, today: string): "no-date" | "overdue" | "this-week" | "later" {
  if (!due) return "no-date";
  if (due < today) return "overdue";
  const t = Date.parse(today + "T00:00:00Z");
  const d = Date.parse(due + "T00:00:00Z");
  const days = Math.round((d - t) / 86400000);
  return days <= 7 ? "this-week" : "later";
}

export function TrackerView() {
  const { areas } = useAreas();
  const [items, setItems] = useState<TrackingItem[]>([]);
  const [areaFilter, setAreaFilter] = useState<AreaFilter>("all");
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const [hideDone, setHideDone] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<TrackingItem | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = async () => {
    try {
      const data = await window.api.tracking.list();
      setItems(data);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    refresh();
    const off = window.api.onStorageChanged?.((info) => {
      if (info.filePath?.endsWith("tracking.yaml")) refresh();
    });
    return off;
  }, []);

  const today = todayStr();

  const filtered = useMemo(() => {
    return items.filter((i) => {
      if (areaFilter !== "all" && i.area !== areaFilter) return false;
      if (kindFilter !== "all" && i.kind !== kindFilter) return false;
      if (hideDone && (i.status === "done" || i.status === "cancelled")) return false;
      return true;
    });
  }, [items, areaFilter, kindFilter, hideDone]);

  const groups = useMemo(() => {
    const buckets: Record<string, TrackingItem[]> = { overdue: [], "this-week": [], later: [], "no-date": [] };
    for (const i of filtered) buckets[dateBucket(i.dueDate, today)]!.push(i);
    for (const k of Object.keys(buckets)) {
      buckets[k]!.sort((a, b) => {
        const ad = a.dueDate ?? "9999-99-99";
        const bd = b.dueDate ?? "9999-99-99";
        return ad.localeCompare(bd);
      });
    }
    return buckets;
  }, [filtered, today]);

  if (loadError) {
    return (
      <div className="p-8 text-red-400">
        <div className="font-semibold mb-2">Failed to load Tracker</div>
        <pre className="text-xs whitespace-pre-wrap text-red-300">{loadError}</pre>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <header className="px-6 py-3 border-b border-slate-700 flex items-center gap-3 flex-wrap">
        <h1 className="text-lg font-semibold mr-2">🎯 Tracker</h1>
        <FilterPill label="Area" value={areaFilter} onChange={(v) => setAreaFilter(v as AreaFilter)} options={[
          { value: "all", label: "All" },
          ...areas.map((a) => ({ value: a.id, label: `${a.emoji} ${a.label}` })),
        ]} />
        <FilterPill label="Kind" value={kindFilter} onChange={(v) => setKindFilter(v as KindFilter)} options={[
          { value: "all", label: "All" },
          ...KINDS.map((k) => ({ value: k, label: k })),
        ]} />
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input type="checkbox" checked={hideDone} onChange={(e) => setHideDone(e.target.checked)} />
          Ukryj done/cancelled
        </label>
        <button
          onClick={() => setAddOpen(true)}
          className="ml-auto px-3 py-1.5 rounded-md text-sm bg-blue-600 hover:bg-blue-500 text-white"
        >
          + Add item
        </button>
      </header>

      <div className="flex-1 overflow-auto px-6 py-4 space-y-6">
        <BucketSection title="⚠️ Overdue" items={groups.overdue ?? []} today={today} onEdit={setEditTarget} />
        <BucketSection title="🟡 This week" items={groups["this-week"] ?? []} today={today} onEdit={setEditTarget} />
        <BucketSection title="📅 Later" items={groups.later ?? []} today={today} onEdit={setEditTarget} />
        <BucketSection title="📌 No date" items={groups["no-date"] ?? []} today={today} onEdit={setEditTarget} />
        {filtered.length === 0 && (
          <div className="text-center py-12 text-slate-500">
            <div className="text-4xl mb-3">📭</div>
            <div className="text-sm">Nothing here yet. Add a commitment / event / external-task.</div>
          </div>
        )}
      </div>

      {addOpen && (
        <TrackingEditModal
          mode="create"
          onClose={() => setAddOpen(false)}
          onSaved={() => { setAddOpen(false); refresh(); }}
        />
      )}
      {editTarget && (
        <TrackingEditModal
          mode="edit"
          item={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={() => { setEditTarget(null); refresh(); }}
        />
      )}
    </div>
  );
}

function BucketSection({ title, items, today, onEdit }: {
  title: string;
  items: TrackingItem[];
  today: string;
  onEdit: (i: TrackingItem) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
        {title} <span className="text-slate-600">({items.length})</span>
      </div>
      <div className="space-y-1">
        {items.map((i) => (
          <TrackingRow key={i.id} item={i} today={today} onClick={() => onEdit(i)} />
        ))}
      </div>
    </div>
  );
}

function TrackingRow({ item, today, onClick }: { item: TrackingItem; today: string; onClick: () => void }) {
  const { byId } = useAreas();
  const overdue = item.dueDate !== null && item.dueDate < today && item.status !== "done" && item.status !== "cancelled";
  const done = item.status === "done";
  const cancelled = item.status === "cancelled";
  return (
    <div
      onClick={onClick}
      className={`flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors group ${
        done || cancelled ? "bg-slate-800/30 hover:bg-slate-800/50" : "bg-slate-800/60 hover:bg-slate-800"
      }`}
    >
      <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-slate-700/80 text-slate-400 flex-shrink-0">
        {item.id}
      </span>
      <KindBadge kind={item.kind} />
      <span className={`flex-1 text-sm min-w-0 truncate ${done || cancelled ? "line-through text-slate-500" : "text-slate-200"}`}>
        {item.title}
      </span>
      {item.assignee && (
        <span className="text-xs text-slate-400 bg-slate-700/60 px-1.5 py-0.5 rounded">
          @{item.assignee}
        </span>
      )}
      {item.dueDate && (
        <span className={`text-xs px-1.5 py-0.5 rounded ${overdue ? "text-red-300 bg-red-900/40" : "text-slate-400 bg-slate-700/60"}`}>
          {item.dueDate}
        </span>
      )}
      <StatusBadge status={item.status} />
      <span
        className="text-xs px-1.5 py-0.5 rounded-full text-white/80"
        style={{ backgroundColor: byId(item.area).color }}
      >
        {byId(item.area).emoji} {item.area}
      </span>
    </div>
  );
}

function KindBadge({ kind }: { kind: TrackingKind }) {
  const map: Record<TrackingKind, { icon: string; color: string }> = {
    commitment: { icon: "🤝", color: "bg-purple-900/50 text-purple-200" },
    event: { icon: "🗓", color: "bg-amber-900/50 text-amber-200" },
    "external-task": { icon: "🔗", color: "bg-cyan-900/50 text-cyan-200" },
  };
  const m = map[kind];
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded ${m.color} flex-shrink-0`}>
      {m.icon} {kind}
    </span>
  );
}

function StatusBadge({ status }: { status: TrackingStatus }) {
  const map: Record<TrackingStatus, string> = {
    todo: "bg-slate-700 text-slate-300",
    "in-progress": "bg-blue-900/60 text-blue-200",
    done: "bg-emerald-900/60 text-emerald-200",
    cancelled: "bg-slate-800 text-slate-500",
  };
  return <span className={`text-xs px-1.5 py-0.5 rounded ${map[status]}`}>{status}</span>;
}

function FilterPill<T extends string>({ label, value, onChange, options }: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <label className="flex items-center gap-2 text-sm text-slate-400">
      <span>{label}:</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-slate-200 text-sm"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}

function TrackingEditModal({ mode, item, onClose, onSaved }: {
  mode: "create" | "edit";
  item?: TrackingItem;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { areas } = useAreas();
  const [kind, setKind] = useState<TrackingKind>(item?.kind ?? "commitment");
  const [title, setTitle] = useState(item?.title ?? "");
  const [area, setArea] = useState<Area>(item?.area ?? areas[0]?.id ?? "");
  const [assignee, setAssignee] = useState(item?.assignee ?? "");
  const [dueDate, setDueDate] = useState(item?.dueDate ?? "");
  const [status, setStatus] = useState<TrackingStatus>(item?.status ?? "todo");
  const [note, setNote] = useState(item?.note ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    if (!title.trim()) { setErr("title required"); return; }
    setBusy(true);
    setErr(null);
    try {
      if (mode === "create") {
        await window.api.tracking.create({
          kind,
          area,
          title: title.trim(),
          assignee: assignee.trim() || null,
          dueDate: dueDate || null,
          status,
          note,
        });
      } else if (item) {
        await window.api.tracking.edit(item.id, {
          kind,
          area,
          title: title.trim(),
          assignee: assignee.trim() || null,
          dueDate: dueDate || null,
          status,
          note,
        });
      }
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!item) return;
    if (!confirm(`Delete ${item.id} "${item.title}"?`)) return;
    setBusy(true);
    try {
      await window.api.tracking.delete(item.id);
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-slate-900 border border-slate-700 rounded-lg w-[560px] max-w-[92vw] max-h-[90vh] overflow-auto shadow-2xl"
      >
        <header className="px-5 py-3 border-b border-slate-700 flex items-center justify-between">
          <h2 className="font-semibold">{mode === "create" ? "Nowy tracker item" : `Edycja ${item?.id}`}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white">✕</button>
        </header>
        <div className="p-5 space-y-3">
          <Field label="Title">
            <input value={title} onChange={(e) => setTitle(e.target.value)} className="input-base" autoFocus />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Kind">
              <select value={kind} onChange={(e) => setKind(e.target.value as TrackingKind)} className="input-base">
                {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
            </Field>
            <Field label="Area">
              <select value={area} onChange={(e) => setArea(e.target.value as Area)} className="input-base">
                {areas.map((a) => <option key={a.id} value={a.id}>{a.emoji} {a.label}</option>)}
              </select>
            </Field>
            <Field label="Assignee">
              <input value={assignee} onChange={(e) => setAssignee(e.target.value)} className="input-base" placeholder="alice / bob / external / —" />
            </Field>
            <Field label="Due date">
              <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="input-base" />
            </Field>
            <Field label="Status">
              <select value={status} onChange={(e) => setStatus(e.target.value as TrackingStatus)} className="input-base">
                {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Note">
            <textarea value={note} onChange={(e) => setNote(e.target.value)} className="input-base h-24 resize-y" />
          </Field>
          {err && <div className="text-sm text-red-400">{err}</div>}
        </div>
        <footer className="px-5 py-3 border-t border-slate-700 flex items-center gap-2">
          {mode === "edit" && (
            <button onClick={remove} disabled={busy} className="px-3 py-1.5 rounded-md text-sm text-red-400 hover:text-red-300 hover:bg-red-900/30 disabled:opacity-50">
              Delete
            </button>
          )}
          <div className="ml-auto flex gap-2">
            <button onClick={onClose} disabled={busy} className="px-3 py-1.5 rounded-md text-sm text-slate-300 hover:bg-slate-700 disabled:opacity-50">
              Cancel
            </button>
            <button onClick={save} disabled={busy} className="px-3 py-1.5 rounded-md text-sm bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50">
              {busy ? "..." : "Save"}
            </button>
          </div>
        </footer>
      </div>
      <style>{`.input-base { width:100%; background:rgb(15 23 42); border:1px solid rgb(51 65 85); border-radius:6px; padding:6px 10px; font-size:13px; color:rgb(226 232 240); }
.input-base:focus { outline:none; border-color:rgb(59 130 246); }`}</style>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-xs uppercase tracking-wider text-slate-500 mb-1">{label}</div>
      {children}
    </label>
  );
}
