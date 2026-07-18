import { Command } from "commander";
import {
  BatchValidationError,
  ScheduleSchema,
  WeekdaySchema,
  createRule,
  createRulesBatch,
  defaultRoot,
  deleteRule,
  initStorage,
  ensureStorageReady,
  listAllRules,
  markRuleDone,
  markRuleSkipped,
  rescheduleRule,
  toggleRule,
  type Schedule,
  type Weekday,
} from "@second-brain/core";
import { asJson, fail, parseArea, readJsonInput } from "../util.js";
import { renderTable } from "../format.js";

async function ensureInit(root: string) {
  await ensureStorageReady(root);
}

function parseSchedule(opts: {
  schedule: string;
  days?: string;
  everyNDays?: string;
  dayOfMonth?: string;
}): Schedule {
  switch (opts.schedule) {
    case "daily":
      return { type: "daily" };
    case "weekdays":
      return { type: "weekdays" };
    case "weekly": {
      if (!opts.days) throw new Error("--days required for weekly schedule");
      const days = opts.days.split(",").map((d) => d.trim().toLowerCase()) as Weekday[];
      days.forEach((d) => WeekdaySchema.parse(d));
      return { type: "weekly", daysOfWeek: days };
    }
    case "interval": {
      const n = Number(opts.everyNDays);
      if (!Number.isInteger(n) || n <= 0) throw new Error("--every-n-days must be positive integer");
      return { type: "interval", everyNDays: n };
    }
    case "monthly": {
      const d = Number(opts.dayOfMonth);
      if (!Number.isInteger(d) || d < 1 || d > 31) throw new Error("--day-of-month must be 1-31");
      return { type: "monthly", dayOfMonth: d };
    }
    default:
      throw new Error(`unknown schedule type: ${opts.schedule}`);
  }
}

function describeSchedule(s: Schedule): string {
  switch (s.type) {
    case "daily":
      return "daily";
    case "weekdays":
      return "weekdays";
    case "weekly":
      return `weekly[${s.daysOfWeek.join(",")}]`;
    case "interval":
      return `every ${s.everyNDays}d`;
    case "monthly":
      return `monthly d${s.dayOfMonth}`;
  }
}

export function recurringCommand(): Command {
  const cmd = new Command("recurring").description("manage recurring rules");

  cmd
    .command("add")
    .description("add a recurring rule")
    .requiredOption("--area <area>")
    .requiredOption("--title <title>")
    .requiredOption("--schedule <daily|weekdays|weekly|interval|monthly>")
    .option("--days <mon,wed,fri>", "for weekly")
    .option("--every-n-days <n>", "for interval")
    .option("--day-of-month <n>", "for monthly")
    .option("--board <id>")
    .option("--desc <text>")
    .option("--starts-on <YYYY-MM-DD>")
    .option("--ends-on <YYYY-MM-DD>")
    .option("--parent-goal-ref <ref>")
    .option("--json")
    .action(async (opts) => {
      const root = defaultRoot();
      await ensureInit(root);
      try {
        const schedule = parseSchedule(opts);
        const rule = await createRule(root, {
          area: parseArea(opts.area),
          title: opts.title,
          description: opts.desc,
          schedule,
          startsOn: opts.startsOn,
          endsOn: opts.endsOn ?? null,
          parentGoalRef: opts.parentGoalRef ?? null,
          boardId: opts.board ?? null,
        });
        if (opts.json) console.log(asJson(rule));
        else console.log(`created rule ${rule.id} (${describeSchedule(rule.schedule)})`);
      } catch (e) {
        fail((e as Error).message);
      }
    });

  cmd
    .command("add-batch")
    .description("add multiple recurring rules atomically from a JSON array (stdin or file)")
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

      const inputs: any[] = [];
      const preErrors: { index: number; field: string; reason: string }[] = [];
      (parsed as any[]).forEach((it, i) => {
        if (!it || typeof it !== "object") {
          preErrors.push({ index: i, field: "item", reason: "not an object" });
          return;
        }
        if ("priority" in it) {
          preErrors.push({ index: i, field: "priority", reason: "recurring.add does not accept priority" });
          return;
        }
        if ("due" in it || "dueDate" in it) {
          preErrors.push({ index: i, field: "due", reason: "recurring.add does not accept due — use schedule" });
          return;
        }
        let schedule: Schedule;
        try {
          schedule = ScheduleSchema.parse(it.schedule);
        } catch (e) {
          preErrors.push({ index: i, field: "schedule", reason: (e as Error).message });
          return;
        }
        inputs.push({
          area: typeof it.area === "string" ? parseArea(it.area) : it.area,
          title: it.title,
          description: it.desc ?? it.description,
          parentGoalRef: it.parentGoalRef ?? null,
          schedule,
          startsOn: it.startsOn,
          endsOn: it.endsOn ?? null,
          boardId: it.board ?? it.boardId ?? null,
          points: it.points,
        });
      });
      if (preErrors.length > 0) {
        console.log(asJson({ ok: false, errors: preErrors }));
        process.exit(1);
      }

      try {
        const rules = await createRulesBatch(root, inputs);
        console.log(asJson({
          ok: true,
          items: rules.map((r) => ({ id: r.id, area: r.area, boardId: r.boardId, schedule: r.schedule })),
        }));
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
    .description("list recurring rules")
    .option("--area <area>")
    .option("--json")
    .action(async (opts) => {
      const root = defaultRoot();
      await ensureInit(root);
      const rules = await listAllRules(root, opts.area ? parseArea(opts.area) : undefined);
      if (opts.json) {
        console.log(asJson(rules));
        return;
      }
      const rows = rules.map((r) => [
        r.id,
        r.area,
        r.active ? "on" : "off",
        describeSchedule(r.schedule),
        r.startsOn,
        r.endsOn ?? "—",
        r.title,
      ]);
      process.stdout.write(
        renderTable(rows, ["ID", "AREA", "STATUS", "SCHEDULE", "STARTS", "ENDS", "TITLE"]),
      );
    });

  cmd
    .command("done <ruleId>")
    .description("mark a rule done for a date (default: today)")
    .option("--date <YYYY-MM-DD>")
    .action(async (ruleId, opts) => {
      const root = defaultRoot();
      await ensureInit(root);
      try {
        await markRuleDone(root, ruleId, opts.date);
        console.log(`done ${ruleId} ${opts.date ?? "(today)"}`);
      } catch (e) {
        fail((e as Error).message);
      }
    });

  cmd
    .command("skip <ruleId>")
    .description("mark a rule skipped for a date")
    .option("--date <YYYY-MM-DD>")
    .option("--reason <text>")
    .action(async (ruleId, opts) => {
      const root = defaultRoot();
      await ensureInit(root);
      try {
        await markRuleSkipped(root, ruleId, opts.date, opts.reason ?? null);
        console.log(`skipped ${ruleId} ${opts.date ?? "(today)"}`);
      } catch (e) {
        fail((e as Error).message);
      }
    });

  cmd
    .command("reschedule <ruleId>")
    .description("move a single occurrence to another date")
    .requiredOption("--from <YYYY-MM-DD>")
    .requiredOption("--to <YYYY-MM-DD>")
    .option("--reason <text>")
    .action(async (ruleId, opts) => {
      const root = defaultRoot();
      await ensureInit(root);
      try {
        await rescheduleRule(root, ruleId, opts.from, opts.to, opts.reason ?? null);
        console.log(`rescheduled ${ruleId} ${opts.from} → ${opts.to}`);
      } catch (e) {
        fail((e as Error).message);
      }
    });

  cmd
    .command("toggle <ruleId>")
    .description("toggle active flag")
    .action(async (ruleId) => {
      const root = defaultRoot();
      await ensureInit(root);
      try {
        const r = await toggleRule(root, ruleId);
        console.log(`${ruleId} → ${r.active ? "active" : "inactive"}`);
      } catch (e) {
        fail((e as Error).message);
      }
    });

  cmd
    .command("delete <ruleId>")
    .description("delete a rule")
    .action(async (ruleId) => {
      const root = defaultRoot();
      await ensureInit(root);
      try {
        const r = await deleteRule(root, ruleId);
        console.log(`deleted ${r.id}`);
      } catch (e) {
        fail((e as Error).message);
      }
    });

  return cmd;
}
