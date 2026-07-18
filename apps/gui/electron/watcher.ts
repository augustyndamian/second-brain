import chokidar from "chokidar";
import * as path from "node:path";

export type StorageEventType = "add" | "change" | "unlink";

export function startWatcher(
  root: string,
  onChange: (eventType: StorageEventType, filePath: string) => void,
): () => Promise<void> {
  const watcher = chokidar.watch(root, {
    ignored: (p) => p.includes("/.lockfile") || p.endsWith(".tmp") || /\.\d+\.tmp$/.test(p),
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 50, pollInterval: 25 },
  });

  let lastSelfWriteAt = new Map<string, number>();
  watcher.on("all", (event, filePath) => {
    if (event !== "add" && event !== "change" && event !== "unlink") return;
    const now = Date.now();
    const last = lastSelfWriteAt.get(filePath) ?? 0;
    if (now - last < 100) return; // debounce own-write echo
    lastSelfWriteAt.set(filePath, now);
    onChange(event, filePath);
  });

  return async () => {
    await watcher.close();
  };
}

/**
 * Watches `<workspaceDir>/graphify-out/graph.html` (produced by /graphify).
 * Watches the workspace dir itself — always present — because graphify-out/
 * may not exist until the user first runs /graphify, and chokidar v4 is
 * unreliable on not-yet-existing paths. The ignored predicate prunes every
 * other entry so the (potentially large) workspace is never scanned.
 */
export function startGraphWatcher(
  workspaceDir: string,
  onChange: () => void,
): () => Promise<void> {
  const graphDir = path.join(workspaceDir, "graphify-out");
  const graphFile = path.join(graphDir, "graph.html");

  const watcher = chokidar.watch(workspaceDir, {
    depth: 1,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 50 },
    ignored: (p) => p !== workspaceDir && p !== graphDir && p !== graphFile,
  });

  watcher.on("all", (event, filePath) => {
    if (filePath !== graphFile) return;
    if (event !== "add" && event !== "change" && event !== "unlink") return;
    onChange();
  });

  return async () => {
    await watcher.close();
  };
}
