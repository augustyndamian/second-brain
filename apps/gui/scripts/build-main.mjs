import { build } from "esbuild";
import { mkdir } from "node:fs/promises";

await mkdir("dist-electron", { recursive: true });

const common = {
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  // electron + native modules must stay external
  external: ["electron", "fsevents"],
  sourcemap: true,
  logLevel: "info",
};

await build({
  ...common,
  entryPoints: ["electron/main.ts"],
  outfile: "dist-electron/main.cjs",
});

await build({
  ...common,
  entryPoints: ["electron/preload.ts"],
  outfile: "dist-electron/preload.cjs",
});

console.log("[build-main] OK");
