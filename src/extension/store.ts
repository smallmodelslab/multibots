import { execFileSync } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

// The extension as the Chrome Web Store takes it, from the build in
// out/extension: a zip without the manifest's key, which the store holds
// itself, and with OPENBOTS_VERSION, which every upload must raise, as its
// version. `bun run build` first.

const path = (name: string) => fileURLToPath(new URL(name, import.meta.url));
const version = process.env.OPENBOTS_VERSION;
if (!version || !/^\d+(\.\d+){0,3}$/.test(version))
  throw new Error("Set OPENBOTS_VERSION to the version to upload, as 0.2.2.");
const staged = path("../../dist/extension");
await rm(staged, { force: true, recursive: true });
await mkdir(path("../../dist"), { recursive: true });
await cp(path("../../out/extension"), staged, { recursive: true });
const { key: _key, ...manifest } = JSON.parse(
  await readFile(`${staged}/manifest.json`, "utf8"),
);
await writeFile(
  `${staged}/manifest.json`,
  JSON.stringify({ ...manifest, version }, null, 2),
);
const zip = path(`../../dist/openbots-chrome-${version}.zip`);
await rm(zip, { force: true });
execFileSync("zip", ["-qr", zip, "."], { cwd: staged });
console.log(zip);
