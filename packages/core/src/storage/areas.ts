import YAML from "yaml";
import { z } from "zod";
import { atomicWrite, readTextOrNull } from "./atomic.js";
import { paths } from "./paths.js";

export const AREAS_SCHEMA_VERSION = 1;

/** Area ids are immutable once created — they are baked into board ids and task ids. */
export const AreaIdSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]{0,23}$/, "area id must be lowercase, start with a letter, max 24 chars");

export const AreaConfigSchema = z.object({
  id: AreaIdSchema,
  label: z.string().min(1),
  emoji: z.string().min(1).default("📁"),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "color must be a #rrggbb hex value").default("#64748b"),
  /** Optional task-id prefix override; defaults to the id with dashes stripped. */
  prefix: z.string().regex(/^[a-z0-9]+$/).optional(),
});
export type AreaConfig = z.infer<typeof AreaConfigSchema>;

export const AreasFileSchema = z.object({
  schemaVersion: z.number().int().positive(),
  areas: z.array(AreaConfigSchema).default([]),
});
export type AreasFile = z.infer<typeof AreasFileSchema>;

/** Starter area for a fresh workspace — replaced during `/onboard`. */
export const DEFAULT_AREAS: AreaConfig[] = [
  { id: "personal", label: "Personal", emoji: "🌱", color: "#8b5cf6" },
];

/** Palette suggested to users when creating areas (see the /onboard command). */
export const AREA_COLOR_PALETTE = [
  "#8b5cf6",
  "#3b82f6",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#ec4899",
  "#14b8a6",
  "#6366f1",
] as const;

/** Task-id prefix for an area: explicit `prefix`, else the id with dashes stripped. */
export function areaPrefix(cfg: AreaConfig): string {
  return cfg.prefix ?? cfg.id.replace(/-/g, "");
}

/**
 * Reads the configured areas. A missing file yields DEFAULT_AREAS without writing —
 * bootstrapping is initStorage's job, reads must stay side-effect free.
 */
export async function readAreas(root: string): Promise<AreaConfig[]> {
  const text = await readTextOrNull(paths(root).areas);
  if (text === null || text.trim() === "") return DEFAULT_AREAS;
  const parsed = AreasFileSchema.parse(YAML.parse(text));
  return parsed.areas.length > 0 ? parsed.areas : DEFAULT_AREAS;
}

export async function writeAreas(root: string, areas: AreaConfig[]): Promise<void> {
  const file: AreasFile = AreasFileSchema.parse({ schemaVersion: AREAS_SCHEMA_VERSION, areas });
  await atomicWrite(paths(root).areas, YAML.stringify(file));
}

export async function areasFileExists(root: string): Promise<boolean> {
  return (await readTextOrNull(paths(root).areas)) !== null;
}
