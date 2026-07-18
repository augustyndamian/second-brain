#!/usr/bin/env node
import { execSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const APPLICATIONS = "/Applications";

// Pick a writable bin dir already on PATH; fall back to /usr/local/bin (needs sudo).
function pickBinDir() {
  const candidates = [
    path.join(homedir(), ".local/bin"),
    path.join(homedir(), "bin"),
    "/usr/local/bin",
  ];
  const pathDirs = (process.env.PATH ?? "").split(":");
  for (const c of candidates) {
    if (pathDirs.includes(c)) return c;
  }
  return "/usr/local/bin";
}

const BIN_DIR = pickBinDir();

function run(cmd, opts = {}) {
  console.log(`\n$ ${cmd}`);
  execSync(cmd, { stdio: "inherit", cwd: repoRoot, ...opts });
}

console.log("=== Second Brain: install:local ===");

console.log("\n[1/5] building CLI binary");
run("pnpm build:cli");

console.log("\n[2/5] building GUI app bundle");
run("pnpm build:gui");

console.log("\n[3/5] installing /Applications/Second Brain.app");
const sourceApp = path.join(repoRoot, "apps/gui/release/Second Brain-darwin-arm64/Second Brain.app");
const targetApp = path.join(APPLICATIONS, "Second Brain.app");
if (!existsSync(sourceApp)) {
  throw new Error(`source .app not found at ${sourceApp} — did the build fail?`);
}
run(`rm -rf "${targetApp}"`);
run(`cp -R "${sourceApp}" "${targetApp}"`);
run(`codesign --deep --force --sign - "${targetApp}"`);

console.log(`\n[4/5] installing ${BIN_DIR}/kb`);
const sourceBin = path.join(repoRoot, "apps/cli/dist/kb");
if (!existsSync(sourceBin)) {
  throw new Error(`CLI binary missing at ${sourceBin}`);
}
if (!existsSync(BIN_DIR)) mkdirSync(BIN_DIR, { recursive: true });
const targetBin = path.join(BIN_DIR, "kb");
try {
  run(`cp "${sourceBin}" "${targetBin}"`);
  run(`chmod +x "${targetBin}"`);
} catch {
  console.log("\n  (need sudo for /usr/local/bin)");
  run(`sudo cp "${sourceBin}" "${targetBin}"`);
  run(`sudo chmod +x "${targetBin}"`);
}

console.log("\n[5/5] recording this repo as the default workspace");
// The GUI launched from the Dock starts outside the repo, so walk-up cannot find
// .kanban/ — the pointer file is what makes it resolve. Never clobber an existing one.
const pointerFile = path.join(homedir(), ".config/kb/workspace");
if (existsSync(pointerFile)) {
  console.log(`  pointer already set (${pointerFile}) — left untouched`);
} else {
  run(`"${targetBin}" workspace init "${repoRoot}"`);
}

console.log("\n=== DONE ===");
console.log(`  GUI:  ${targetApp}  (Dock-launchable)`);
console.log(`  CLI:  ${targetBin}  (run 'kb today')`);
