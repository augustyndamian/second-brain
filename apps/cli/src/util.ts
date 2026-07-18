import { promises as fs } from "node:fs";
import { AreaSchema, ColumnSchema, type Area, type Column } from "@second-brain/core";

/**
 * Format-only check — whether the area actually exists is decided by the core
 * services (assertValidArea), which know the configured list.
 */
export function parseArea(v: string): Area {
  return AreaSchema.parse(v.toLowerCase());
}

export function parseColumn(v: string): Column {
  return ColumnSchema.parse(v.toLowerCase());
}

export function fail(msg: string, code = 1): never {
  console.error(`error: ${msg}`);
  process.exit(code);
}

export function asJson(v: unknown): string {
  return JSON.stringify(v, null, 2);
}

export async function readJsonInput(pathOrDash: string): Promise<string> {
  if (pathOrDash === "-") {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks).toString("utf-8");
  }
  return fs.readFile(pathOrDash, "utf-8");
}
