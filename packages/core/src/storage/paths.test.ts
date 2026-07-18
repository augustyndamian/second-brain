import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceNotFoundError, defaultRoot, resolveRootInfo } from "./paths.js";

let dir: string;
let home: string;
const envKeys = ["KB_KANBAN_ROOT", "KB_DEV", "HOME", "USERPROFILE"] as const;
let savedEnv: Record<string, string | undefined>;

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), "kb-paths-"));
  home = await fs.mkdtemp(join(tmpdir(), "kb-home-"));
  savedEnv = Object.fromEntries(envKeys.map((k) => [k, process.env[k]]));
  for (const k of envKeys) delete process.env[k];
  // os.homedir() reads $HOME on posix — point it at an empty dir so no real pointer leaks in.
  process.env.HOME = home;
  process.env.USERPROFILE = home;
});

afterEach(async () => {
  vi.restoreAllMocks();
  for (const k of envKeys) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k]!;
  }
  await fs.rm(dir, { recursive: true, force: true });
  await fs.rm(home, { recursive: true, force: true });
});

function chdir(to: string) {
  vi.spyOn(process, "cwd").mockReturnValue(to);
}

async function writePointer(workspace: string) {
  await fs.mkdir(join(home, ".config", "kb"), { recursive: true });
  await fs.writeFile(join(home, ".config", "kb", "workspace"), `${workspace}\n`, "utf8");
}

describe("defaultRoot", () => {
  it("prefers KB_KANBAN_ROOT verbatim", async () => {
    process.env.KB_KANBAN_ROOT = join(dir, "explicit");
    await fs.mkdir(join(dir, ".kanban"), { recursive: true });
    chdir(dir);
    expect(defaultRoot()).toBe(join(dir, "explicit"));
    expect(resolveRootInfo().source).toBe("env");
  });

  it("walks up from cwd to find .kanban/", async () => {
    const nested = join(dir, "a", "b", "c");
    await fs.mkdir(nested, { recursive: true });
    await fs.mkdir(join(dir, ".kanban"), { recursive: true });
    chdir(nested);
    expect(defaultRoot()).toBe(join(dir, ".kanban"));
    expect(resolveRootInfo().source).toBe("walk-up");
  });

  it("falls back to the workspace pointer when no .kanban/ is above cwd", async () => {
    const workspace = join(dir, "ws");
    await fs.mkdir(join(workspace, ".kanban"), { recursive: true });
    const elsewhere = join(dir, "elsewhere");
    await fs.mkdir(elsewhere, { recursive: true });
    await writePointer(workspace);
    chdir(elsewhere);
    expect(defaultRoot()).toBe(join(workspace, ".kanban"));
    expect(resolveRootInfo().source).toBe("pointer");
  });

  it("KB_DEV=1 selects the .kanban-dev sandbox", async () => {
    process.env.KB_DEV = "1";
    await fs.mkdir(join(dir, ".kanban"), { recursive: true });
    await fs.mkdir(join(dir, ".kanban-dev"), { recursive: true });
    chdir(dir);
    expect(defaultRoot()).toBe(join(dir, ".kanban-dev"));
  });

  it("KB_DEV=1 applies to the pointer path too", async () => {
    process.env.KB_DEV = "1";
    const workspace = join(dir, "ws");
    await fs.mkdir(workspace, { recursive: true });
    const elsewhere = join(dir, "elsewhere");
    await fs.mkdir(elsewhere, { recursive: true });
    await writePointer(workspace);
    chdir(elsewhere);
    expect(defaultRoot()).toBe(join(workspace, ".kanban-dev"));
  });

  it("throws a WorkspaceNotFoundError when nothing resolves", async () => {
    const isolated = join(dir, "isolated");
    await fs.mkdir(isolated, { recursive: true });
    chdir(isolated);
    expect(() => defaultRoot()).toThrow(WorkspaceNotFoundError);
    expect(resolveRootInfo()).toEqual({ root: null, source: "none" });
  });
});
