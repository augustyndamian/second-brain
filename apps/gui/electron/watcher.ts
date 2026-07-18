import chokidar from "chokidar";

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
