import type { AppUpdater } from "electron-updater";
import type { UpdateState } from "./state";

// A staged JavaScript release: `restart` is false when installing it only
// reloads the windows.
export type JavascriptUpdate = { version: string; restart: boolean };

export type JavascriptUpdater = {
  // Stages the newest eligible signed release, or resolves null when this
  // runtime is current. Nothing activates until install.
  check(
    progress: (version: string, percent: number) => void,
  ): Promise<JavascriptUpdate | null>;
  // Throws, before anything stops, when the staged release fails its check.
  verify(): void;
  // Activates the staged release and relaunches; the app has already shut down.
  restart(): void;
  // Activates the staged release in the running app and reloads its windows.
  reload(): Promise<void>;
};

export type ControllerOptions = {
  // Created only when updates are enabled.
  native: () => AppUpdater;
  javascript?: JavascriptUpdater;
  // Why updates are off for this runtime, or null when they are on.
  disabledReason: string | null;
  log: {
    info(msg: string, fields?: Record<string, unknown>): void;
    error(msg: string, fields?: Record<string, unknown>): void;
  };
  onChange: (state: UpdateState) => void;
  // Comes back on the current version when an installer fails after the app
  // has already stopped.
  relaunch: () => void;
};

export type Controller = {
  state(): UpdateState;
  check(): Promise<UpdateState>;
  // Installs the downloaded update. `confirm`, then `prepare`, run before
  // anything activates, and either resolves false to cancel. A confirmed
  // restart is `restarting` from before `prepare` until the app stops.
  install(
    confirm: (update: JavascriptUpdate) => Promise<boolean>,
    prepare: (update: JavascriptUpdate) => Promise<boolean>,
  ): Promise<void>;
};

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export function createController(options: ControllerOptions): Controller {
  const { javascript, disabledReason, log } = options;
  let state: UpdateState =
    disabledReason === null
      ? { status: "idle" }
      : { status: "disabled", reason: disabledReason };
  // The downloaded update install applies. An installer takes priority: its
  // download replaces a staged JavaScript update and ends further checks.
  let ready:
    | { source: "native"; version: string }
    | ({ source: "javascript" } & JavascriptUpdate)
    | null = null;
  let nativeDownload: string | null = null;
  let nativeDownloadError: unknown = null;
  let checking: Promise<void> | null = null;
  let installing = false;

  const publish = (next: UpdateState) => {
    state = next;
    options.onChange(state);
  };
  const downloaded = (): UpdateState | null =>
    ready && {
      status: "downloaded",
      version: ready.version,
      restart: ready.source === "native" || ready.restart,
    };
  // A downloaded update stays installable while a later check runs or fails.
  const settle = (next: UpdateState) => publish(downloaded() ?? next);
  const downloading = (version: string, percent: number) => {
    const rounded = Math.min(100, Math.max(0, Math.floor(percent)));
    if (
      state.status !== "downloading" ||
      state.version !== version ||
      state.percent !== rounded
    )
      publish({ status: "downloading", version, percent: rounded });
  };

  // A broken installer updater must not stop the app or its JavaScript updates.
  let native: AppUpdater | null = null;
  try {
    if (disabledReason === null) native = options.native();
  } catch (error) {
    log.error("installer updates are unavailable", { error });
  }
  if (native) {
    // Checks download explicitly, so a failed download is told apart from a
    // failed check.
    native.autoDownload = false;
    native.autoInstallOnAppQuit = false;
    native.autoRunAppAfterInstall = true;
    native.allowDowngrade = false;
    native.on("download-progress", ({ percent }) => {
      if (nativeDownload !== null) downloading(nativeDownload, percent);
    });
    native.on("update-downloaded", ({ version }) => {
      log.info("update downloaded", { release: version, kind: "native" });
      nativeDownload = null;
      ready = { source: "native", version };
      settle({ status: "idle" });
    });
    // A failing call also rejects; Squirrel.Mac reports a failure after the
    // download only here.
    native.on("error", (error) => {
      if (nativeDownload === null) return;
      log.error("update download failed", { release: nativeDownload, error });
      nativeDownload = null;
      nativeDownloadError = error;
      settle({ status: "error", message: messageOf(error), download: true });
      if (checking === null)
        checking = checkJavascript(error, true).finally(() => {
          checking = null;
        });
    });
  }

  const checkJavascript = async (
    nativeError: unknown,
    nativeFailedDownload: boolean,
  ) => {
    let downloadStarted = false;
    try {
      const update = await javascript?.check((version, percent) => {
        downloadStarted = true;
        if (ready?.source !== "native") downloading(version, percent);
      });
      if (ready?.source === "native") return;
      if (update) {
        log.info("update downloaded", {
          release: update.version,
          kind: "javascript",
          restart: update.restart,
        });
        ready = { source: "javascript", ...update };
        settle({ status: "idle" });
      } else if (nativeError !== null) {
        settle({
          status: "error",
          message: messageOf(nativeError),
          download: nativeFailedDownload,
        });
      } else {
        settle({ status: "current" });
      }
    } catch (error) {
      log.error("update check failed", { kind: "javascript", error });
      settle({
        status: "error",
        message: messageOf(error),
        download: downloadStarted,
      });
    }
  };

  const runCheck = async () => {
    if (!ready) publish({ status: "checking" });
    nativeDownloadError = null;
    let nativeError: unknown = null;
    try {
      const result = await native?.checkForUpdates();
      if (result?.isUpdateAvailable) {
        const { version } = result.updateInfo;
        log.info("update available", { release: version, kind: "native" });
        nativeDownload = version;
        nativeDownloadError = null;
        publish({ status: "available", version });
        // Ready once `update-downloaded` fires; Squirrel.Mac finishes after
        // this. Failures arrive through the error event.
        await native!.downloadUpdate();
        if (nativeDownload !== null || ready?.source === "native") return;
        nativeError = nativeDownloadError;
      }
    } catch (error) {
      // The JavaScript feed is independent, so a failed check still tries it.
      nativeError = error;
      if (nativeDownload !== null) {
        nativeDownload = null;
        nativeDownloadError = error;
      }
      log.error("update check failed", { kind: "native", error });
    }

    await checkJavascript(nativeError, nativeDownloadError !== null);
  };

  const check = async () => {
    if (installing || state.status === "disabled" || ready?.source === "native")
      return state;
    checking ??= runCheck().finally(() => {
      checking = null;
    });
    await checking;
    return state;
  };

  const install = async (
    confirm: (update: JavascriptUpdate) => Promise<boolean>,
    prepare: (update: JavascriptUpdate) => Promise<boolean>,
  ) => {
    if (installing) return;
    installing = true;
    let recheck = false;
    try {
      // A check in flight may stage a newer release; install what it leaves.
      await checking;
      const update = ready;
      if (!update) return;
      if (update.source === "javascript") {
        try {
          // Verify before stopping anything; a damaged download is fetched
          // again.
          javascript!.verify();
        } catch (error) {
          ready = null;
          recheck = true;
          throw error;
        }
      }
      const { version } = update;
      const restart = update.source === "native" || update.restart;
      if (!(await confirm({ version, restart }))) return;
      if (restart) publish({ status: "restarting", version });
      let prepared = false;
      try {
        prepared = await prepare({ version, restart });
      } finally {
        // Cancelled or failed, the update stays ready to install.
        if (!prepared) settle({ status: "idle" });
      }
      if (!prepared) return;
      if (update.source === "native") {
        log.info("restarting to install update", {
          release: update.version,
          kind: "native",
        });
        // Squirrel.Mac reports a failed install only as a later error event,
        // after the app has stopped.
        const fail = (error: unknown) => {
          log.error("update install failed", {
            release: update.version,
            error,
          });
          options.relaunch();
        };
        native!.once("error", fail);
        try {
          native!.quitAndInstall(false, true);
        } catch (error) {
          fail(error);
        }
        return;
      }
      if (!restart) {
        log.info("reloading to install update", { release: update.version });
        ready = null;
        try {
          await javascript!.reload();
        } catch (error) {
          recheck = true;
          throw error;
        }
        settle({ status: "current" });
        return;
      }
      log.info("restarting to install update", {
        release: update.version,
        kind: "javascript",
      });
      javascript!.restart();
    } finally {
      installing = false;
      if (recheck) void check();
    }
  };

  return { state: () => state, check, install };
}
