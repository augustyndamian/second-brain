import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { atomicAppend, atomicWrite, readTextOrNull } from "./atomic.js";

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), "kb-atomic-"));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe("atomicWrite", () => {
  it("writes a file via tmp+rename", async () => {
    const f = join(dir, "a.txt");
    await atomicWrite(f, "hello");
    expect(await fs.readFile(f, "utf8")).toBe("hello");
  });

  it("overwrites existing file", async () => {
    const f = join(dir, "a.txt");
    await atomicWrite(f, "one");
    await atomicWrite(f, "two");
    expect(await fs.readFile(f, "utf8")).toBe("two");
  });

  it("serializes concurrent writers (last value matches one of inputs)", async () => {
    const f = join(dir, "race.txt");
    const writers = Array.from({ length: 20 }, (_, i) => atomicWrite(f, `v${i}`));
    await Promise.all(writers);
    const final = await readTextOrNull(f);
    expect(final).toMatch(/^v\d+$/);
    // No partial writes / no tmp leftovers
    const entries = await fs.readdir(dir);
    expect(entries.filter((e) => e.includes(".tmp"))).toHaveLength(0);
  });
});

describe("atomicAppend", () => {
  it("appends lines and concurrent appends do not interleave", async () => {
    const f = join(dir, "log.jsonl");
    const lines = Array.from({ length: 50 }, (_, i) => `{"i":${i}}`);
    await Promise.all(lines.map((l) => atomicAppend(f, l)));
    const text = (await fs.readFile(f, "utf8")).trim().split("\n");
    expect(text).toHaveLength(50);
    const ids = new Set(text.map((l) => JSON.parse(l).i));
    expect(ids.size).toBe(50);
  });
});

describe("readTextOrNull", () => {
  it("returns null for missing file", async () => {
    expect(await readTextOrNull(join(dir, "nope"))).toBeNull();
  });
});
