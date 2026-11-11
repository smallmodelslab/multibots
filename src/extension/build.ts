import { Resvg } from "@resvg/resvg-js";
import { copyFile, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "vite";

import { browserProtocol } from "../shared/browser";

// The Chrome extension, built into out/extension, which installers and
// JavaScript updates carry: OpenBots copies it to the folder Chrome loads.

const path = (name: string) => fileURLToPath(new URL(name, import.meta.url));
const outDir = path("../../out/extension");

await build({
  build: {
    emptyOutDir: true,
    minify: false,
    outDir,
    rolldownOptions: {
      input: { background: path("background.ts"), popup: path("popup.ts") },
      output: { entryFileNames: "[name].js" },
    },
  },
  configFile: false,
  logLevel: "warn",
  publicDir: false,
});
const manifest = JSON.parse(await readFile(path("manifest.json"), "utf8"));
await writeFile(
  `${outDir}/manifest.json`,
  JSON.stringify({ ...manifest, version: String(browserProtocol) }, null, 2),
);
await copyFile(path("popup.html"), `${outDir}/popup.html`);
const icon = await readFile(path("../renderer/public/icon.svg"), "utf8");
await writeFile(
  `${outDir}/icon.png`,
  new Resvg(icon, { fitTo: { mode: "width", value: 128 } }).render().asPng(),
);
