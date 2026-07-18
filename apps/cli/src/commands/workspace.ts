import { Command } from "commander";
import { initWorkspace, workspaceStatus } from "@second-brain/core";
import { asJson, fail } from "../util.js";

export function workspaceCommand(): Command {
  const cmd = new Command("workspace").description("inspect or set up the workspace this CLI reads");

  cmd
    .command("status")
    .description("show the resolved storage root and where it came from")
    .option("--json")
    .action(async (opts) => {
      const st = await workspaceStatus();
      if (opts.json) {
        console.log(asJson(st));
        return;
      }
      if (!st.root) {
        console.log("workspace:  (none resolved)");
        console.log(`storage:    ${st.storageDir}/`);
        console.log(`pointer:    ${st.pointerFile} (not set)`);
        console.log("");
        console.log("run `kb workspace init` in your workspace, or set KB_KANBAN_ROOT.");
        return;
      }
      console.log(`workspace:  ${st.workspace}`);
      console.log(`storage:    ${st.root}`);
      console.log(`resolved:   ${st.source}`);
      console.log(`initialized:${st.initialized ? " yes" : " no"}`);
      console.log(`pointer:    ${st.pointer ?? "(not set)"}`);
    });

  cmd
    .command("init")
    .description("initialize a workspace here (or at <path>) and record it as the default")
    .argument("[path]", "workspace directory", ".")
    .option("--keep-pointer", "do not overwrite an existing workspace pointer")
    .option("--json")
    .action(async (path: string, opts) => {
      try {
        const res = await initWorkspace(path, { keepExistingPointer: !!opts.keepPointer });
        if (opts.json) {
          console.log(asJson(res));
          return;
        }
        console.log(`workspace ready: ${res.workspace}`);
        console.log(`storage:         ${res.root}`);
        console.log(
          res.pointerWritten
            ? "recorded as the default workspace."
            : "kept the existing workspace pointer.",
        );
      } catch (e) {
        fail((e as Error).message);
      }
    });

  return cmd;
}
