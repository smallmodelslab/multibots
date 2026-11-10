import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { app, type MenuItemConstructorOptions } from "electron";
import { channelOf } from "./protocol";
import type { Channel, UpdateState } from "./state";

export type { Channel, UpdateState } from "./state";

export type UpdateHooks = {
  // Every state change: push it to the windows, and rebuild the menu when
  // `menuChanged` says `menuItem()` changed.
  onChange(state: UpdateState, menuChanged: boolean): void;
  // The app's save and shutdown path before a restart; false cancels it.
  prepareToRestart(): Promise<boolean>;
  // Keeps unsaved window state before a reload; false cancels it.
  prepareToReload?(): Promise<boolean>;
  // Loads every window's page again from `renderer()`.
  reload(): Promise<void> | void;
  // The restart confirmation's detail.
  restartDetail?: string;
};

// Installer and JavaScript updates for the app the launcher started.
export type Updates = {
  // The signed JavaScript release running, or null for the installer's own.
  readonly release: string | null;
  // The commit the running JavaScript was built from.
  readonly commit: string;
  // The running JavaScript's version for log records: release or installer
  // version, plus commit.
  readonly version: string;
  // This launch runs a CLI command beside the app.
  readonly cli: boolean;
  // This launch's log session, which the app's records share.
  readonly session: string;
  state(): UpdateState;
  // Checks after 15 seconds and every four hours.
  start(hooks: UpdateHooks): void;
  stop(): void;
  check(): Promise<UpdateState>;
  // The channel this install follows: the one picked, else its version's.
  channel(): Channel;
  // Follows `channel` from now on, even when its newest build is older than
  // this one: drops an update downloaded from the other channel and checks.
  setChannel(channel: Channel): Promise<UpdateState>;
  // Reloads the windows into a JavaScript update that only changes them, or
  // confirms and restarts into any other update.
  install(): Promise<void>;
  menuItem(): MenuItemConstructorOptions & { label: string; enabled: boolean };
  // The app is working: a newly activated release becomes the working one.
  // One that never gets here is rolled back.
  ready(): void;
  // A path in the window code of the release running.
  renderer(...path: string[]): string;
};

const fallbackSession = randomUUID();

// The launcher (out/bootstrap) provides the updater. Code started without it,
// such as smoke entry points, gets one that is off.
export const updates = (): Updates =>
  (globalThis as typeof globalThis & { wrkrshUpdates?: Updates })
    .wrkrshUpdates ?? {
    release: null,
    commit: "unknown",
    get version() {
      return `${app.getVersion()}+unknown`;
    },
    cli: false,
    session: fallbackSession,
    state: () => ({
      status: "disabled",
      reason: "Started without its launcher.",
    }),
    start: () => undefined,
    stop: () => undefined,
    check: async () => ({
      status: "disabled",
      reason: "Started without its launcher.",
    }),
    channel: () => channelOf(app.getVersion()),
    setChannel: async () => ({
      status: "disabled",
      reason: "Started without its launcher.",
    }),
    install: async () => undefined,
    menuItem: () => ({ label: "Check for Updates…", enabled: false }),
    ready: () => undefined,
    renderer: (...path) => join(app.getAppPath(), "out/renderer", ...path),
  };
