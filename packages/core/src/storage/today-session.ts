import { promises as fs } from "node:fs";
import { join } from "node:path";
import { atomicAppend, readTextOrNull } from "./atomic.js";
import { paths } from "./paths.js";

export interface RecurringStatEntry {
  date: string;
  ruleId: string;
  status: "done" | "missed";
  points: number;
}

export interface TodaySessionSnapshot {
  date: string;
  triggeredAt: string;
  tasks: { id: string; title: string; area: string; column: string }[];
  recurring: { ruleId: string; title: string; area: string; status: string }[];
  /** Active-session model fields. Optional for legacy compatibility. */
  status?: "open" | "closed" | "auto-closed";
  startedAt?: string;
  closedAt?: string | null;
  anchoredTaskIds?: string[];
  /** Frozen snapshot of doing tasks captured at close. */
  doingSnapshot?: { id: string; title: string; area: string; column: string }[];
}

function statsFile(root: string): string {
  return join(paths(root).root, "recurring-stats.jsonl");
}

function sessionsDir(root: string): string {
  return join(paths(root).root, "today-sessions");
}

function sessionFile(root: string, date: string): string {
  return join(sessionsDir(root), `${date}.json`);
}

export async function appendRecurringStat(root: string, entry: RecurringStatEntry): Promise<void> {
  await atomicAppend(statsFile(root), JSON.stringify(entry));
}

export async function readRecurringStats(root: string): Promise<RecurringStatEntry[]> {
  const text = await readTextOrNull(statsFile(root));
  if (!text) return [];
  const out: RecurringStatEntry[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* skip */ }
  }
  return out;
}

export async function saveSessionSnapshot(root: string, snapshot: TodaySessionSnapshot): Promise<void> {
  await fs.mkdir(sessionsDir(root), { recursive: true });
  await fs.writeFile(sessionFile(root, snapshot.date), JSON.stringify(snapshot, null, 2));
}

export async function readSessionSnapshot(root: string, date: string): Promise<TodaySessionSnapshot | null> {
  try {
    const text = await fs.readFile(sessionFile(root, date), "utf-8");
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function listSessionDates(root: string): Promise<string[]> {
  const dir = sessionsDir(root);
  try {
    const files = await fs.readdir(dir);
    return files
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(".json", ""))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}
