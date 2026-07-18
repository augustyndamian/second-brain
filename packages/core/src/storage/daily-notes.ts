import { promises as fs } from "node:fs";
import lockfile from "proper-lockfile";
import { dailyNoteArchiveFile, dailyNoteFile, paths } from "./paths.js";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function ensureDateFormat(date: string): void {
  if (!ISO_DATE_RE.test(date)) {
    throw new Error(`invalid date format: expected YYYY-MM-DD, got ${date}`);
  }
}

function hhmm(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

async function readFileSafe(path: string): Promise<string | null> {
  try {
    return await fs.readFile(path, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

/**
 * Read daily note content for a given date. Returns "" if the file does not exist.
 */
export async function readDailyNote(root: string, date: string): Promise<string> {
  ensureDateFormat(date);
  const file = dailyNoteFile(root, date);
  const content = await readFileSafe(file);
  return content ?? "";
}

/**
 * Read archived daily note content (after /today-eod has consumed and moved it).
 */
export async function readArchivedDailyNote(root: string, date: string): Promise<string | null> {
  ensureDateFormat(date);
  const file = dailyNoteArchiveFile(root, date);
  return readFileSafe(file);
}

/**
 * Append a free-form bullet to today's scratchpad. Adds `### HH:MM` heading
 * before the entry; entry separated from previous content by a blank line.
 */
export async function appendDailyNote(root: string, date: string, text: string): Promise<void> {
  ensureDateFormat(date);
  if (!text.trim()) return;
  const file = dailyNoteFile(root, date);
  await ensureDir(paths(root).dailyNotes);
  // Touch the file so proper-lockfile has something to lock.
  try {
    await fs.access(file);
  } catch {
    await fs.writeFile(file, "", "utf8");
  }
  const release = await lockfile.lock(file, { retries: { retries: 100, minTimeout: 20, maxTimeout: 200 } });
  try {
    const cur = (await readFileSafe(file)) ?? "";
    const sep = cur.length === 0 ? "" : (cur.endsWith("\n\n") ? "" : cur.endsWith("\n") ? "\n" : "\n\n");
    const block = `### ${hhmm()}\n\n${text.trimEnd()}\n`;
    await fs.writeFile(file, cur + sep + block, "utf8");
  } finally {
    await release();
  }
}

/**
 * Auto-log helper for system-emitted entries (tracker status, reschedule, skip).
 * Tagged with `[auto:source]` so /today-eod can filter manual vs automated.
 *
 * Best-effort: failures are swallowed so they never block the underlying mutation
 * (e.g. tracker status change must succeed even if the daily-notes dir is read-only).
 */
export async function appendAutoLog(
  root: string,
  date: string,
  source: string,
  message: string,
): Promise<void> {
  if (!ISO_DATE_RE.test(date)) return;
  if (!message.trim()) return;
  const file = dailyNoteFile(root, date);
  try {
    await ensureDir(paths(root).dailyNotes);
    try {
      await fs.access(file);
    } catch {
      await fs.writeFile(file, "", "utf8");
    }
    const release = await lockfile.lock(file, { retries: { retries: 100, minTimeout: 20, maxTimeout: 200 } });
    try {
      const cur = (await readFileSafe(file)) ?? "";
      const sep = cur.length === 0 ? "" : (cur.endsWith("\n\n") ? "" : cur.endsWith("\n") ? "\n" : "\n\n");
      const block = `### ${hhmm()} [auto:${source}]\n\n${message.trimEnd()}\n`;
      await fs.writeFile(file, cur + sep + block, "utf8");
    } finally {
      await release();
    }
  } catch (e) {
    // Best-effort; log to stderr but do not throw.
    process.stderr?.write?.(`[daily-notes] appendAutoLog failed (${source}): ${(e as Error).message}\n`);
  }
}

/**
 * Move today's note into archive/ after /today-eod has processed it.
 * Idempotent: no-op if source file does not exist.
 */
export async function archiveDailyNote(root: string, date: string): Promise<{ archived: boolean; path?: string }> {
  ensureDateFormat(date);
  const src = dailyNoteFile(root, date);
  const dst = dailyNoteArchiveFile(root, date);
  try {
    await fs.access(src);
  } catch {
    return { archived: false };
  }
  await ensureDir(paths(root).dailyNotesArchive);
  await fs.rename(src, dst);
  return { archived: true, path: dst };
}

/**
 * List archived dates (sorted ascending). Returns [] if dir missing.
 */
export async function listArchivedNotes(root: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(paths(root).dailyNotesArchive);
    return entries
      .filter((e) => /^\d{4}-\d{2}-\d{2}\.md$/.test(e))
      .map((e) => e.slice(0, -3))
      .sort();
  } catch {
    return [];
  }
}

/**
 * Replace full content of today's scratchpad (used by GUI textarea autosave).
 * Locks the file. Skip-if-equal check is in caller for cheapness.
 */
export async function writeDailyNote(root: string, date: string, content: string): Promise<void> {
  ensureDateFormat(date);
  const file = dailyNoteFile(root, date);
  await ensureDir(paths(root).dailyNotes);
  try {
    await fs.access(file);
  } catch {
    await fs.writeFile(file, "", "utf8");
  }
  const release = await lockfile.lock(file, { retries: { retries: 100, minTimeout: 20, maxTimeout: 200 } });
  try {
    await fs.writeFile(file, content, "utf8");
  } finally {
    await release();
  }
}
