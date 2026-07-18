import { Command } from "commander";
import { defaultRoot, ensureStorageReady, readEvents } from "@second-brain/core";
import { asJson } from "../util.js";

export function eventsCommand(): Command {
  const cmd = new Command("events").description("audit trail operations");

  cmd
    .command("lint")
    .description("scan events.jsonl for suspicious patterns (forward-dated recurring.done, bursts, etc.)")
    .option("--json", "JSON output")
    .action(async (opts) => {
      const root = defaultRoot();
      await ensureStorageReady(root);

      const events = await readEvents(root);
      const suspicious: { lineIndex: number; type: string; reason: string; event: unknown }[] = [];

      for (let i = 0; i < events.length; i++) {
        const e = events[i] as any;

        // Forward-dated recurring.done: forDate > ts date part
        if (e.type === "recurring.done" && e.forDate && e.ts) {
          const tsDate = e.ts.slice(0, 10);
          if (e.forDate > tsDate) {
            suspicious.push({ lineIndex: i, type: "forward-dated-recurring-done", reason: `forDate ${e.forDate} > ts date ${tsDate}`, event: e });
          }
        }

        // Burst: >5 events in the same second
        if (i >= 5) {
          const sameSecond = events
            .slice(Math.max(0, i - 9), i + 1)
            .filter((ev: any) => ev.ts?.slice(0, 19) === e.ts?.slice(0, 19));
          if (sameSecond.length > 5) {
            // Only flag the first occurrence of each burst second to avoid spam
            const prevSameSecond = suspicious.find(
              (s) => s.type === "burst" && (s.event as any).ts?.slice(0, 19) === e.ts?.slice(0, 19),
            );
            if (!prevSameSecond) {
              suspicious.push({ lineIndex: i, type: "burst", reason: `${sameSecond.length} events in same second (${e.ts?.slice(0, 19)}) — possible test data`, event: e });
            }
          }
        }

        // recurring.done before session.opened for same forDate
        if (e.type === "recurring.done" && e.forDate) {
          const sessionOpened = events.find(
            (ev: any) => ev.type === "session.opened" && ev.date === e.forDate,
          );
          if (!sessionOpened) {
            suspicious.push({ lineIndex: i, type: "recurring-done-no-session", reason: `recurring.done for ${e.forDate} — no session.opened event found for that date`, event: e });
          }
        }
      }

      if (opts.json) {
        console.log(asJson({ ok: true, suspiciousCount: suspicious.length, entries: suspicious }));
        return;
      }

      if (suspicious.length === 0) {
        console.log("✓ events.jsonl — no suspicious patterns found");
        return;
      }

      console.log(`⚠ ${suspicious.length} suspicious event(s) found:\n`);
      for (const s of suspicious) {
        console.log(`  line ${s.lineIndex}: [${s.type}] ${s.reason}`);
      }
      console.log(`\nTo remove a line: kb events remove-line <lineIndex>`);
    });

  cmd
    .command("remove-line <lineIndex>")
    .description("remove a specific line from events.jsonl by index (0-based) — requires confirmation")
    .option("--confirm", "skip interactive prompt (use in scripts)")
    .option("--json", "JSON output")
    .action(async (lineIndexStr, opts) => {
      const root = defaultRoot();
      await ensureStorageReady(root);
      const lineIndex = parseInt(lineIndexStr, 10);
      if (isNaN(lineIndex) || lineIndex < 0) {
        console.error("lineIndex must be a non-negative integer");
        process.exit(1);
      }

      const events = await readEvents(root);
      if (lineIndex >= events.length) {
        console.error(`lineIndex ${lineIndex} out of range (events.jsonl has ${events.length} lines)`);
        process.exit(1);
      }

      const target = events[lineIndex] as any;
      if (!opts.confirm) {
        console.log(`Will remove line ${lineIndex}: type=${target.type} ts=${target.ts}`);
        console.log("Re-run with --confirm to apply.");
        process.exit(0);
      }

      // Write back without the target line.
      const { promises: fs } = await import("node:fs");
      const { join } = await import("node:path");
      const eventsPath = join(root, "events.jsonl");
      const lines = events.filter((_, i) => i !== lineIndex).map((e) => JSON.stringify(e));
      await fs.writeFile(eventsPath, lines.join("\n") + (lines.length ? "\n" : ""), "utf-8");

      if (opts.json) {
        console.log(asJson({ ok: true, removed: target, newLength: events.length - 1 }));
      } else {
        console.log(`Removed line ${lineIndex} (${target.type} @ ${target.ts}). events.jsonl now has ${events.length - 1} lines.`);
      }
    });

  return cmd;
}
