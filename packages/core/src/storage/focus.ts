import { promises as fs } from "node:fs";
import { join } from "node:path";
import { atomicWrite, readTextOrNull } from "./atomic.js";
import { paths } from "./paths.js";
import { FocusSessionSchema, type FocusSession } from "../types.js";
import { localToday } from "../schedule/dates.js";
import { readActive } from "./active-session.js";

function focusFile(root: string): string {
  return join(paths(root).root, "focus.json");
}

export async function readFocus(root: string): Promise<FocusSession | null> {
  const text = await readTextOrNull(focusFile(root));
  if (!text || !text.trim()) return null;
  try {
    const parsed = FocusSessionSchema.parse(JSON.parse(text));
    const active = await readActive(root);
    const anchorDate = active?.status === "open" ? active.date : localToday();
    if (parsed.date !== anchorDate) {
      await clearFocus(root);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function writeFocus(root: string, session: FocusSession): Promise<void> {
  const validated = FocusSessionSchema.parse(session);
  await atomicWrite(focusFile(root), JSON.stringify(validated, null, 2));
}

export async function clearFocus(root: string): Promise<void> {
  try {
    await fs.unlink(focusFile(root));
  } catch (err: any) {
    if (err && err.code !== "ENOENT") throw err;
  }
}
