import type { Event } from "../types.js";

/**
 * Returns Map<taskId, fromPlanned ISO> of tasks rescheduled INTO `date` from an earlier date.
 * Multi-hop: last matching event wins (events.jsonl is append-only chronological).
 */
export function computeCarryOverMap(events: Event[], date: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const ev of events) {
    if (ev.type !== "task.rescheduled") continue;
    if (ev.toPlanned !== date) continue;
    if (!ev.fromPlanned) continue;
    if (ev.fromPlanned >= ev.toPlanned) continue;
    map.set(ev.taskId, ev.fromPlanned);
  }
  return map;
}
