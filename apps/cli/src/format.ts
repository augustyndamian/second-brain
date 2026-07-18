import type { AreaConfig, Board, Task } from "@second-brain/core";

const COLS = ["ID", "AREA", "BOARD", "COL", "DUE", "TITLE"] as const;

function pad(s: string, n: number): string {
  if (s.length >= n) return s;
  return s + " ".repeat(n - s.length);
}

export function formatTaskRow(t: Task, b: Board): string[] {
  return [
    t.id,
    b.area,
    b.id,
    t.column,
    t.dueDate ?? "—",
    t.title.length > 60 ? t.title.slice(0, 57) + "..." : t.title,
  ];
}

export function renderTable(rows: string[][], headers: readonly string[] = COLS): string {
  if (rows.length === 0) return "(no tasks)\n";
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)),
  );
  const fmtRow = (r: readonly string[]) =>
    r.map((c, i) => pad(c, widths[i]!)).join("  ");
  const lines = [fmtRow(headers), widths.map((w) => "-".repeat(w)).join("  ")];
  for (const r of rows) lines.push(fmtRow(r));
  return lines.join("\n") + "\n";
}

export function renderTasks(items: { task: Task; board: Board }[]): string {
  return renderTable(items.map(({ task, board }) => formatTaskRow(task, board)));
}

export function renderAreas(areas: AreaConfig[]): string {
  if (areas.length === 0) return "(no areas)\n";
  const rows = areas.map((a) => [a.id, a.emoji, a.label, a.color, a.prefix ?? a.id.replace(/-/g, "")]);
  return renderTable(rows, ["ID", "", "LABEL", "COLOR", "PREFIX"] as const);
}

export function renderBoards(boards: Board[]): string {
  const rows = boards.map((b) => [
    b.id,
    b.area,
    b.isDefault ? "*" : " ",
    String(b.tasks.length),
    b.name,
  ]);
  return renderTable(rows, ["ID", "AREA", "DEF", "TASKS", "NAME"]);
}

export function renderTaskDetail(t: Task, b: Board): string {
  return [
    `id:            ${t.id}`,
    `title:         ${t.title}`,
    `area:          ${b.area}`,
    `board:         ${b.id} (${b.name})`,
    `column:        ${t.column}`,
    `dueDate:       ${t.dueDate ?? "—"}`,
    `parentGoalRef: ${t.parentGoalRef ?? "—"}`,
    `createdAt:     ${t.createdAt}`,
    `updatedAt:     ${t.updatedAt}`,
    `completedAt:   ${t.completedAt ?? "—"}`,
    "",
    "description:",
    t.description || "(empty)",
    "",
    "note:",
    t.note || "(empty)",
    "",
  ].join("\n");
}
