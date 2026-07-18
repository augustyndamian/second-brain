import { Command } from "commander";
import {
  appendDailyNote,
  archiveDailyNote,
  defaultRoot,
  ensureStorageReady,
  listArchivedNotes,
  readArchivedDailyNote,
  readDailyNote,
} from "@second-brain/core";
import { asJson, fail } from "../util.js";

async function ensureInit(root: string) {
  await ensureStorageReady(root);
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function notesCommand(): Command {
  const cmd = new Command("notes").description("daily-notes scratchpad");

  cmd
    .command("show")
    .description("read today's (or given date's) scratchpad")
    .option("--date <YYYY-MM-DD>", "date (default: today)")
    .option("--archive", "read from archive/ instead of live")
    .option("--json")
    .action(async (opts) => {
      const root = defaultRoot();
      await ensureInit(root);
      const date = opts.date ?? todayIso();
      try {
        const content = opts.archive
          ? (await readArchivedDailyNote(root, date)) ?? ""
          : await readDailyNote(root, date);
        if (opts.json) {
          console.log(asJson({ date, archive: !!opts.archive, content, empty: content.length === 0 }));
        } else if (content.length === 0) {
          console.log(`# (no daily note for ${date}${opts.archive ? " in archive" : ""})`);
        } else {
          process.stdout.write(content);
          if (!content.endsWith("\n")) process.stdout.write("\n");
        }
      } catch (e) {
        fail((e as Error).message);
      }
    });

  cmd
    .command("add <text>")
    .description("append a free-form note (auto-prefixed with ### HH:MM)")
    .option("--date <YYYY-MM-DD>", "date (default: today)")
    .option("--json")
    .action(async (text: string, opts) => {
      const root = defaultRoot();
      await ensureInit(root);
      const date = opts.date ?? todayIso();
      try {
        await appendDailyNote(root, date, text);
        if (opts.json) {
          console.log(asJson({ ok: true, date }));
        } else {
          console.log(`appended to daily-notes/${date}.md`);
        }
      } catch (e) {
        fail((e as Error).message);
      }
    });

  cmd
    .command("archive")
    .description("move today's (or given date's) scratchpad into archive/")
    .option("--date <YYYY-MM-DD>", "date (default: today)")
    .option("--json")
    .action(async (opts) => {
      const root = defaultRoot();
      await ensureInit(root);
      const date = opts.date ?? todayIso();
      try {
        const result = await archiveDailyNote(root, date);
        if (opts.json) {
          console.log(asJson({ ...result, date }));
        } else if (result.archived) {
          console.log(`archived: ${result.path}`);
        } else {
          console.log(`(nothing to archive for ${date})`);
        }
      } catch (e) {
        fail((e as Error).message);
      }
    });

  cmd
    .command("list-archive")
    .description("list dates with archived notes")
    .option("--json")
    .action(async (opts) => {
      const root = defaultRoot();
      await ensureInit(root);
      const dates = await listArchivedNotes(root);
      if (opts.json) {
        console.log(asJson(dates));
      } else if (dates.length === 0) {
        console.log("(empty archive)");
      } else {
        for (const d of dates) console.log(d);
      }
    });

  return cmd;
}
