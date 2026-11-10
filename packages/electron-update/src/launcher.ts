// The installer's entry point (out/bootstrap). It starts the newest working
// signed JavaScript release, or the installer's own, and owns updates for the
// app it starts. It never updates itself: build.mjs fingerprints it into the
// native contract.
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { app, BrowserWindow, dialog, type MessageBoxOptions } from "electron";
import electronUpdater from "electron-updater";
import {
  readFileSync as readArchive,
  unlinkSync as removeArchive,
} from "original-fs";
import {
  createCriticalReporter,
  createLogId,
  createLogRecord,
  CRITICAL,
  ERROR,
  formatLogLine,
  INFO,
  type ClientLogFields,
  type ClientLogLevel,
} from "@wrkrsh/client-log";
import { createController, type JavascriptUpdater } from "./controller";
import { registerInstalledDependencies } from "./dependencies";
import type { UpdateHooks, Updates } from "./index";
import {
  artifactPath,
  feedPath,
  verifyRelease,
  type SignedRelease,
} from "./protocol";
import { UpdateStore } from "./store";

declare const __UPDATE__: {
  product: string;
  name: string;
  publicKey: string;
  origin: string;
  // Top-level CLI commands: they run beside the app without its lock or boot state.
  cli: string[];
  format: "esm" | "cjs";
  runtime: string;
  // The installer's own build: its sequence, host fingerprint and commit.
  installed: { sequence: number; host: string; commit: string };
  readyTimeoutMs: number;
};
const { product, name, origin } = __UPDATE__;

const here =
  __UPDATE__.format === "cjs"
    ? __dirname
    : dirname(fileURLToPath(import.meta.url));
const installedRoot = join(here, "../..");
const installedEntry = join(installedRoot, "out/main/index.js");
const cli = __UPDATE__.cli.includes(
  process.argv.slice(process.defaultApp ? 2 : 1)[0] ?? "",
);

// The bundle the windows load, and the release and commit of the code running.
let root = installedRoot;
let running: { release: string | null; host: string; commit: string } = {
  release: null,
  ...__UPDATE__.installed,
};

// The app's log file. The launcher cannot import app code, which updates
// without it, and starts before it, so it writes the file itself.
const logPath = () => join(app.getPath("logs"), `${product}.jsonl`);
const session = createLogId();
const sendCritical = app.isPackaged
  ? createCriticalReporter(product)
  : undefined;
const record = (
  level: ClientLogLevel,
  msg: string,
  fields?: ClientLogFields,
) => {
  const entry = createLogRecord(
    {
      source: "main:launcher",
      // The launcher is the installer's; `release` names the JavaScript running.
      version: `${app.getVersion()}+${__UPDATE__.installed.commit}`,
      session,
    },
    level,
    "update",
    msg,
    { release: running.release, ...fields },
  );
  const sending = sendCritical?.(entry);
  const line = formatLogLine(entry);
  process.stderr.write(line);
  try {
    mkdirSync(dirname(logPath()), { recursive: true });
    appendFileSync(logPath(), line);
  } catch {
    // Startup continues without its log.
  }
  return sending;
};
const log = {
  info: (msg: string, fields?: ClientLogFields) =>
    void record(INFO, msg, fields),
  error: (msg: string, fields?: ClientLogFields) =>
    void record(ERROR, msg, fields),
};
// Waits for a critical report to leave, at most 2 s, before the process exits.
const leave = (sending: Promise<void> | undefined) =>
  Promise.race([
    sending,
    new Promise<void>((resolve) => setTimeout(resolve, 2_000)),
  ]);
const relaunch = (code: number) => {
  app.relaunch();
  app.exit(code);
};

async function download(
  url: string,
  limit: number,
  missingOk = false,
  received?: (bytes: number) => void,
): Promise<Buffer | null> {
  const response = await fetch(url, {
    redirect: "error",
    signal: AbortSignal.timeout(120_000),
    cache: "no-store",
  });
  if (missingOk && response.status === 404) return null;
  if (!response.ok || !response.body)
    throw new Error(
      `Update download failed: HTTP ${response.status} at ${url}`,
    );
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit)
        throw new Error(`Update response exceeds its expected size at ${url}`);
      chunks.push(value);
      received?.(size);
    }
  } finally {
    await reader.cancel();
  }
  return Buffer.concat(chunks);
}

const supportedPlatforms = new Set<NodeJS.Platform>([
  "darwin",
  "linux",
  "win32",
]);
const disabledReason = !app.isPackaged
  ? "Development builds do not update. Install a released build to receive updates."
  : app.getVersion() === "0.0.0"
    ? "Unreleased builds do not update. Install a released build to receive updates."
    : !supportedPlatforms.has(process.platform)
      ? `${name} does not update on ${process.platform}.`
      : !existsSync(join(process.resourcesPath, "app-update.yml"))
        ? "This build is not connected to an update feed."
        : null;

let store: UpdateStore | undefined;
let staged: SignedRelease | undefined;
let checking: Promise<{ version: string; restart: boolean } | null> | undefined;
let healthTimer: ReturnType<typeof setTimeout> | undefined;
let hooks: UpdateHooks | undefined;
// The menu item last reported, so apps rebuild menus only when it changes.
let shownMenu = "";

const javascript: JavascriptUpdater = {
  check(progress) {
    if (!store) return Promise.resolve(null);
    const current = store;
    checking ??= (async () => {
      const metadata = await download(
        `${origin}/${feedPath(product, current.runtime, app.getVersion())}`,
        8192,
        true,
      );
      if (!metadata) return null;
      const envelope = JSON.parse(metadata.toString("utf8")) as SignedRelease;
      const release = verifyRelease(
        envelope,
        current.publicKey,
        current.runtime,
      );
      if (!current.accepts(envelope)) return null;
      if (staged?.payload !== envelope.payload) {
        // A previously staged release stays installable until this one is staged.
        progress(release.version, 0);
        const bytes = await download(
          `${origin}/${artifactPath(product, release)}`,
          release.size,
          false,
          (size) => progress(release.version, (size / release.size) * 100),
        );
        if (!bytes)
          throw new Error("The JavaScript update download was empty.");
        current.stage(envelope, bytes);
        staged = envelope;
      }
      return {
        version: release.version,
        restart: release.host !== running.host,
      };
    })().finally(() => {
      checking = undefined;
    });
    return checking;
  },
  verify() {
    if (!store || !staged)
      throw new Error("No JavaScript update is ready to install.");
    try {
      store.verifiedPath(staged);
    } catch (error) {
      staged = undefined;
      throw error;
    }
  },
  restart() {
    try {
      store!.activate(staged!);
      relaunch(0);
    } catch (error) {
      // The app has already shut down for the restart the user chose. Restart
      // from the last atomic state rather than leave nothing running.
      log.error("javascript update could not activate", { error });
      relaunch(1);
    }
  },
  async reload() {
    const current = store!;
    const envelope = staged!;
    const release = verifyRelease(envelope, current.publicKey, current.runtime);
    const previous = { root, running };
    current.activate(envelope);
    current.attempt();
    staged = undefined;
    root = current.path(envelope);
    running = {
      release: release.version,
      host: release.host,
      commit: release.commit,
    };
    // Replaces a boot's timer: the windows reload into this release.
    clearTimeout(healthTimer);
    healthTimer = setTimeout(() => {
      void record(CRITICAL, "javascript update did not become ready");
      current.rollback();
      ({ root, running } = previous);
      Promise.resolve(hooks?.reload()).catch((error: unknown) =>
        log.error("windows could not reload after a rollback", { error }),
      );
    }, __UPDATE__.readyTimeoutMs);
    await hooks!.reload();
  },
};

const controller = createController({
  native: () => {
    const { autoUpdater } = electronUpdater;
    // The updater's own messages are fixed sentences about feeds and files.
    autoUpdater.logger = {
      debug: () => undefined,
      info: (text?: unknown) =>
        log.info("updater message", { detail: String(text) }),
      warn: (text?: unknown) =>
        log.info("updater message", { detail: String(text) }),
      error: (text?: unknown) =>
        log.error("updater message", { detail: String(text) }),
    };
    return autoUpdater;
  },
  javascript,
  disabledReason,
  log,
  onChange: (state) => {
    const { label, enabled } = updates.menuItem();
    const menu = `${label}:${enabled}`;
    hooks?.onChange(state, menu !== shownMenu);
    shownMenu = menu;
  },
  relaunch: () => relaunch(0),
});

const window = () =>
  BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
const showMessage = (options: MessageBoxOptions) => {
  const parent = window();
  return parent
    ? dialog.showMessageBox(parent, options)
    : dialog.showMessageBox(options);
};

// The only interruption: a restart the user asked for, confirmed once, through
// the app's own save and shutdown path. A reload needs no confirmation.
const install = async () => {
  if (controller.state().status !== "downloaded") return;
  let version: string | undefined;
  try {
    await controller.install(
      async (update) => {
        version = update.version;
        if (!update.restart) return true;
        const { response } = await showMessage({
          type: "question",
          buttons: ["Restart", "Cancel"],
          defaultId: 0,
          cancelId: 1,
          noLink: true,
          message: `Install ${name} ${update.version} and restart?`,
          detail: hooks?.restartDetail ?? "Running work will be interrupted.",
        });
        return response === 0;
      },
      async (update) =>
        update.restart
          ? hooks!.prepareToRestart()
          : ((await hooks!.prepareToReload?.()) ?? true),
    );
  } catch (error) {
    log.error("update install failed", { release: version, error });
    dialog.showErrorBox(`${name} could not update`, String(error));
  }
};

const checkFromMenu = async () => {
  const state = await controller.check();
  if (state.status === "disabled")
    await showMessage({
      type: "info",
      buttons: ["OK"],
      message: "Updates are not available in this build.",
      detail: state.reason,
    });
  else if (state.status === "current")
    await showMessage({
      type: "info",
      buttons: ["OK"],
      message: "You're up to date",
      detail: `${name} ${app.getVersion()} is the newest version.`,
    });
  else if (state.status === "error" && !state.download)
    await showMessage({
      type: "warning",
      buttons: ["OK"],
      message: `${name} could not check for updates.`,
      detail: state.message,
    });
};

let timers: ReturnType<typeof setTimeout>[] = [];
const updates: Updates = {
  get release() {
    return running.release;
  },
  get commit() {
    return running.commit;
  },
  get version() {
    return `${running.release ?? app.getVersion()}+${running.commit}`;
  },
  cli,
  session,
  state: controller.state,
  start(next) {
    hooks = next;
    if (disabledReason !== null) {
      log.info("updates disabled", { reason: disabledReason });
      return;
    }
    const check = () => void controller.check();
    timers = [
      setTimeout(check, 15_000),
      setInterval(check, 4 * 60 * 60 * 1_000),
    ];
    for (const timer of timers) timer.unref();
  },
  stop() {
    for (const timer of timers) clearTimeout(timer);
    timers = [];
  },
  check: controller.check,
  install,
  menuItem() {
    const state = controller.state();
    switch (state.status) {
      case "checking":
        return { label: "Checking for Updates…", enabled: false };
      case "available":
      case "downloading":
        return { label: "Downloading Update…", enabled: false };
      case "downloaded":
        return {
          label: state.restart ? "Restart to Update…" : "Update",
          enabled: true,
          click: () => void install(),
        };
      case "restarting":
        return { label: "Restarting to Update…", enabled: false };
      default:
        return {
          label: "Check for Updates…",
          enabled: true,
          click: () => void checkFromMenu(),
        };
    }
  },
  ready() {
    if (!store || (!store.state.attempting && !store.state.pending)) return;
    store.healthy();
    // A release whose health could not be recorded is still not ready.
    clearTimeout(healthTimer);
    healthTimer = undefined;
    try {
      store.collect();
    } catch (error) {
      log.error("obsolete javascript bundles could not be removed", { error });
    }
    log.info("javascript release ready", { runtime: __UPDATE__.runtime });
  },
  renderer: (...path) => join(root, "out/renderer", ...path),
};

const load = (entry: string): Promise<unknown> =>
  __UPDATE__.format === "cjs"
    ? Promise.resolve().then(() => createRequire(here)(entry))
    : import(pathToFileURL(entry).href);

// A second instance must not record a boot attempt, so the installed app
// takes its single-instance lock here. The CLI runs beside the app.
if (app.isPackaged && !cli && !app.requestSingleInstanceLock()) {
  app.exit(0);
} else {
  let entry = installedEntry;
  if (disabledReason === null) {
    try {
      store = new UpdateStore(
        join(app.getPath("userData"), "javascript-updates", __UPDATE__.runtime),
        __UPDATE__.runtime,
        __UPDATE__.publicKey,
        __UPDATE__.installed.sequence,
        readArchive,
        removeArchive,
      );
      let path: string | null;
      if (cli) {
        path = store.current();
      } else {
        const boot = store.boot();
        if (boot.recovered)
          // The previous working version starts; the failed one is not retried.
          void record(ERROR, "recovered from a failed javascript update");
        path = boot.path;
        if (path) {
          const { confirmed } = boot;
          healthTimer = setTimeout(() => {
            const sending = record(
              CRITICAL,
              "javascript update did not become ready",
              { confirmed },
            );
            // The next boot counts a confirmed release's unfinished launch.
            if (!confirmed) store?.rollback();
            app.relaunch();
            void leave(sending).then(() => app.exit(1));
          }, __UPDATE__.readyTimeoutMs);
        }
      }
      const release = cli
        ? store.state.active
        : (store.state.pending ?? store.state.active);
      if (path && release) {
        const { version, host, commit } = verifyRelease(
          release,
          store.publicKey,
          store.runtime,
        );
        running = { release: version, host, commit };
        root = path;
        registerInstalledDependencies(installedEntry, path);
        entry = join(path, "out/main/index.js");
      }
    } catch (error) {
      // The installed version starts instead.
      void record(ERROR, "javascript update could not load", { error });
    }
  }
  (globalThis as typeof globalThis & { wrkrshUpdates: Updates }).wrkrshUpdates =
    updates;
  load(entry).catch(async (error: unknown) => {
    const sending = record(CRITICAL, "javascript startup failed", { error });
    if (entry !== installedEntry && cli) {
      // The CLI leaves boot state to the app and runs the installed version.
      return load(installedEntry);
    }
    if (entry !== installedEntry) {
      // The last working version starts instead.
      store?.rollback();
      app.relaunch();
    } else {
      await app.whenReady();
      dialog.showErrorBox(
        `${name} could not start`,
        `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n\nLog: ${logPath()}`,
      );
    }
    await leave(sending);
    app.exit(1);
  });
}
