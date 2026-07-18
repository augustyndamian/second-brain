import { ensureSession } from "../services/session.js";
import { openSession } from "../services/session.js";

export interface TriggerTodayResult {
  date: string;
  missedMarked: string[];
  snapshotSaved: boolean;
  autoClosed: { date: string; hoursOpen: number; missedCount: number } | null;
}

/**
 * Backwards-compatible wrapper around ensureSession.
 * Without dateOverride: opens (or recovers) the active session and returns its date.
 * With dateOverride: opens an explicit session anchored to that date (debug/backfill).
 *
 * Missed-marking now happens at session close, not here.
 */
export async function triggerToday(root: string, dateOverride?: string): Promise<TriggerTodayResult> {
  if (dateOverride) {
    const session = await openSession(root, dateOverride);
    return { date: session.date, missedMarked: [], snapshotSaved: true, autoClosed: null };
  }
  const opened = await ensureSession(root);
  return {
    date: opened.session.date,
    missedMarked: [],
    snapshotSaved: true,
    autoClosed: opened.autoClosed,
  };
}
