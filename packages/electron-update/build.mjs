#!/usr/bin/env node
// Run from an app directory holding updates.json, after its JavaScript build:
//   electron-update launcher  builds out/bootstrap for this native contract
//   electron-update release [channel]
//                             signs out/ as a JavaScript release once the
//                             channel's installer has this contract
import { execFileSync } from "node:child_process";
import { createHash, createPublicKey, sign } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createPackage } from "@electron/asar";
import { buildLauncher } from "./bundle.mjs";

const app = process.cwd();
const config = JSON.parse(await readFile(join(app, "updates.json"), "utf8"));
const { type } = JSON.parse(await readFile(join(app, "package.json"), "utf8"));
const format = type === "module" ? "esm" : "cjs";
const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  cwd: app,
  encoding: "utf8",
}).trim();
const origin = "https://downloads.wrkrsh.com";
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

// The native contract: what a JavaScript release may assume about the
// installer. Dependencies, native code, packaging and this launcher need a
// new installer; app code does not. Only tracked files count, so local build
// outputs never change it.
const contract = [
  ...config.contract,
  relative(root, join(app, "updates.json")),
  // What the installer runs of this package; its tooling is not contract.
  "packages/electron-update/src",
].map((path) => path.split(sep).join("/"));
const runtimeHash = createHash("sha256");
const tracked = execFileSync("git", ["ls-files", "-z", "--", ...contract], {
  cwd: root,
  encoding: "utf8",
})
  .split("\0")
  .filter(
    (path) =>
      path &&
      !/(?:^|\/)(?:README\.md|[^/]+\.test\.ts)$/.test(path) &&
      // A file deleted in the working tree is no longer part of it.
      existsSync(join(root, path)),
  )
  .sort();
for (const path of tracked) {
  const bytes = await readFile(join(root, path));
  runtimeHash.update(path);
  runtimeHash.update("\0");
  // Windows checkouts may use CRLF for text; binary files are hashed as is.
  runtimeHash.update(
    bytes.includes(0)
      ? bytes
      : Buffer.from(bytes.toString("utf8").replaceAll("\r\n", "\n")),
  );
  runtimeHash.update("\0");
}
const runtime = runtimeHash.digest("hex");

// Everything a release carries but the window code. Equal hosts mean a
// release installs by reloading the windows.
async function host(out) {
  const files = [];
  const walk = async (directory) => {
    // Development starts the launcher before the first build.
    const entries = await readdir(directory, { withFileTypes: true }).catch(
      (error) => {
        if (error.code === "ENOENT") return [];
        throw error;
      },
    );
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else files.push(relative(out, path).split(sep).join("/"));
    }
  };
  await walk(out);
  const hash = createHash("sha256");
  for (const path of files
    .filter((path) => !/^(?:bootstrap|renderer)\//.test(path))
    .sort()) {
    hash.update(path);
    hash.update("\0");
    hash.update(await readFile(join(out, path)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

const commit = (
  process.env.GITHUB_SHA ??
  execFileSync("git", ["rev-parse", "HEAD"], { cwd: app, encoding: "utf8" })
).slice(0, 7);
// GitHub run IDs increase, so the installer's run orders it among releases.
const sequence = Number(process.env.GITHUB_RUN_ID ?? 0);
const out = join(app, "out");

const mode = process.argv[2];
if (mode === "launcher") {
  await buildLauncher(join(out, "bootstrap/index.js"), {
    product: config.product,
    name: config.name,
    storageName: config.storageName,
    userDataEnv: config.userDataEnv,
    publicKey: config.publicKey,
    origin,
    cli: config.cli ?? [],
    format,
    runtime,
    installed: { sequence, host: await host(out), commit },
    readyTimeoutMs: 60_000,
  });
  // The native release publishes this as javascript-runtime.json.
  await writeFile(
    join(out, "bootstrap/runtime.json"),
    JSON.stringify({ runtime }) + "\n",
  );
} else if (mode === "release") {
  const key = process.env.JS_UPDATE_SIGNING_KEY;
  if (!Number.isSafeInteger(sequence) || sequence < 1 || !key)
    throw new Error("GITHUB_RUN_ID and JS_UPDATE_SIGNING_KEY are required.");
  if (
    createPublicKey(key).export({ type: "spki", format: "pem" }) !==
    config.publicKey
  )
    throw new Error("The signing key does not match updates.json.");

  const get = async (path) => {
    const response = await fetch(`${origin}/${path}`, {
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok)
      throw new Error(`HTTP ${response.status} at ${origin}/${path}`);
    return Buffer.from(await response.arrayBuffer());
  };
  const channel = process.argv[3] ?? "stable";
  const catalog = JSON.parse(
    await get(`${config.product}/channels/${channel}.json`),
  );
  const asset = catalog.assets?.find(
    (item) => item.name === "javascript-runtime.json",
  );
  const published =
    asset &&
    (await get(
      `${config.product}/releases/${catalog.version}/javascript-runtime.json`,
    ));
  if (
    !published ||
    sha256(published) !== asset.sha256 ||
    JSON.parse(published).runtime !== runtime
  )
    throw new Error(
      `No published ${channel} ${config.name} installer has this native contract (${runtime}). Release the installer first.`,
    );

  const version = `1.0.${sequence}`;
  const directory = join(app, "dist-javascript");
  const stage = join(app, ".ota-stage");
  await rm(stage, { recursive: true, force: true });
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });
  try {
    await cp(out, join(stage, "out"), {
      recursive: true,
      filter: (path) => relative(out, path).split(sep)[0] !== "bootstrap",
    });
    await writeFile(
      join(stage, "package.json"),
      JSON.stringify({ type: format === "esm" ? "module" : "commonjs" }),
    );
    const artifact = join(directory, `${config.product}-${version}.asar`);
    await createPackage(stage, artifact);
    const bytes = await readFile(artifact);
    const payload = JSON.stringify({
      schema: 2,
      version,
      sequence,
      runtime,
      host: await host(out),
      commit,
      sha256: sha256(bytes),
      size: bytes.length,
    });
    const signature = sign(null, Buffer.from(payload), key).toString("base64");
    await writeFile(
      join(directory, `${channel === "stable" ? "latest" : channel}.json`),
      JSON.stringify({ version, payload, signature }) + "\n",
    );
    console.log(
      `Prepared ${config.name} JavaScript ${version} for installer ${catalog.version} (${bytes.length} bytes).`,
    );
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
} else throw new Error("Usage: electron-update launcher|release [channel]");
