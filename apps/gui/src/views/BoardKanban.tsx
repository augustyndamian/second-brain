import { useState } from "react";
import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import type { Area, Board, Column, Task } from "@second-brain/core";
import { TaskEditModal } from "../components/TaskEditModal";

const COLUMNS: { id: Column; label: string }[] = [
  { id: "todo", label: "To do" },
  { id: "doing", label: "Doing" },
  { id: "done", label: "Done" },
];

type TodoSortMode = "priority" | "dueDate";

function sortedTodoTasks(tasks: Task[], sort: TodoSortMode): Task[] {
  if (sort === "priority") {
    return [...tasks].sort((a, b) => (b.priority ?? 5) - (a.priority ?? 5));
  }
  return [...tasks].sort((a, b) => {
    if (!a.dueDate && !b.dueDate) return 0;
    if (!a.dueDate) return 1;
    if (!b.dueDate) return -1;
    return a.dueDate.localeCompare(b.dueDate);
  });
}

export function BoardKanban({ board, area }: { board: Board; area: Area }) {
  const [editing, setEditing] = useState<Task | null>(null);
  const [creating, setCreating] = useState(false);
  const [todoSort, setTodoSort] = useState<TodoSortMode>("priority");
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const onDragEnd = async (e: DragEndEvent) => {
    const taskId = e.active.id as string;
    const to = e.over?.id as Column | undefined;
    if (!to) return;
    const cur = board.tasks.find((t) => t.id === taskId);
    if (!cur || cur.column === to) return;
    await window.api.tasks.move(taskId, to);
  };

  return (
    <>
      <div className="flex justify-between items-center">
        <div className="text-sm text-slate-400">
          {board.tasks.length} task{board.tasks.length === 1 ? "" : "s"}
        </div>
        <button
          onClick={() => setCreating(true)}
          className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 rounded text-white"
        >
          + Add task
        </button>
      </div>
      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <div className="grid grid-cols-3 gap-4 flex-1 min-h-0">
          {COLUMNS.map((c) => {
            const columnTasks = c.id === "todo"
              ? sortedTodoTasks(board.tasks.filter((t) => t.column === "todo"), todoSort)
              : board.tasks.filter((t) => t.column === c.id);
            return (
              <KanbanColumn
                key={c.id}
                column={c.id}
                label={c.label}
                tasks={columnTasks}
                onEdit={setEditing}
                todoSort={c.id === "todo" ? todoSort : undefined}
                onTodoSortChange={c.id === "todo" ? setTodoSort : undefined}
              />
            );
          })}
        </div>
      </DndContext>
      {editing && (
        <TaskEditModal
          mode="edit"
          area={area}
          boardId={board.id}
          task={editing}
          onClose={() => setEditing(null)}
        />
      )}
      {creating && (
        <TaskEditModal
          mode="create"
          area={area}
          boardId={board.id}
          onClose={() => setCreating(false)}
        />
      )}
    </>
  );
}

function KanbanColumn({
  column,
  label,
  tasks,
  onEdit,
  todoSort,
  onTodoSortChange,
}: {
  column: Column;
  label: string;
  tasks: Task[];
  onEdit: (t: Task) => void;
  todoSort?: TodoSortMode;
  onTodoSortChange?: (s: TodoSortMode) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column });
  return (
    <div
      ref={setNodeRef}
      className={`bg-slate-800/50 rounded-lg p-3 flex flex-col gap-2 transition-colors ${
        isOver ? "bg-slate-700/70 ring-2 ring-blue-500" : ""
      }`}
    >
      <div className="flex justify-between items-center text-xs uppercase tracking-wider text-slate-400 px-1">
        <span>{label}</span>
        <div className="flex items-center gap-1">
          {todoSort !== undefined && onTodoSortChange && (
            <>
              <button
                onClick={() => onTodoSortChange("priority")}
                className={`px-1.5 py-0.5 rounded text-[10px] transition-colors ${todoSort === "priority" ? "bg-blue-600 text-white" : "bg-slate-700 hover:bg-slate-600"}`}
              >
                P
              </button>
              <button
                onClick={() => onTodoSortChange("dueDate")}
                className={`px-1.5 py-0.5 rounded text-[10px] transition-colors ${todoSort === "dueDate" ? "bg-blue-600 text-white" : "bg-slate-700 hover:bg-slate-600"}`}
              >
                Due
              </button>
            </>
          )}
          <span className="bg-slate-700 rounded px-1.5">{tasks.length}</span>
        </div>
      </div>
      <div className="flex flex-col gap-2 overflow-auto">
        {tasks.map((t) => (
          <DraggableTaskCard key={t.id} task={t} onClick={() => onEdit(t)} />
        ))}
      </div>
    </div>
  );
}

function DraggableTaskCard({ task, onClick }: { task: Task; onClick: () => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
  });
  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;
  const overdue = task.dueDate && task.column !== "done" && isOverdue(task.dueDate);
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      onClick={onClick}
      className={`group bg-slate-900 rounded-md p-3 text-sm border border-slate-700 hover:border-blue-500 cursor-grab active:cursor-grabbing select-none ${
        isDragging ? "opacity-50" : ""
      }`}
    >
      <div className="font-medium text-slate-100">{task.title}</div>
      <div className="flex items-center gap-2 mt-1.5 text-xs">
        {task.dueDate && (
          <span className={overdue ? "text-red-400" : "text-slate-400"}>
            📅 {task.dueDate}
          </span>
        )}
        {task.parentGoalRef && <span className="text-purple-400">🔗</span>}
        <span className="ml-auto text-slate-600">{task.id}</span>
        <span className={`px-1 rounded text-[10px] font-medium ${(task.priority ?? 5) >= 8 ? "bg-red-900/50 text-red-300" : (task.priority ?? 5) >= 5 ? "bg-slate-700 text-slate-400" : "bg-slate-800 text-slate-600"}`}>
          P{task.priority ?? 5}
        </span>
      </div>
    </div>
  );
}

function isOverdue(due: string): boolean {
  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, "0");
  const d = String(today.getDate()).padStart(2, "0");
  return due < `${y}-${m}-${d}`;
}
