import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { describe, it } from "node:test";
import type { AppUpdater, ProgressInfo } from "electron-updater";
import {
  createController,
  type JavascriptUpdate,
  type JavascriptUpdater,
} from "./controller";
import type { UpdateState } from "./state";

class FakeUpdater extends EventEmitter {
  autoDownload = true;
  autoInstallOnAppQuit = true;
  autoRunAppAfterInstall = false;
  allowDowngrade = true;
  quitCalls = 0;
  available: string | null = null;
  check: () => Promise<unknown> = async () => ({
    isUpdateAvailable: this.available !== null,
    updateInfo: { version: this.available ?? "1.0.0" },
  });
  download: () => Promise<unknown> = async () => {
    this.emit("download-progress", { percent: 42.345 } as ProgressInfo);
    this.emit("update-downloaded", { version: this.available });
    return [];
  };
  checkForUpdates() {
    return this.check();
  }
  downloadUpdate() {
    return this.download().catch((error: unknown) => {
      this.emit("error", error);
      throw error;
    });
  }
  quitAndInstall() {
    this.quitCalls += 1;
  }
}

class FakeJavascript implements JavascriptUpdater {
  next: JavascriptUpdate | null = null;
  fail: Error | null = null;
  restarts = 0;
  reloads = 0;
  checks = 0;
  async check(progress: (version: string, percent: number) => void) {
    this.checks += 1;
    if (this.next) progress(this.next.version, 50);
    if (this.fail) throw this.fail;
    return this.next;
  }
  verify = (): void => undefined;
  restart() {
    this.restarts += 1;
  }
  async reload() {
    this.reloads += 1;
  }
}

const setup = (disabledReason: string | null = null) => {
  const updater = new FakeUpdater();
  const javascript = new FakeJavascript();
  const states: UpdateState[] = [];
  const controller = createController({
    native: () => updater as unknown as AppUpdater,
    javascript,
    disabledReason,
    log: { info: () => undefined, error: () => undefined },
    onChange: (state) => states.push(state),
    relaunch: () => undefined,
  });
  return { updater, javascript, states, controller };
};
const yes = async () => true;

describe("update controller", () => {
  it("prefers a downloaded installer and ends further checks", async () => {
    const { updater, javascript, states, controller } = setup();
    updater.available = "1.1.0";
    javascript.next = { version: "1.0.7", restart: false };
    assert.deepEqual(await controller.check(), {
      status: "downloaded",
      version: "1.1.0",
      restart: true,
    });
    assert.deepEqual(states.slice(0, 3), [
      { status: "checking" },
      { status: "available", version: "1.1.0" },
      { status: "downloading", version: "1.1.0", percent: 42 },
    ]);
    await controller.check();
    assert.equal(javascript.checks, 0);
    await controller.install(async () => false, yes);
    assert.equal(updater.quitCalls, 0, "a cancelled restart installs nothing");
    await controller.install(yes, async () => {
      assert.deepEqual(controller.state(), {
        status: "restarting",
        version: "1.1.0",
      });
      return false;
    });
    assert.equal(updater.quitCalls, 0, "a cancelled shutdown installs nothing");
    assert.equal(controller.state().status, "downloaded");
    await controller.install(yes, yes);
    assert.equal(updater.quitCalls, 1);
  });

  it("tells a failed download apart from a failed check", async () => {
    const { updater, controller } = setup();
    const online = updater.check;
    updater.check = async () => {
      throw new Error("update feed unavailable");
    };
    const checked = await controller.check();
    assert.equal(checked.status === "error" && checked.download, false);
    updater.check = online;
    updater.available = "1.1.0";
    updater.download = async () => {
      throw new Error("connection reset");
    };
    const downloaded = await controller.check();
    assert.equal(downloaded.status === "error" && downloaded.download, true);
    updater.check = async () => {
      throw new Error("feed unavailable");
    };
    const rechecked = await controller.check();
    assert.equal(rechecked.status === "error" && rechecked.download, false);
  });

  it("installs JavaScript updates after an installer download fails, including late macOS errors", async () => {
    for (const late of [false, true]) {
      const { updater, javascript, controller } = setup();
      updater.available = "1.1.0";
      javascript.next = { version: "1.0.7", restart: false };
      updater.download = async () => {
        if (!late) throw new Error("installer unavailable");
        return [];
      };
      await controller.check();
      if (late) {
        updater.emit("error", new Error("installer unavailable"));
        await controller.check();
      }
      assert.equal(javascript.checks, 1);
      assert.deepEqual(controller.state(), {
        status: "downloaded",
        version: "1.0.7",
        restart: false,
      });
      await controller.install(yes, yes);
      assert.equal(javascript.reloads, 1);
      assert.equal(updater.quitCalls, 0);
    }
  });

  it("reloads into window-only JavaScript and restarts into the rest", async () => {
    const { updater, javascript, controller } = setup();
    javascript.next = { version: "1.0.7", restart: false };
    assert.deepEqual(await controller.check(), {
      status: "downloaded",
      version: "1.0.7",
      restart: false,
    });
    await controller.install(yes, async () => false);
    assert.equal(javascript.reloads, 0, "a cancelled reload activates nothing");
    const prepared: boolean[] = [];
    await controller.install(
      yes,
      async ({ restart }) => prepared.push(restart) > 0,
    );
    assert.equal(javascript.reloads, 1);
    assert.deepEqual(prepared, [false], "a reload stops nothing");
    assert.equal(controller.state().status, "current");

    javascript.next = { version: "1.0.8", restart: true };
    await controller.check();
    // A later failed check keeps the staged update installable.
    updater.check = async () => {
      throw new Error("offline");
    };
    javascript.fail = new Error("offline");
    assert.deepEqual(await controller.check(), {
      status: "downloaded",
      version: "1.0.8",
      restart: true,
    });
    javascript.fail = null;
    // A damaged staged bundle is not installed and is downloaded again.
    javascript.verify = () => {
      throw new Error("integrity");
    };
    await assert.rejects(controller.install(yes, yes), /integrity/);
    assert.equal(javascript.restarts, 0);
    javascript.verify = () => undefined;
    await controller.check();
    await controller.install(yes, yes);
    assert.equal(javascript.restarts, 1);
  });

  it("stays disabled outside a packaged installation", async () => {
    const { updater, javascript, controller } = setup("Development build.");
    assert.deepEqual(await controller.check(), {
      status: "disabled",
      reason: "Development build.",
    });
    assert.equal(javascript.checks, 0);
    assert.equal(updater.autoDownload, true);
  });
});
