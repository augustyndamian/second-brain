import { Command } from "commander";
import {
  dayView,
  defaultRoot,
  initStorage,
  ensureStorageReady,
  overdue,
  today,
  triggerToday,
} from "@second-brain/core";
import { asJson } from "../util.js";
import { renderTable } from "../format.js";

async function ensureInit(root: string) {
  await ensureStorageReady(root);
}

export function todayCommand(): Command {
  return new Command("today")
    .description("today's recurring + due tasks + overdue")
    .option("--date <YYYY-MM-DD>", "override 'today'")
    .option("--json")
    .action(async (opts) => {
      const root = defaultRoot();
      await ensureInit(root);
      // --date is a read-only override for backfill/debug — do NOT mutate active session.
      if (!opts.date) {
        const trig = await triggerToday(root);
        if (trig.autoClosed) {
          process.stderr.write(
            `[warn] previous session ${trig.autoClosed.date} auto-closed after ${trig.autoClosed.hoursOpen}h (${trig.autoClosed.missedCount} recurring missed)\n`,
          );
        }
      }
      const payload = await today(root, opts.date);
      if (opts.json) {
        console.log(asJson(payload));
        return;
      }
      const lines: string[] = [];
      lines.push(`# Today — ${payload.date}\n`);

      if (payload.recurring.length === 0) {
        lines.push("Recurring: (none)\n");
      } else {
        lines.push("## Recurring");
        const rows = payload.recurring.map((r) => [
          r.ruleId,
          r.area,
          r.status,
          r.title,
        ]);
        lines.push(renderTable(rows, ["RULE", "AREA", "STATUS", "TITLE"]));
      }

      if (payload.recurringDone.length > 0) {
        lines.push("## Recurring done");
        const rows = payload.recurringDone.map((r) => [
          r.ruleId,
          r.area,
          r.title,
        ]);
        lines.push(renderTable(rows, ["RULE", "AREA", "TITLE"]));
      }

      if (payload.tasks.length === 0) {
        lines.push("Tasks due today: (none)\n");
      } else {
        lines.push("## Due today");
        const rows = payload.tasks.map((t) => [t.id, t.area, t.column, t.title]);
        lines.push(renderTable(rows, ["ID", "AREA", "COL", "TITLE"]));
      }

      if (payload.overdue.length > 0) {
        lines.push("## Overdue");
        const rows = payload.overdue.map((t) => [
          t.id,
          t.area,
          String(t.daysOverdue),
          t.dueDate ?? "—",
          t.title,
        ]);
        lines.push(renderTable(rows, ["ID", "AREA", "DAYS", "DUE", "TITLE"]));
      }

      process.stdout.write(lines.join("\n"));
    });
}

export function dayViewCommand(): Command {
  return new Command("day-view")
    .description("read-only day view (any date) — active|closed|future|empty")
    .requiredOption("--date <YYYY-MM-DD>", "target date")
    .option("--json")
    .action(async (opts) => {
      const root = defaultRoot();
      await ensureInit(root);
      const payload = await dayView(root, opts.date);
      if (opts.json) {
        console.log(asJson(payload));
        return;
      }
      const lines: string[] = [];
      lines.push(`# Day view — ${payload.date} (${payload.state})\n`);
      if ((payload.plannedTasks ?? []).length > 0) {
        lines.push("## Planned for this day");
        const rows = payload.plannedTasks!.map((t) => [t.id, t.area, t.column, t.title]);
        lines.push(renderTable(rows, ["ID", "AREA", "COL", "TITLE"]));
      }
      if ((payload.dueOnlyTasks ?? []).length > 0) {
        lines.push("## Due on this day (not planned)");
        const rows = payload.dueOnlyTasks!.map((t) => [t.id, t.area, t.column, t.dueDate ?? "—", t.title]);
        lines.push(renderTable(rows, ["ID", "AREA", "COL", "DUE", "TITLE"]));
      }
      if (payload.doingTasks.length > 0) {
        lines.push("## Doing");
        const rows = payload.doingTasks.map((t) => [t.id, t.area, t.title]);
        lines.push(renderTable(rows, ["ID", "AREA", "TITLE"]));
      }
      if (payload.doneTasks.length > 0) {
        lines.push("## Done");
        const rows = payload.doneTasks.map((t) => [t.id, t.area, t.title]);
        lines.push(renderTable(rows, ["ID", "AREA", "TITLE"]));
      }
      if (payload.recurring.length > 0) {
        lines.push("## Recurring");
        const rows = payload.recurring.map((r) => [r.ruleId, r.area, r.status, r.title]);
        lines.push(renderTable(rows, ["RULE", "AREA", "STATUS", "TITLE"]));
      }
      process.stdout.write(lines.join("\n"));
    });
}

export function overdueCommand(): Command {
  return new Command("overdue")
    .description("list overdue tasks")
    .option("--date <YYYY-MM-DD>")
    .option("--json")
    .action(async (opts) => {
      const root = defaultRoot();
      await ensureInit(root);
      const items = await overdue(root, opts.date);
      if (opts.json) {
        console.log(asJson(items));
        return;
      }
      if (items.length === 0) {
        console.log("(no overdue)");
        return;
      }
      const rows = items.map((t) => [
        t.id,
        t.area,
        String(t.daysOverdue),
        t.dueDate ?? "—",
        t.title,
      ]);
      process.stdout.write(renderTable(rows, ["ID", "AREA", "DAYS", "DUE", "TITLE"]));
    });
}
