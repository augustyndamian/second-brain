import { Command } from "commander";
import {
  createBoard,
  defaultRoot,
  initStorage,
  ensureStorageReady,
  listBoards,
} from "@second-brain/core";
import { asJson, fail, parseArea } from "../util.js";
import { renderBoards } from "../format.js";

async function ensureInit(root: string) {
  await ensureStorageReady(root);
}

export function boardCommand(): Command {
  const cmd = new Command("board").description("manage boards");

  cmd
    .command("add")
    .description("add a board")
    .requiredOption("--area <area>")
    .requiredOption("--name <name>")
    .option("--default", "mark as default for area")
    .option("--json")
    .action(async (opts) => {
      const root = defaultRoot();
      await ensureInit(root);
      try {
        const b = await createBoard(root, {
          area: parseArea(opts.area),
          name: opts.name,
          isDefault: !!opts.default,
        });
        if (opts.json) console.log(asJson(b));
        else console.log(`created board ${b.id}`);
      } catch (e) {
        fail((e as Error).message);
      }
    });

  cmd
    .command("list")
    .description("list boards")
    .option("--area <area>")
    .option("--json")
    .action(async (opts) => {
      const root = defaultRoot();
      await ensureInit(root);
      const boards = await listBoards(root, opts.area ? parseArea(opts.area) : undefined);
      if (opts.json) console.log(asJson(boards));
      else process.stdout.write(renderBoards(boards));
    });

  return cmd;
}
