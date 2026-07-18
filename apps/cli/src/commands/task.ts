import { Command } from "commander";
import {
  BatchValidationError,
  createTask,
  createTasksBatch,
  deleteTask,
  editTask,
  editTasksBatch,
  initStorage,
  ensureStorageReady,
  listTasks,
  moveTask,
  moveTasksBatch,
  rescheduleTask,
  rescheduleTasksBatch,
  showTask,
  defaultRoot,
} from "@second-brain/core";
import { asJson, fail, parseArea, parseColumn, readJsonInput } from "../util.js";
import { renderTaskDetail, renderTasks } from "../format.js";

async function ensureInit(root: string) {
  await ensureStorageReady(root);
}

export function taskCommand(): Command {
  const cmd = new Command("task").description("manage tasks");

  cmd
    .command("add")
    .description("add a new task")
    .requiredOption("--area <area>", "area id (see `kb area list`)")
    .requiredOption("--title <title>", "task title")
    .option("--board <id>", "board id (defaults to area's default)")
    .option("--due <YYYY-MM-DD>", "due date (deadline)")
    .option("--planned <YYYY-MM-DD>", "planned execution day")
    .option("--desc <text>", "description")
    .option("--column <todo|doing|done>", "starting column", "todo")
    .option("--priority <1-10>", "priority 1=low 10=high", "5")
    .option("--parent-goal-ref <ref>", "Obsidian reference")
    .option("--note <text>", "follow-up note (multiline ok)")
    .option("--json", "json output")
    .action(async (opts) => {
      const root = defaultRoot();
      await ensureInit(root);
      try {
        const { task, boardId } = await createTask(root, {
          area: parseArea(opts.area),
          title: opts.title,
          description: opts.desc,
          dueDate: opts.due ?? null,
          plannedDate: opts.planned ?? null,
          parentGoalRef: opts.parentGoalRef ?? null,
          priority: parseInt(opts.priority, 10),
          note: opts.note ?? null,
          column: opts.column ? parseColumn(opts.column) : "todo",
          boardId: opts.board,
        });
        if (opts.json) {
          console.log(asJson({ ...task, boardId }));
        } else {
          console.log(`created ${task.id} on ${boardId}`);
        }
      } catch (e) {
        fail((e as Error).message);
      }
    });

  cmd
    .command("add-batch")
    .description("add multiple tasks atomically from a JSON array (stdin or file)")
    .requiredOption("--json <path|->", "path to JSON file with array, or '-' for stdin")
    .action(async (opts) => {
      const root = defaultRoot();
      await ensureInit(root);
      let parsed: unknown;
      try {
        const text = await readJsonInput(opts.json);
        parsed = JSON.parse(text);
      } catch (e) {
        console.log(asJson({ ok: false, errors: [{ index: -1, field: "json", reason: (e as Error).message }] }));
        process.exit(1);
      }
      if (!Array.isArray(parsed)) {
        console.log(asJson({ ok: false, errors: [{ index: -1, field: "json", reason: "expected array" }] }));
        process.exit(1);
      }
      const inputs = (parsed as any[]).map((it) => ({
        area: typeof it?.area === "string" ? parseArea(it.area) : it?.area,
        title: it?.title,
        description: it?.desc ?? it?.description,
        dueDate: it?.due ?? it?.dueDate ?? null,
        plannedDate: it?.planned ?? it?.plannedDate ?? null,
        parentGoalRef: it?.parentGoalRef ?? null,
        priority: it?.priority,
        column: it?.column ? parseColumn(it.column) : undefined,
        boardId: it?.board ?? it?.boardId,
      }));
      try {
        const created = await createTasksBatch(root, inputs);
        const out = created.map(({ task, boardId }, i) => ({
          id: task.id,
          boardId,
          area: inputs[i]!.area,
        }));
        console.log(asJson({ ok: true, items: out }));
      } catch (e) {
        if (e instanceof BatchValidationError) {
          console.log(asJson({ ok: false, errors: e.errors }));
          process.exit(1);
        }
        console.log(asJson({ ok: false, errors: [{ index: -1, field: "batch", reason: (e as Error).message }] }));
        process.exit(1);
      }
    });

  cmd
    .command("list")
    .description("list tasks")
    .option("--area <area>")
    .option("--board <id>")
    .option("--column <todo|doing|done>")
    .option("--due-before <YYYY-MM-DD>")
    .option("--planned-on <YYYY-MM-DD>", "tasks with plannedDate=DATE")
    .option("--has-note", "only tasks with a non-empty note")
    .option("--done-in-session <YYYY-MM-DD>", "tasks closed within session for given date")
    .option("--json")
    .action(async (opts) => {
      const root = defaultRoot();
      await ensureInit(root);
      let items = await listTasks(root, {
        area: opts.area ? parseArea(opts.area) : undefined,
        boardId: opts.board,
        column: opts.column ? parseColumn(opts.column) : undefined,
        dueBefore: opts.dueBefore,
      });
      if (opts.hasNote) {
        items = items.filter(({ task }) => task.note != null && task.note.trim().length > 0);
      }
      if (opts.plannedOn) {
        const target = opts.plannedOn;
        items = items.filter(({ task }) => task.plannedDate === target);
      }
      if (opts.doneInSession) {
        const target = opts.doneInSession;
        items = items.filter(({ task }) => {
          if (task.column !== "done") return false;
          if (task.completedSessionDate) return task.completedSessionDate === target;
          if (task.completedAt) {
            const d = new Date(task.completedAt);
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, "0");
            const dd = String(d.getDate()).padStart(2, "0");
            return `${y}-${m}-${dd}` === target;
          }
          return false;
        });
      }
      if (opts.json) {
        console.log(
          asJson(
            items.map(({ task, board }) => ({
              ...task,
              area: board.area,
              boardId: board.id,
            })),
          ),
        );
      } else {
        process.stdout.write(renderTasks(items));
      }
    });

  cmd
    .command("show <id>")
    .description("show task detail")
    .option("--json")
    .action(async (id, opts) => {
      const root = defaultRoot();
      await ensureInit(root);
      const found = await showTask(root, id);
      if (!found) fail(`task not found: ${id}`);
      if (opts.json) {
        console.log(asJson({ ...found.task, area: found.board.area, boardId: found.board.id }));
      } else {
        process.stdout.write(renderTaskDetail(found.task, found.board));
      }
    });

  cmd
    .command("edit <id>")
    .description("edit task fields")
    .option("--title <title>")
    .option("--desc <text>")
    .option("--due <YYYY-MM-DD|null>")
    .option("--planned <YYYY-MM-DD|null>", "planned day; 'null' or empty clears")
    .option("--area <area>")
    .option("--board <id>")
    .option("--priority <1-10>", "set priority")
    .option("--parent-goal-ref <ref|null>")
    .option("--note <text|null>", "set or clear (empty string or 'null' clears)")
    .option("--json")
    .action(async (id, opts) => {
      const root = defaultRoot();
      await ensureInit(root);
      try {
        const dueDate = opts.due === undefined ? undefined : opts.due === "null" ? null : opts.due;
        const plannedDate =
          opts.planned === undefined
            ? undefined
            : opts.planned === "null" || opts.planned === ""
              ? null
              : opts.planned;
        const parent =
          opts.parentGoalRef === undefined
            ? undefined
            : opts.parentGoalRef === "null"
              ? null
              : opts.parentGoalRef;
        const note =
          opts.note === undefined
            ? undefined
            : opts.note === "null" || opts.note === ""
              ? null
              : opts.note;
        const { task, board } = await editTask(root, id, {
          title: opts.title,
          description: opts.desc,
          dueDate,
          plannedDate,
          parentGoalRef: parent,
          priority: opts.priority ? parseInt(opts.priority, 10) : undefined,
          note,
          area: opts.area ? parseArea(opts.area) : undefined,
          boardId: opts.board,
        });
        if (opts.json) {
          console.log(asJson({ ...task, area: board.area, boardId: board.id }));
        } else {
          console.log(`edited ${task.id}`);
        }
      } catch (e) {
        fail((e as Error).message);
      }
    });

  cmd
    .command("move <id>")
    .description("move task to a column")
    .requiredOption("--column <todo|doing|done>")
    .action(async (id, opts) => {
      const root = defaultRoot();
      await ensureInit(root);
      try {
        const { task } = await moveTask(root, id, parseColumn(opts.column));
        console.log(`moved ${task.id} → ${task.column}`);
      } catch (e) {
        fail((e as Error).message);
      }
    });

  cmd
    .command("reschedule <id>")
    .description("reschedule task to a future day (sets plannedDate, demotes doing→todo, de-anchors)")
    .requiredOption("--to <YYYY-MM-DD>", "target planned day (must be today or later)")
    .option("--reason <text>", "optional reason logged in the task.rescheduled event")
    .option("--json")
    .action(async (id, opts) => {
      const root = defaultRoot();
      await ensureInit(root);
      try {
        const result = await rescheduleTask(root, id, opts.to, opts.reason ?? null);
        if (opts.json) {
          console.log(
            asJson({
              ok: true,
              id: result.task.id,
              fromPlanned: result.fromPlanned,
              toPlanned: result.toPlanned,
              fromColumn: result.fromColumn,
              column: result.task.column,
            }),
          );
        } else {
          console.log(
            `rescheduled ${result.task.id}: planned ${result.fromPlanned ?? "(null)"} → ${result.toPlanned}` +
              (result.fromColumn === "doing" ? " (demoted doing→todo)" : ""),
          );
        }
      } catch (e) {
        fail((e as Error).message);
      }
    });

  cmd
    .command("delete <id>")
    .description("delete a task")
    .action(async (id) => {
      const root = defaultRoot();
      await ensureInit(root);
      try {
        const t = await deleteTask(root, id);
        console.log(`deleted ${t.id}`);
      } catch (e) {
        fail((e as Error).message);
      }
    });

  cmd
    .command("move-batch")
    .description("move multiple tasks atomically from a JSON array (stdin or file)")
    .requiredOption("--json <path|->", "path to JSON file with array, or '-' for stdin")
    .action(async (opts) => {
      const root = defaultRoot();
      await ensureInit(root);
      let parsed: unknown;
      try {
        parsed = JSON.parse(await readJsonInput(opts.json));
      } catch (e) {
        console.log(asJson({ ok: false, errors: [{ index: -1, field: "json", reason: (e as Error).message }] }));
        process.exit(1);
      }
      if (!Array.isArray(parsed)) {
        console.log(asJson({ ok: false, errors: [{ index: -1, field: "json", reason: "expected array" }] }));
        process.exit(1);
      }
      const items = (parsed as any[]).map((it) => ({
        id: it?.id,
        column: it?.column ? parseColumn(it.column) : it?.column,
      }));
      try {
        const results = await moveTasksBatch(root, items);
        console.log(asJson({ ok: true, items: results }));
      } catch (e) {
        if (e instanceof BatchValidationError) {
          console.log(asJson({ ok: false, errors: e.errors }));
          process.exit(1);
        }
        console.log(asJson({ ok: false, errors: [{ index: -1, field: "batch", reason: (e as Error).message }] }));
        process.exit(1);
      }
    });

  cmd
    .command("reschedule-batch")
    .description("reschedule multiple tasks atomically from a JSON array (stdin or file)")
    .requiredOption("--json <path|->", "path to JSON file with array, or '-' for stdin")
    .action(async (opts) => {
      const root = defaultRoot();
      await ensureInit(root);
      let parsed: unknown;
      try {
        parsed = JSON.parse(await readJsonInput(opts.json));
      } catch (e) {
        console.log(asJson({ ok: false, errors: [{ index: -1, field: "json", reason: (e as Error).message }] }));
        process.exit(1);
      }
      if (!Array.isArray(parsed)) {
        console.log(asJson({ ok: false, errors: [{ index: -1, field: "json", reason: "expected array" }] }));
        process.exit(1);
      }
      const items = (parsed as any[]).map((it) => ({
        id: it?.id,
        to: it?.to,
        reason: it?.reason ?? null,
      }));
      try {
        const results = await rescheduleTasksBatch(root, items);
        console.log(asJson({ ok: true, items: results }));
      } catch (e) {
        if (e instanceof BatchValidationError) {
          console.log(asJson({ ok: false, errors: e.errors }));
          process.exit(1);
        }
        console.log(asJson({ ok: false, errors: [{ index: -1, field: "batch", reason: (e as Error).message }] }));
        process.exit(1);
      }
    });

  cmd
    .command("edit-batch")
    .description("edit multiple tasks atomically from a JSON array (stdin or file)")
    .requiredOption("--json <path|->", "path to JSON file with array, or '-' for stdin")
    .action(async (opts) => {
      const root = defaultRoot();
      await ensureInit(root);
      let parsed: unknown;
      try {
        parsed = JSON.parse(await readJsonInput(opts.json));
      } catch (e) {
        console.log(asJson({ ok: false, errors: [{ index: -1, field: "json", reason: (e as Error).message }] }));
        process.exit(1);
      }
      if (!Array.isArray(parsed)) {
        console.log(asJson({ ok: false, errors: [{ index: -1, field: "json", reason: "expected array" }] }));
        process.exit(1);
      }
      const items = (parsed as any[]).map((it) => {
        const obj: Record<string, unknown> = { id: it?.id };
        if (it?.title !== undefined) obj.title = it.title;
        if (it?.desc !== undefined || it?.description !== undefined) obj.description = it?.desc ?? it?.description;
        if (it?.due !== undefined || it?.dueDate !== undefined) {
          const v = it?.due ?? it?.dueDate;
          obj.dueDate = v === "null" || v === "" ? null : v;
        }
        if (it?.planned !== undefined || it?.plannedDate !== undefined) {
          const v = it?.planned ?? it?.plannedDate;
          obj.plannedDate = v === "null" || v === "" ? null : v;
        }
        if (it?.parentGoalRef !== undefined) obj.parentGoalRef = it.parentGoalRef === "null" ? null : it.parentGoalRef;
        if (it?.priority !== undefined) obj.priority = typeof it.priority === "string" ? parseInt(it.priority, 10) : it.priority;
        if (it?.note !== undefined) obj.note = it.note === "null" || it.note === "" ? null : it.note;
        return obj;
      });
      try {
        const results = await editTasksBatch(root, items as any);
        console.log(asJson({ ok: true, items: results }));
      } catch (e) {
        if (e instanceof BatchValidationError) {
          console.log(asJson({ ok: false, errors: e.errors }));
          process.exit(1);
        }
        console.log(asJson({ ok: false, errors: [{ index: -1, field: "batch", reason: (e as Error).message }] }));
        process.exit(1);
      }
    });

  return cmd;
}
