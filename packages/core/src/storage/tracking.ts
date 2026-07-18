import YAML from "yaml";
import { TrackingFileSchema, SCHEMA_VERSION, type TrackingFile, type TrackingItem } from "../types.js";
import { atomicWrite, readTextOrNull } from "./atomic.js";
import { paths } from "./paths.js";

export async function readTracking(root: string): Promise<TrackingFile> {
  const text = await readTextOrNull(paths(root).tracking);
  if (!text || !text.trim()) {
    return { schemaVersion: SCHEMA_VERSION, items: [] };
  }
  return TrackingFileSchema.parse(YAML.parse(text));
}

export async function writeTracking(root: string, file: TrackingFile): Promise<void> {
  const validated = TrackingFileSchema.parse(file);
  await atomicWrite(paths(root).tracking, YAML.stringify(validated));
}

export async function updateTracking(
  root: string,
  fn: (f: TrackingFile) => TrackingFile,
): Promise<TrackingFile> {
  const cur = await readTracking(root);
  const next = fn(cur);
  await writeTracking(root, next);
  return next;
}

export async function listTrackingItems(root: string): Promise<TrackingItem[]> {
  return (await readTracking(root)).items;
}

export async function findTrackingItem(root: string, id: string): Promise<TrackingItem | null> {
  const items = await listTrackingItems(root);
  return items.find((i) => i.id === id) ?? null;
}
