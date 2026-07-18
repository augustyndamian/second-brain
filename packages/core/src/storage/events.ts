import { promises as fs } from "node:fs";
import { EventSchema, type Event } from "../types.js";
import { atomicAppend, readTextOrNull } from "./atomic.js";
import { paths } from "./paths.js";

export async function appendEvent(root: string, event: Event): Promise<void> {
  const validated = EventSchema.parse(event);
  await atomicAppend(paths(root).events, JSON.stringify(validated));
}

export async function readEvents(root: string): Promise<Event[]> {
  const text = await readTextOrNull(paths(root).events);
  if (!text) return [];
  const out: Event[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(EventSchema.parse(JSON.parse(line)));
    } catch {
      // skip corrupt line; do not crash callers
    }
  }
  return out;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export async function eventsFileSize(root: string): Promise<number> {
  try {
    const s = await fs.stat(paths(root).events);
    return s.size;
  } catch {
    return 0;
  }
}
