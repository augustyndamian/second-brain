import { promises as fs } from "node:fs";
import { dirname, basename, join } from "node:path";
import lockfile from "proper-lockfile";

export interface AtomicWriteOpts {
  lockTimeoutMs?: number;
  lockRetries?: number;
}

async function ensureDir(p: string) {
  await fs.mkdir(p, { recursive: true });
}

export async function atomicWrite(
  filePath: string,
  contents: string,
  opts: AtomicWriteOpts = {},
): Promise<void> {
  const dir = dirname(filePath);
  await ensureDir(dir);

  // proper-lockfile requires the locked file to exist; create empty if missing.
  try {
    await fs.access(filePath);
  } catch {
    await fs.writeFile(filePath, "", { flag: "wx" }).catch(async () => {
      // ignore race; another process may have created it
    });
  }

  const release = await lockfile.lock(filePath, {
    retries: {
      retries: opts.lockRetries ?? 100,
      minTimeout: 10,
      maxTimeout: 200,
      factor: 1.2,
    },
    stale: opts.lockTimeoutMs ?? 5000,
    realpath: false,
  });

  try {
    const tmp = join(dir, `.${basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
    await fs.writeFile(tmp, contents, "utf8");
    await fs.rename(tmp, filePath);
  } finally {
    await release();
  }
}

export async function atomicAppend(
  filePath: string,
  line: string,
  opts: AtomicWriteOpts = {},
): Promise<void> {
  const dir = dirname(filePath);
  await ensureDir(dir);
  try {
    await fs.access(filePath);
  } catch {
    await fs.writeFile(filePath, "", { flag: "wx" }).catch(() => {});
  }

  const release = await lockfile.lock(filePath, {
    retries: {
      retries: opts.lockRetries ?? 200,
      minTimeout: 5,
      maxTimeout: 100,
      factor: 1.2,
    },
    stale: opts.lockTimeoutMs ?? 5000,
    realpath: false,
  });
  try {
    await fs.appendFile(filePath, line.endsWith("\n") ? line : line + "\n", "utf8");
  } finally {
    await release();
  }
}

export async function readTextOrNull(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (err: any) {
    if (err && err.code === "ENOENT") return null;
    throw err;
  }
}
