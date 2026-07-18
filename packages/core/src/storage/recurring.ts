import YAML from "yaml";
import { RecurringFileSchema, SCHEMA_VERSION, type RecurringFile, type RecurringRule } from "../types.js";
import { atomicWrite, readTextOrNull } from "./atomic.js";
import { paths } from "./paths.js";

export async function readRecurring(root: string): Promise<RecurringFile> {
  const text = await readTextOrNull(paths(root).recurring);
  if (!text || !text.trim()) {
    return { schemaVersion: SCHEMA_VERSION, rules: [] };
  }
  return RecurringFileSchema.parse(YAML.parse(text));
}

export async function writeRecurring(root: string, file: RecurringFile): Promise<void> {
  const validated = RecurringFileSchema.parse(file);
  await atomicWrite(paths(root).recurring, YAML.stringify(validated));
}

export async function updateRecurring(
  root: string,
  fn: (f: RecurringFile) => RecurringFile,
): Promise<RecurringFile> {
  const cur = await readRecurring(root);
  const next = fn(cur);
  await writeRecurring(root, next);
  return next;
}

export async function listRules(root: string): Promise<RecurringRule[]> {
  return (await readRecurring(root)).rules;
}

export async function findRule(root: string, ruleId: string): Promise<RecurringRule | null> {
  const rules = await listRules(root);
  return rules.find((r) => r.id === ruleId) ?? null;
}
