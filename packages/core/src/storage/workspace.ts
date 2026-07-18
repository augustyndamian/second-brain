import { promises as fs } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { ensureStorageReady } from "./init.js";
import { resolveRootInfo, storageDirName, workspacePointerFile, type RootSource } from "./paths.js";

export interface WorkspaceStatus {
  /** Resolved storage root, or null when nothing could be resolved. */
  root: string | null;
  source: RootSource;
  /** Workspace directory (the parent of the storage dir), when one is resolved. */
  workspace: string | null;
  pointerFile: string;
  pointer: string | null;
  storageDir: string;
  initialized: boolean;
}

export async function workspaceStatus(): Promise<WorkspaceStatus> {
  const { root, source } = resolveRootInfo();
  const pointerFile = workspacePointerFile();
  const pointer = await fs.readFile(pointerFile, "utf8").then((t) => t.trim() || null).catch(() => null);
  const initialized = root ? await fs.access(join(root, "meta.yaml")).then(() => true).catch(() => false) : false;
  return {
    root,
    source,
    workspace: root ? dirname(root) : null,
    pointerFile,
    pointer,
    storageDir: storageDirName(),
    initialized,
  };
}

export interface InitWorkspaceOpts {
  /** Leave an existing pointer alone (used by the installer). */
  keepExistingPointer?: boolean;
}

export interface InitWorkspaceResult {
  workspace: string;
  root: string;
  pointerWritten: boolean;
}

/**
 * Makes `dir` a workspace: creates its storage directory, bootstraps storage and
 * records it as the fallback workspace in `~/.config/kb/workspace`.
 */
export async function initWorkspace(dir: string, opts: InitWorkspaceOpts = {}): Promise<InitWorkspaceResult> {
  const workspace = resolve(dir);
  const root = join(workspace, storageDirName());
  await fs.mkdir(root, { recursive: true });
  await ensureStorageReady(root);

  const pointerFile = workspacePointerFile();
  const existing = await fs.readFile(pointerFile, "utf8").then((t) => t.trim()).catch(() => "");
  const pointerWritten = !(opts.keepExistingPointer && existing !== "");
  if (pointerWritten) {
    await fs.mkdir(dirname(pointerFile), { recursive: true });
    await fs.writeFile(pointerFile, `${workspace}\n`, "utf8");
  }
  return { workspace, root, pointerWritten };
}
