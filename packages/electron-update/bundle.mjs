import { fileURLToPath } from "node:url";
import { build } from "esbuild";

// Builds the launcher into `outfile` with its settings baked in.
export const buildLauncher = (outfile, settings) =>
  build({
    entryPoints: [fileURLToPath(new URL("src/launcher.ts", import.meta.url))],
    outfile,
    bundle: true,
    platform: "node",
    format: settings.format,
    target: "node22",
    external: ["electron", "electron-updater", "original-fs"],
    logLevel: "warning",
    logOverride: { "empty-import-meta": "silent" },
    define: { __UPDATE__: JSON.stringify(settings) },
  });
