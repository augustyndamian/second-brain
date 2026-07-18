import { Command } from "commander";
import {
  closeSession,
  defaultRoot,
  ensureSession,
  initStorage,
  ensureStorageReady,
  readActive,
} from "@second-brain/core";
import { asJson } from "../util.js";

async function ensureInit(root: string) {
  await ensureStorageReady(root);
}

export function sessionCommand(): Command {
  const cmd = new Command("session").description("manage today's active session");

  cmd
    .command("close")
    .description("close active session — snapshot doing tasks + mark missed recurring")
    .option("--json")
    .action(async (opts) => {
      const root = defaultRoot();
      await ensureInit(root);
      const result = await closeSession(root);
      if (!result) {
        if (opts.json) {
          console.log(asJson({ closed: false, reason: "no active session" }));
        } else {
          console.log("no active session to close");
        }
        return;
      }
      if (opts.json) {
        console.log(asJson({ closed: true, ...result }));
        return;
      }
      console.log(`closed session ${result.date} (${result.status})`);
      console.log(`  doing snapshot: ${result.doingCount} task(s)`);
      console.log(`  recurring missed: ${result.missedMarked.length}`);
      if (result.unfinishedTaskIds.length > 0) {
        console.log(`  unfinished anchored: ${result.unfinishedTaskIds.join(", ")}`);
      }
    });

  cmd
    .command("status")
    .description("show current active session")
    .option("--json")
    .action(async (opts) => {
      const root = defaultRoot();
      await ensureInit(root);
      const active = await readActive(root);
      if (opts.json) {
        console.log(asJson(active));
        return;
      }
      if (!active) {
        console.log("(no active session)");
        return;
      }
      console.log(`date: ${active.date}`);
      console.log(`status: ${active.status}`);
      console.log(`startedAt: ${active.startedAt}`);
      console.log(`anchored: ${active.anchoredTaskIds.length} task(s)`);
    });

  cmd
    .command("ensure")
    .description("ensure an active session exists (lazy open + auto-close stale)")
    .option("--json")
    .action(async (opts) => {
      const root = defaultRoot();
      await ensureInit(root);
      const result = await ensureSession(root);
      if (opts.json) {
        console.log(asJson(result));
        return;
      }
      console.log(`active session: ${result.session.date} (${result.session.status})`);
      if (result.autoClosed) {
        console.log(`  auto-closed previous: ${result.autoClosed.date} after ${result.autoClosed.hoursOpen}h (${result.autoClosed.missedCount} missed)`);
      }
    });

  return cmd;
}
