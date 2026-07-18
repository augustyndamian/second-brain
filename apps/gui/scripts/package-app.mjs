import { packager } from "@electron/packager";
import { execSync } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const APP_NAME = "Second Brain";
const root = path.resolve(import.meta.dirname, "..");
const stage = path.join(root, "release-stage");
const out = path.join(root, "release");
const iconPath = path.join(root, "build", "icon.icns");

console.log("[package] cleaning dirs");
await rm(stage, { recursive: true, force: true });
await rm(out, { recursive: true, force: true });
await mkdir(stage, { recursive: true });

console.log("[package] copying bundled artifacts");
execSync(`cp -R "${path.join(root, "dist")}" "${stage}/dist"`, { stdio: "inherit" });
execSync(`cp -R "${path.join(root, "dist-electron")}" "${stage}/dist-electron"`, { stdio: "inherit" });

const minimalPkg = {
  name: "second-brain",
  productName: APP_NAME,
  version: "0.0.1",
  main: "dist-electron/main.cjs",
  // No deps: main.cjs is fully bundled (electron is provided by runtime;
  // fsevents is optional — chokidar falls back to fs.watch on macOS).
};
await writeFile(path.join(stage, "package.json"), JSON.stringify(minimalPkg, null, 2));

console.log("[package] running electron-packager");
const appPaths = await packager({
  dir: stage,
  out,
  name: APP_NAME,
  platform: "darwin",
  arch: "arm64",
  appBundleId: "com.second-brain.app",
  appCategoryType: "public.app-category.productivity",
  icon: iconPath,
  overwrite: true,
  prune: false,
  // Ad-hoc codesign on macOS so Gatekeeper accepts the unsigned bundle without warnings.
  osxSign: false,
});

const bundleDir = appPaths[0];
// Must match install-local.mjs, which copies this exact path into /Applications.
const appPath = path.join(bundleDir, `${APP_NAME}.app`);
console.log(`[package] built at ${appPath}`);

if (!existsSync(appPath)) {
  throw new Error(`packaging failed: ${appPath} missing`);
}

console.log("[package] ad-hoc codesign");
execSync(`codesign --deep --force --sign - "${appPath}"`, { stdio: "inherit" });

console.log(`[package] DONE → ${appPath}`);
