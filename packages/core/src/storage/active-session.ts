import { promises as fs } from "node:fs";
import { join } from "node:path";
import { atomicWrite, readTextOrNull } from "./atomic.js";
import { paths } from "./paths.js";
import { ActiveSessionSchema, type ActiveSession } from "../types.js";

export const STALE_SESSION_HOURS = 72;

function activeFile(root: string): string {
  return join(paths(root).root, "today-sessions", "active.json");
}

export async function readActive(root: string): Promise<ActiveSession | null> {
  const text = await readTextOrNull(activeFile(root));
  if (!text || !text.trim()) return null;
  try {
    return ActiveSessionSchema.parse(JSON.parse(text));
  } catch {
    return null;
  }
}

export async function writeActive(root: string, session: ActiveSession): Promise<void> {
  const validated = ActiveSessionSchema.parse(session);
  await atomicWrite(activeFile(root), JSON.stringify(validated, null, 2));
}

export async function clearActive(root: string): Promise<void> {
  try {
    await fs.unlink(activeFile(root));
  } catch (err: any) {
    if (err && err.code !== "ENOENT") throw err;
  }
}

export function isStaleSession(session: ActiveSession, hours = STALE_SESSION_HOURS, now: Date = new Date()): boolean {
  if (session.status !== "open") return false;
  const startedMs = Date.parse(session.startedAt);
  if (Number.isNaN(startedMs)) return true;
  return now.getTime() - startedMs > hours * 3600 * 1000;
}
