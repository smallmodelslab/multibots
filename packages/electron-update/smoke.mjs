// Real Electron and ASAR boundary test for ESM and CommonJS apps. No
// production key, feed, user data or app install.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { generateKeyPairSync, sign } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createPackage } from "@electron/asar";
import electron from "electron";
import { buildLauncher } from "./bundle.mjs";
import { sha256 } from "./src/protocol.ts";
import { UpdateStore } from "./src/store.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const keys = generateKeyPairSync("ed25519");
const publicKey = keys.publicKey
  .export({ type: "spki", format: "pem" })
  .toString();
const runtime = "a".repeat(64);
// Remove the variable entirely: Windows can treat an empty value as set.
const env = Object.fromEntries(
  Object.entries(process.env).filter(
    ([name]) => name.toUpperCase() !== "ELECTRON_RUN_AS_NODE",
  ),
);
const file = async (path, text) => {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, text);
};

// The feed the launcher checks: whatever `feed` holds.
const feed = new Map();
const server = createServer((request, response) => {
  const body = feed.get(request.url);
  response.writeHead(body ? 200 : 404).end(body);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

// The app: SMOKE_MODE picks what main does once its window is ready.
const main = (format, label) => `
${
  format === "esm"
    ? `import {app,BrowserWindow,ipcMain} from 'electron';
import {createRequire} from 'node:module';
import {dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url);
const here=dirname(fileURLToPath(import.meta.url));`
    : `const {app,BrowserWindow,ipcMain}=require('electron');
const here=__dirname;`
}
const {appendFileSync,writeFileSync}=require('node:fs');
const {join}=require('node:path');
const results=${JSON.stringify("RESULTS")};
const updates=globalThis.wrkrshUpdates;
const write=(name,value)=>writeFileSync(join(results,name+'.json'),JSON.stringify(value));
if (process.argv.includes('status')) {
  write('cli',{label:${JSON.stringify(label)},release:updates.release});
  app.exit(0);
} else void app.whenReady().then(async()=>{
  const window=new BrowserWindow({show:false,webPreferences:{preload:join(here,'../preload/index.cjs'),contextIsolation:true,sandbox:true}});
  updates.start({onChange(){},prepareToRestart:async()=>true,reload:()=>window.loadFile(updates.renderer('index.html'))});
  const pages=[];
  ipcMain.on('ready',async(_event,page)=>{
    pages.push(page);
    appendFileSync(join(results,'pages'),page+'\\n');
    updates.ready();
    const mode=process.env.SMOKE_MODE;
    if (mode==='update' && pages.length===1) {
      const state=await updates.check();
      write('checked',state);
      if (state.status==='downloaded' && !state.restart) return updates.install();
    }
    if (mode==='nightly') {
      const before=updates.channel();
      await updates.setChannel('nightly');
      write('channel',{before,after:updates.channel()});
    }
    write('app',{label:${JSON.stringify(label)},page,pages,pid:process.pid,release:updates.release,commit:updates.commit,version:updates.version,esm:(await import('ota-dependency')).default,cjs:require('ota-dependency')});
    app.exit(0);
  });
  await window.loadFile(updates.renderer('index.html'));
});
`;
const preload = `const {contextBridge,ipcRenderer}=require('electron'); contextBridge.exposeInMainWorld('probe',{ready:(page)=>ipcRenderer.send('ready',page)});`;
const page = (label, ready = true) =>
  `<html><body>${label}<script>${ready ? `window.probe.ready(${JSON.stringify(label)})` : ""}</script></body></html>`;

async function smoke(format) {
  const directory = await mkdtemp(join(here, `.smoke-${format}-`));
  const results = join(directory, "results");
  const data = join(directory, "data");
  const installed = join(directory, "installed");
  const type = format === "esm" ? "module" : "commonjs";
  const app = (label) =>
    main(format, label).replace('"RESULTS"', JSON.stringify(results));
  const result = async (name) => {
    for (let attempt = 0; attempt < 300; attempt += 1) {
      try {
        return JSON.parse(
          await readFile(join(results, `${name}.json`), "utf8"),
        );
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    throw new Error(
      `The smoke app never wrote ${name}.json. Its last run printed:\n${output}`,
    );
  };
  // What the last launch printed, launcher records included.
  let output = "";
  const run = async (mode, ...args) => {
    try {
      const { stdout, stderr } = await promisify(execFile)(
        electron,
        [
          directory,
          ...args,
          ...(process.platform === "linux" ? ["--no-sandbox"] : []),
        ],
        { timeout: 30_000, env: { ...env, SMOKE_MODE: mode } },
      );
      output = stdout + stderr;
    } catch (error) {
      output = `${error.stdout ?? ""}${error.stderr ?? ""}`;
      throw error;
    }
  };
  const open = () =>
    new UpdateStore(
      join(data, "javascript-updates", "stable", runtime),
      runtime,
      publicKey,
    );
  // Builds a signed release whose main and preload are `label`'s and whose
  // window is `window`. Equal labels give equal hosts.
  const release = async (
    sequence,
    label,
    window = page(label),
    code = app(label),
    channel = "latest",
  ) => {
    const payload = join(directory, `payload-${sequence}`);
    await file(join(payload, "package.json"), JSON.stringify({ type }));
    await file(join(payload, "out/main/index.js"), code);
    await file(join(payload, "out/preload/index.cjs"), preload);
    await file(join(payload, "out/renderer/index.html"), window);
    const archive = join(directory, `payload-${sequence}.asar`);
    await createPackage(payload, archive);
    const bytes = await readFile(archive);
    const version = `1.0.${sequence}`;
    const body = JSON.stringify({
      schema: 2,
      version,
      sequence,
      runtime,
      host: sha256(Buffer.from(label)),
      commit: `${sequence}`.padStart(7, "0"),
      sha256: sha256(bytes),
      size: bytes.length,
    });
    const envelope = {
      version,
      payload: body,
      signature: sign(null, Buffer.from(body), keys.privateKey).toString(
        "base64",
      ),
    };
    feed.clear();
    feed.set(
      `/smoke/javascript/${runtime}/updates/${channel}.json`,
      JSON.stringify(envelope),
    );
    feed.set(
      `/smoke/javascript/${runtime}/releases/${version}/smoke-${version}.asar`,
      bytes,
    );
    return { envelope, bytes };
  };
  const activate = ({ envelope, bytes }) => {
    open().stage(envelope, bytes);
    open().activate(envelope);
  };

  try {
    await mkdir(results, { recursive: true });
    await file(
      join(directory, "package.json"),
      JSON.stringify({
        name: `smoke-${format}`,
        version: "1.0.0",
        main: "index.cjs",
      }),
    );
    await file(
      join(directory, "resources/app-update.yml"),
      "provider: generic\n",
    );
    // Stands in for a packaged app with an update feed.
    await file(
      join(directory, "index.cjs"),
      `const {app}=require('electron');
app.setPath('userData', ${JSON.stringify(data)});
Object.defineProperty(app, 'isPackaged', {value:true});
Object.defineProperty(process, 'resourcesPath', {value:${JSON.stringify(join(directory, "resources"))}});
require('./installed.asar/out/bootstrap/index.js');`,
    );
    await file(join(installed, "package.json"), JSON.stringify({ type }));
    await file(join(installed, "out/main/index.js"), app("installed"));
    await file(join(installed, "out/preload/index.cjs"), preload);
    await file(join(installed, "out/renderer/index.html"), page("installed"));
    await file(
      join(installed, "node_modules/ota-dependency/package.json"),
      JSON.stringify({
        name: "ota-dependency",
        exports: { import: "./import.mjs", require: "./require.cjs" },
      }),
    );
    await file(
      join(installed, "node_modules/ota-dependency/import.mjs"),
      "export default 'esm-installed';",
    );
    await file(
      join(installed, "node_modules/ota-dependency/require.cjs"),
      "module.exports = 'cjs-installed';",
    );
    await buildLauncher(join(installed, "out/bootstrap/index.js"), {
      product: "smoke",
      name: "Smoke",
      publicKey,
      origin,
      cli: ["status"],
      format,
      runtime,
      installed: {
        sequence: 0,
        host: sha256(Buffer.from("installed")),
        commit: "0000000",
      },
      readyTimeoutMs: 3_000,
    });
    // electron-updater resolves from this package's node_modules.
    await createPackage(installed, join(directory, "installed.asar"));

    // A signed release starts in place of the installer's code, with the
    // installer's dependencies, and becomes the working one once ready.
    activate(await release(1, "one"));
    await run("boot", "status");
    assert.deepEqual(
      await result("cli"),
      { label: "installed", release: null },
      "the CLI never boots a pending release",
    );
    await run("boot");
    const first = await result("app");
    assert.deepEqual(
      { ...first, pid: 0 },
      {
        label: "one",
        page: "one",
        pages: ["one"],
        pid: 0,
        release: "1.0.1",
        commit: "0000001",
        version: "1.0.1+0000001",
        esm: "esm-installed",
        cjs: "cjs-installed",
      },
    );
    assert.equal(open().state.active?.version, "1.0.1");
    await run("boot", "status");
    assert.equal((await result("cli")).release, "1.0.1");

    // A release that only changes the window installs by reloading it.
    await rm(join(results, "app.json"));
    await release(2, "one", page("two"));
    await run("update");
    assert.deepEqual(await result("checked"), {
      status: "downloaded",
      version: "1.0.2",
      restart: false,
    });
    const reloaded = await result("app");
    assert.deepEqual(
      reloaded.pages,
      ["one", "two"],
      "the same process shows the new window",
    );
    assert.equal(reloaded.label, "one");
    assert.equal(reloaded.release, "1.0.2");
    assert.equal(open().state.active?.version, "1.0.2");
    assert.equal(open().state.attempting, false);

    // A window that never becomes ready goes back to the working one.
    await rm(join(results, "app.json"));
    await release(3, "one", page("three", false));
    await run("update");
    assert.deepEqual((await result("app")).pages, ["two", "two"]);
    assert.equal(open().state.active?.version, "1.0.2");
    assert.deepEqual(open().state.rejected, [3]);

    // Any other change restarts.
    await rm(join(results, "checked.json"));
    await release(4, "four");
    await run("update");
    assert.deepEqual(await result("checked"), {
      status: "downloaded",
      version: "1.0.4",
      restart: true,
    });

    // A release that fails to start rolls back and relaunches the working one.
    await rm(join(results, "app.json"));
    activate(
      await release(
        5,
        "broken",
        page("broken"),
        "throw new Error('Broken release');",
      ),
    );
    await run("boot").catch(() => undefined);
    assert.equal((await result("app")).page, "two");
    assert.equal(open().state.active?.version, "1.0.2");
    assert.deepEqual(open().state.rejected, [3, 5]);
    // A picked channel lasts across launches. Until it has a release, the
    // install keeps its version channel's releases, the running one
    // included, then takes its own channel's.
    await rm(join(results, "app.json"));
    await run("nightly");
    assert.deepEqual(await result("channel"), {
      before: "stable",
      after: "nightly",
    });
    await rm(join(results, "app.json"));
    await release(6, "one", page("six"));
    await run("update");
    const early = await result("app");
    assert.deepEqual(early.pages, ["two", "six"]);
    assert.equal(early.release, "1.0.6");
    assert.equal(open().state.active?.version, "1.0.6");
    await rm(join(results, "app.json"));
    await release(7, "one", page("seven"), undefined, "nightly");
    await run("update");
    const nightly = await result("app");
    assert.deepEqual(nightly.pages, ["six", "seven"]);
    assert.equal(nightly.release, "1.0.7");
    assert.equal(open().state.active?.version, "1.0.6");
    await rm(join(results, "app.json"));
    await run("boot");
    assert.equal((await result("app")).page, "seven");
    // A first nightly release whose launch was killed before it became ready
    // gives way to the working stable one.
    await rm(join(data, "javascript-updates", "nightly"), { recursive: true });
    const nightlyStore = new UpdateStore(
      join(data, "javascript-updates", "nightly", runtime),
      runtime,
      publicKey,
    );
    const killed = await release(8, "one", page("eight"), undefined, "nightly");
    nightlyStore.stage(killed.envelope, killed.bytes);
    nightlyStore.activate(killed.envelope);
    nightlyStore.attempt();
    await rm(join(results, "app.json"));
    await run("boot");
    assert.equal((await result("app")).page, "six");
    // So does a nightly release whose archive is gone.
    const lost = await release(9, "one", page("nine"), undefined, "nightly");
    nightlyStore.stage(lost.envelope, lost.bytes);
    nightlyStore.activate(lost.envelope);
    nightlyStore.healthy();
    await rm(nightlyStore.path(lost.envelope));
    await rm(join(results, "app.json"));
    await run("boot");
    assert.equal((await result("app")).page, "six");
    console.log(
      `PASS (${format}): boot, CLI, reload into window-only updates, reload rollback, restart detection, startup rollback, channel switch.`,
    );
  } finally {
    // A relaunched app may still be shutting down.
    await rm(directory, {
      recursive: true,
      force: true,
      maxRetries: 20,
      retryDelay: 250,
    });
  }
}

try {
  for (const format of ["cjs", "esm"]) await smoke(format);
} finally {
  server.close();
}
