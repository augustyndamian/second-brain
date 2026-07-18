import { Command } from "commander";
import {
  createArea,
  defaultRoot,
  editArea,
  ensureStorageReady,
  listAreas,
  removeArea,
} from "@second-brain/core";
import { asJson, fail, parseArea } from "../util.js";
import { renderAreas } from "../format.js";

async function ensureInit(root: string) {
  await ensureStorageReady(root);
}

export function areaCommand(): Command {
  const cmd = new Command("area").description("manage life areas");

  cmd
    .command("list")
    .description("list configured areas")
    .option("--json")
    .action(async (opts) => {
      const root = defaultRoot();
      await ensureInit(root);
      const areas = await listAreas(root);
      if (opts.json) console.log(asJson(areas));
      else process.stdout.write(renderAreas(areas));
    });

  cmd
    .command("add")
    .description("add an area (creates its default board)")
    .requiredOption("--id <id>", "lowercase id, e.g. work or side-projects (immutable)")
    .requiredOption("--label <label>", "display name, e.g. Work")
    .option("--emoji <emoji>", "sidebar icon")
    .option("--color <#rrggbb>", "accent color")
    .option("--prefix <prefix>", "task id prefix (defaults to the id)")
    .option("--json")
    .action(async (opts) => {
      const root = defaultRoot();
      await ensureInit(root);
      try {
        const area = await createArea(root, {
          id: parseArea(opts.id),
          label: opts.label,
          emoji: opts.emoji,
          color: opts.color,
          prefix: opts.prefix,
        });
        if (opts.json) console.log(asJson(area));
        else console.log(`created area ${area.id} (board b_${area.id}_main)`);
      } catch (e) {
        fail((e as Error).message);
      }
    });

  cmd
    .command("edit")
    .description("edit an area's label, emoji, color or task prefix")
    .requiredOption("--id <id>")
    .option("--label <label>")
    .option("--emoji <emoji>")
    .option("--color <#rrggbb>")
    .option("--prefix <prefix>")
    .option("--json")
    .action(async (opts) => {
      const root = defaultRoot();
      await ensureInit(root);
      const patch = {
        ...(opts.label !== undefined ? { label: opts.label } : {}),
        ...(opts.emoji !== undefined ? { emoji: opts.emoji } : {}),
        ...(opts.color !== undefined ? { color: opts.color } : {}),
        ...(opts.prefix !== undefined ? { prefix: opts.prefix } : {}),
      };
      if (Object.keys(patch).length === 0) fail("nothing to edit: pass at least one of --label/--emoji/--color/--prefix");
      try {
        const area = await editArea(root, parseArea(opts.id), patch);
        if (opts.json) console.log(asJson(area));
        else console.log(`updated area ${area.id}`);
      } catch (e) {
        fail((e as Error).message);
      }
    });

  cmd
    .command("remove")
    .description("remove an area (refused while tasks, rules or tracked items reference it)")
    .requiredOption("--id <id>")
    .action(async (opts) => {
      const root = defaultRoot();
      await ensureInit(root);
      try {
        await removeArea(root, parseArea(opts.id));
        console.log(`removed area ${opts.id}`);
      } catch (e) {
        fail((e as Error).message);
      }
    });

  return cmd;
}
