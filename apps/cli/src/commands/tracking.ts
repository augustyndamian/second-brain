import { Command } from "commander";
import {
  AreaSchema,
  TrackingKindSchema,
  TrackingStatusSchema,
  createTrackingItem,
  createTrackingItemsBatch,
  defaultRoot,
  deleteTrackingItem,
  editTrackingItem,
  editTrackingItemsBatch,
  initStorage,
  ensureStorageReady,
  listTracking,
} from "@second-brain/core";
import { asJson, fail, parseArea, readJsonInput } from "../util.js";
import { renderTable } from "../format.js";

async function ensureInit(root: string) {
  await ensureStorageReady(root);
}

function parseKind(v: string) {
  return TrackingKindSchema.parse(v.toLowerCase());
}
function parseStatus(v: string) {
  return TrackingStatusSchema.parse(v.toLowerCase());
}

export function trackingCommand(): Command {
  const cmd = new Command("tracking").description("manage tracker items (commitments / events / external tasks)");

  cmd
    .command("add")
    .description("add a tracker item")
    .requiredOption("--kind <commitment|event|external-task>")
    .requiredOption("--area <area>")
    .requiredOption("--title <title>")
    .option("--assignee <name>", "who owns it, e.g. alice | bob | external")
    .option("--due <YYYY-MM-DD>")
    .option("--status <todo|in-progress|done|cancelled>", "default: todo")
    .option("--note <text>")
    .option("--json")
    .action(async (opts) => {
      const root = defaultRoot();
      await ensureInit(root);
      try {
        const item = await createTrackingItem(root, {
          kind: parseKind(opts.kind),
          area: parseArea(opts.area),
          title: opts.title,
          assignee: opts.assignee ?? null,
          dueDate: opts.due ?? null,
          status: opts.status ? parseStatus(opts.status) : "todo",
          note: opts.note ?? "",
        });
        if (opts.json) console.log(asJson(item));
        else console.log(`created ${item.id}`);
      } catch (e) {
        fail((e as Error).message);
      }
    });

  cmd
    .command("add-batch")
    .description("add multiple tracker items from a JSON array (stdin or file)")
    .requiredOption("--json <path|->", "path to JSON file with array, or '-' for stdin")
    .action(async (opts) => {
      const root = defaultRoot();
      await ensureInit(root);
      let parsed: unknown;
      try {
        parsed = JSON.parse(await readJsonInput(opts.json));
      } catch (e) {
        console.log(asJson({ ok: false, error: (e as Error).message }));
        process.exit(1);
      }
      if (!Array.isArray(parsed)) {
        console.log(asJson({ ok: false, error: "expected array" }));
        process.exit(1);
      }
      const inputs = (parsed as any[]).map((it) => ({
        kind: TrackingKindSchema.parse(String(it?.kind ?? "").toLowerCase()),
        area: AreaSchema.parse(String(it?.area ?? "").toLowerCase()),
        title: it?.title,
        assignee: it?.assignee ?? null,
        dueDate: it?.due ?? it?.dueDate ?? null,
        status: it?.status ? TrackingStatusSchema.parse(String(it.status).toLowerCase()) : ("todo" as const),
        note: it?.note ?? "",
      }));
      try {
        const created = await createTrackingItemsBatch(root, inputs);
        console.log(asJson({ ok: true, items: created.map((i) => ({ id: i.id, area: i.area, kind: i.kind })) }));
      } catch (e) {
        console.log(asJson({ ok: false, error: (e as Error).message }));
        process.exit(1);
      }
    });

  cmd
    .command("list")
    .description("list tracker items")
    .option("--area <area>")
    .option("--kind <kind>")
    .option("--assignee <name>")
    .option("--status <status>")
    .option("--due-before <YYYY-MM-DD>")
    .option("--due-after <YYYY-MM-DD>")
    .option("--not-done", "exclude done & cancelled")
    .option("--json")
    .action(async (opts) => {
      const root = defaultRoot();
      await ensureInit(root);
      const items = await listTracking(root, {
        area: opts.area ? parseArea(opts.area) : undefined,
        kind: opts.kind ? parseKind(opts.kind) : undefined,
        assignee: opts.assignee !== undefined ? opts.assignee : undefined,
        status: opts.status ? parseStatus(opts.status) : undefined,
        dueBefore: opts.dueBefore,
        dueAfter: opts.dueAfter,
        notDone: opts.notDone === true ? true : undefined,
      });
      if (opts.json) {
        console.log(asJson(items));
        return;
      }
      if (items.length === 0) {
        console.log("(no tracking items)");
        return;
      }
      const rows = items.map((i) => [
        i.id,
        i.kind,
        i.area,
        i.assignee ?? "—",
        i.dueDate ?? "—",
        i.status,
        i.title,
      ]);
      process.stdout.write(renderTable(rows, ["ID", "KIND", "AREA", "ASSIGNEE", "DUE", "STATUS", "TITLE"]));
    });

  cmd
    .command("edit <id>")
    .description("edit a tracker item")
    .option("--kind <kind>")
    .option("--area <area>")
    .option("--title <title>")
    .option("--assignee <name|null>")
    .option("--due <YYYY-MM-DD|null>")
    .option("--status <status>")
    .option("--note <text>")
    .option("--json")
    .action(async (id, opts) => {
      const root = defaultRoot();
      await ensureInit(root);
      try {
        const dueDate =
          opts.due === undefined ? undefined : opts.due === "null" || opts.due === "" ? null : opts.due;
        const assignee =
          opts.assignee === undefined ? undefined : opts.assignee === "null" || opts.assignee === "" ? null : opts.assignee;
        const item = await editTrackingItem(root, id, {
          kind: opts.kind ? parseKind(opts.kind) : undefined,
          area: opts.area ? parseArea(opts.area) : undefined,
          title: opts.title,
          assignee,
          dueDate,
          status: opts.status ? parseStatus(opts.status) : undefined,
          note: opts.note,
        });
        if (opts.json) console.log(asJson(item));
        else console.log(`edited ${item.id}`);
      } catch (e) {
        fail((e as Error).message);
      }
    });

  cmd
    .command("delete <id>")
    .description("delete a tracker item")
    .action(async (id) => {
      const root = defaultRoot();
      await ensureInit(root);
      try {
        const item = await deleteTrackingItem(root, id);
        console.log(`deleted ${item.id}`);
      } catch (e) {
        fail((e as Error).message);
      }
    });

  cmd
    .command("edit-batch")
    .description("edit multiple tracker items atomically from a JSON array (stdin or file)")
    .requiredOption("--json <path|->", "path to JSON file with array, or '-' for stdin")
    .action(async (opts) => {
      const root = defaultRoot();
      await ensureInit(root);
      let parsed: unknown;
      try {
        parsed = JSON.parse(await readJsonInput(opts.json));
      } catch (e) {
        console.log(asJson({ ok: false, error: (e as Error).message }));
        process.exit(1);
      }
      if (!Array.isArray(parsed)) {
        console.log(asJson({ ok: false, error: "expected array" }));
        process.exit(1);
      }
      const items = (parsed as any[]).map((it) => {
        const obj: Record<string, unknown> = { id: it?.id };
        if (it?.kind !== undefined) obj.kind = TrackingKindSchema.parse(String(it.kind).toLowerCase());
        if (it?.area !== undefined) obj.area = AreaSchema.parse(String(it.area).toLowerCase());
        if (it?.title !== undefined) obj.title = it.title;
        if (it?.assignee !== undefined) obj.assignee = it.assignee === "null" || it.assignee === "" ? null : it.assignee;
        if (it?.due !== undefined || it?.dueDate !== undefined) {
          const v = it?.due ?? it?.dueDate;
          obj.dueDate = v === "null" || v === "" ? null : v;
        }
        if (it?.status !== undefined) obj.status = TrackingStatusSchema.parse(String(it.status).toLowerCase());
        if (it?.note !== undefined) obj.note = it.note;
        return obj;
      });
      try {
        const results = await editTrackingItemsBatch(root, items as any);
        console.log(asJson({ ok: true, items: results.map((r) => ({ id: r.id, changed: Object.keys(r.changes) })) }));
      } catch (e) {
        console.log(asJson({ ok: false, error: (e as Error).message }));
        process.exit(1);
      }
    });

  return cmd;
}
