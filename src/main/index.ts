import {
  updates,
  type Channel,
  type UpdateState,
} from "@wrkrsh/electron-update";
import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeTheme,
  shell,
  type MenuItemConstructorOptions,
} from "electron";
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { hostname, userInfo } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import type { BoardElement, BoardFile } from "@wrkrsh/whiteboard/scene";

import type {
  AppState,
  Bot,
  Bridge,
  Change,
  Command,
  Host,
  ModelList,
  OwnModelInput,
  OwnModelKind,
} from "../shared/types";
import appIconPath from "../../build/icon.png?asset";
import {
  analyticsOn,
  capture,
  captureError,
  setAnalytics,
  setFlags,
  startAnalytics,
  tracked,
} from "./analytics";
import { Bots, mergeConversations } from "./bots";
import { Browser } from "./browser";
import { Chatgpt } from "./chatgpt";
import { Computer } from "./computer";
import { localGrokBots } from "./grokBot";
import { logError } from "./log";
import { OwnModels } from "./ownModels";
import { defaultPort, type HostInfo } from "../shared/peer";
import { Peers } from "./peers";
import { Plugins } from "./plugins";
import { Replica } from "./replica";
import { readSealed } from "./sealed";
import { Webhooks, type SavedWebhook } from "./webhooks";

// A second client on one computer, for development, keeps its own data and
// port.
if (process.env.OPENBOTS_HOME)
  app.setPath("userData", process.env.OPENBOTS_HOME);
app.setName("OpenBots");

const home = app.getPath("userData");
const here = dirname(fileURLToPath(import.meta.url));

const computerName = () => {
  if (process.platform === "darwin")
    try {
      return execFileSync("scutil", ["--get", "ComputerName"], {
        encoding: "utf8",
      }).trim();
    } catch {
      // Falls back to the host name.
    }
  return hostname().replace(/\.local$/, "");
};

// The user's full name where the system knows it.
const userName = () => {
  if (process.platform === "darwin")
    try {
      return execFileSync("id", ["-F"], { encoding: "utf8" }).trim();
    } catch {
      // Falls back to the account name.
    }
  return userInfo().username;
};

const osName =
  { darwin: "macOS", linux: "Linux", win32: "Windows" }[
    process.platform as string
  ] ?? process.platform;

// This computer's id among the user's, kept across launches.
const computerId = async () => {
  const file = join(home, "computer.json");
  const saved = await readFile(file, "utf8").then(
    (text) => JSON.parse(text) as { id: string },
    () => null,
  );
  if (saved) return saved.id;
  const id = randomUUID();
  await writeFile(file, JSON.stringify({ id }));
  return id;
};

const windows = new Set<BrowserWindow>();
const broadcast = (channel: string, value: unknown) => {
  for (const window of windows) window.webContents.send(channel, value);
};

// A page of the release running, so a reload shows a new one.
const load = (window: BrowserWindow, page = "index.html") =>
  process.env.ELECTRON_RENDERER_URL
    ? window.loadURL(`${process.env.ELECTRON_RENDERER_URL}/${page}`)
    : window.loadFile(updates().renderer(page));

// A bot's whiteboard as the bot sees it, a PNG in base64, rendered by the
// release's whiteboard page in a hidden window, so the bot sees it whether
// or not a window of OpenBots is open.
const renderBoard = async (
  elements: readonly BoardElement[],
  files: readonly BoardFile[],
  signal?: AbortSignal,
) => {
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      backgroundThrottling: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  const stop = AbortSignal.any([
    AbortSignal.timeout(60_000),
    ...(signal ? [signal] : []),
  ]);
  try {
    return await new Promise<string>((done, fail) => {
      stop.addEventListener("abort", () => fail(stop.reason), { once: true });
      load(window, "whiteboard.html")
        .then(
          () =>
            window.webContents.executeJavaScript(
              `renderWhiteboard(${JSON.stringify(elements)}, ${JSON.stringify(files)})`,
            ) as Promise<string>,
        )
        .then(done, fail);
    });
  } finally {
    window.destroy();
  }
};

// Electron's own menu, with updates in the app menu, or Help off macOS.
// Rebuilt whenever the update state relabels its item.
const setMenu = () => {
  const update = updates().menuItem();
  const template: MenuItemConstructorOptions[] = [
    { role: "fileMenu" },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
  ];
  if (process.platform === "darwin")
    template.unshift({
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        update,
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    });
  else template.push({ role: "help", submenu: [update] });
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
};

const createWindow = () => {
  const background = () =>
    nativeTheme.shouldUseDarkColors ? "#18181b" : "#ffffff";
  const window = new BrowserWindow({
    icon: appIconPath,
    backgroundColor: background(),
    height: 860,
    minHeight: 560,
    minWidth: 900,
    show: false,
    title: "OpenBots",
    titleBarStyle: process.platform === "darwin" ? "hidden" : "default",
    trafficLightPosition: { x: 16, y: 18 },
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: join(here, "../preload/index.cjs"),
      sandbox: true,
    },
    width: 1320,
  });
  windows.add(window);
  const updateBackground = () => window.setBackgroundColor(background());
  nativeTheme.on("updated", updateBackground);
  window.once("closed", () => {
    windows.delete(window);
    nativeTheme.off("updated", updateBackground);
  });
  window.once("ready-to-show", () => window.show());
  // The window only ever shows OpenBots; a link opens in the browser.
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  void load(window);
};

// Whether this computer is one of the user's OpenBots servers, which keep
// and run the bots: each is, until the user turns server mode off.
const serverFile = () => join(home, "server.json");
const readServerMode = () =>
  readFile(serverFile(), "utf8").then(
    (text) => (JSON.parse(text) as { server: boolean }).server,
    () => true,
  );

// What a server answers to a command handed to it for a bot it no longer
// writes, or as it stops: the server that handed it asks again.
const moved = "That bot just moved to another server. Try again.";

// What a window asks that changes no bot.
const reads = new Set<Command["type"]>([
  "bot.get",
  "file.read",
  "voice.hear",
  "voice.listen",
  "whiteboard.file",
  "whiteboard.get",
  "whiteboard.image",
]);

// What a window asks often, which analytics leaves out: what only reads, and
// the whiteboard saving as the user draws.
const untracked = new Set<Command["type"]>([
  ...reads,
  "bots.list",
  "whiteboard.save",
]);

const start = async () => {
  // Only the user reads their bots: another user of this computer could
  // otherwise read every conversation and file.
  await mkdir(home, { recursive: true });
  await chmod(home, 0o700);
  const hostId = await computerId();
  await startAnalytics(home, hostId);
  const name = computerName();
  const user = userName();
  const botsDir = join(home, "bots");

  const hostChanged = () => {
    void pushState();
    peers.hostChanged();
  };
  const chatgpt = new Chatgpt(join(home, "chatgpt.json"), hostChanged);
  const own = new OwnModels(join(home, "own-models.json"), hostChanged);
  const plugins = new Plugins(
    join(home, "plugins.json"),
    () => void pushState(),
  );
  // This computer's Chrome, which its bots use when this is a server.
  const browser = new Browser(home, here, () => void pushState());
  // A server's: its screen, and its copies of the bots, which it runs once
  // it has caught up with the other servers and serves.
  let computer: Computer | null = null;
  let bots: Bots | null = null;
  let serving = false;
  const self = (): HostInfo => {
    const signedIn = chatgpt.state().signedIn;
    const [voice] = own.voice(signedIn);
    const first = own.bots().find((entry) => entry !== "chatgpt" || signedIn);
    return {
      id: hostId,
      model: first === "chatgpt" ? "ChatGPT" : (first?.model ?? null),
      name,
      os: osName,
      running: bots?.running() ?? 0,
      screen: computer?.screen() ?? null,
      server: serving,
      voice:
        voice?.kind === "own"
          ? { kind: "own", voices: voice.speech[0]!.voices }
          : (voice ?? null),
    };
  };
  // The servers online, this one first when it is one.
  const servers = () => [
    ...(serving && bots ? [{ id: hostId, running: bots.running() }] : []),
    ...peers.servers().map(({ id, running }) => ({ id, running })),
  ];
  // The webhooks of the bots this server writes.
  const webhooks = new Webhooks({
    onRegistered: (routineId) => void bots?.registered(routineId),
    onRequest: async (routineId, body, at, id) => {
      if (!bots) throw new Error("Not a server.");
      await bots.webhookCalled(routineId, body, at, id);
    },
  });
  const replica = new Replica({
    dir: botsDir,
    fetch: (server, botId, path) => peers.copy(server, botId, path),
    hostId,
    manifest: (server) => peers.manifest(server),
    merge: (path, older, newer) =>
      path === "messages.json" ? mergeConversations(older, newer) : null,
    onApplied: async (botId, path) => {
      await bots?.applied(botId, path);
    },
    onBehind: (server, error) =>
      logError("replica", "Could not catch up with another server.", {
        error,
        server,
      }),
    send: (server, copy) => peers.replicate(server, copy),
    servers: () => peers.servers().map(({ id }) => id),
  });

  // What a window asks, here or elsewhere: a screen is its computer's own;
  // a bot's command goes to the server writing the bot, and anything else
  // to a server, this one when it is one.
  const route = async (command: Command, handedOn = false) => {
    if (command.type === "screen.view" || command.type === "screen.close") {
      if (command.hostId !== hostId) return peers.call(command.hostId, command);
      if (!computer) throw new Error("This computer's screen isn't shown.");
      if (command.type === "screen.view") return computer.view(command.sdp);
      computer.stopView(command.session);
      return null;
    }
    const here = serving ? bots : null;
    if (!here) {
      if (handedOn) throw new Error(moved);
      const [server] = peers.servers();
      if (!server) throw new Error("None of your OpenBots servers is online.");
      return peers.call(server.id, command);
    }
    if (!("botId" in command)) return here.handle(command);
    const { botId } = command;
    const read = reads.has(command.type);
    // Once what the bot's last writer sent here is taken in: handled here
    // when this server writes the bot, else to go to the one that does. A
    // command handed here is handled here, or refused when this server no
    // longer writes the bot, except what only reads.
    const act = async (): Promise<{ result: unknown } | { to: string }> => {
      await replica.settled(botId);
      const writer = here.writer(botId);
      if (writer !== hostId && !(handedOn && read)) {
        if (handedOn) throw new Error(moved);
        return { to: writer };
      }
      return { result: await here.handle(command) };
    };
    // What changes the bot waits its turn here, and goes on to another
    // server only once its turn ends, so no two servers wait on each other.
    for (let tries = 1; ; tries += 1) {
      const done = read ? await act() : await here.exclusive(botId, act);
      if ("result" in done) return done.result;
      try {
        return await peers.handOn(done.to, command);
      } catch (error) {
        if (
          tries === 5 ||
          !(error instanceof Error) ||
          !error.message.includes(moved)
        )
          throw error;
        await new Promise((wait) => setTimeout(wait, 200 * tries));
      }
    }
  };

  // The servers this one has met since they came online.
  let met = new Set<string>();
  const serversChanged = async () => {
    const online = peers.servers().map(({ id }) => id);
    const fresh = online.filter((id) => !met.has(id));
    met = new Set(online);
    if (!bots) return;
    await Promise.all(fresh.map((id) => replica.meet(id)));
    bots?.serversChanged();
  };

  const peers = new Peers({
    file: join(home, "pairing.json"),
    handle: (command, handedOn) => route(command, handedOn),
    onChange: (change, from, status) => {
      if (status && change.botId) bots?.hear(from, change.botId, status);
      broadcast("openbots:change", change);
    },
    onHosts: () => {
      void pushState();
      void serversChanged();
    },
    port: Number(process.env.OPENBOTS_PORT) || defaultPort,
    // Only a server that serves takes copies, and says what it has: one
    // turning server mode off does neither, so another doing so at once
    // cannot hand it the bots.
    replica: {
      apply: async (copy) => {
        if (!serving) throw new Error("Not a server.");
        await replica.apply(copy);
      },
      copy: (botId, path) => replica.copy(botId, path),
      manifest: () => {
        if (!serving) throw new Error("Not a server.");
        return replica.manifest();
      },
    },
    self,
    statuses: () => (serving && bots ? bots.statuses() : []),
  });

  // Becomes a server: takes every bot the servers online have, then runs
  // what it writes. The first server makes a bot to start with, pinned.
  const startServer = async () => {
    computer = new Computer(
      home,
      name,
      hostChanged,
      (url) => void shell.openExternal(url),
    );
    await replica.load();
    const made = new Bots({
      browser,
      chatgpt,
      computer,
      dir: botsDir,
      hostId,
      hostName: name,
      onChange: (botId, extra) => {
        broadcast("openbots:change", {
          botId,
          ...(extra?.whiteboard && { whiteboard: true }),
        } satisfies Change);
        peers.changed(botId, extra);
      },
      onError: (botId, error) =>
        logError("bots", "Changing a bot failed.", { botId, error }),
      analytics: { capture, captureError },
      onRunning: hostChanged,
      own,
      plugins,
      renderBoard,
      replica,
      servers,
      webhooks,
      ask: (command) => route(command),
    });
    bots = made;
    await made.load();
    met = new Set(peers.servers().map(({ id }) => id));
    await Promise.all([...met].map((id) => replica.catchUp(id)));
    serving = true;
    made.start();
    hostChanged();
    // Released versions kept webhooks for the whole computer.
    const legacy = join(home, "webhooks.json");
    const webhooksBefore = await readSealed<{
      [routineId: string]: SavedWebhook;
    }>(legacy).catch(() => null);
    if (webhooksBefore) {
      await made.adopt(webhooksBefore);
      await rm(legacy, { force: true });
    }
    await computer.start();
    if (!replica.ids().length) {
      const first = (await made.handle({
        hue: 145,
        instructions: "",
        name: "OpenBot",
        type: "bot.create",
      })) as Bot;
      await made.handle({ botId: first.id, pinned: true, type: "bot.update" });
    }
  };

  // Stops being a server: its runs end first, what they were reading saved
  // for the next server, then another that still serves takes every bot,
  // and only then are its copies let go. With none to take them, it serves
  // again.
  const stopServer = async () => {
    // Takes no more commands, then lets those taken, and the runs, end.
    const stopping = bots;
    bots = null;
    await stopping?.close();
    serving = false;
    computer?.close();
    computer = null;
    hostChanged();
    let kept = !replica.ids().length;
    for (const { id } of peers.servers())
      await replica.hand(id).then(
        () => (kept = true),
        () => {},
      );
    if (!kept) {
      await startServer();
      throw new Error(
        "Turn on server mode on another of your computers first, so it keeps your bots.",
      );
    }
    await replica.clear();
  };

  const setServer = async (on: boolean) => {
    if (on === serving) return;
    if (on) await startServer();
    else await stopServer();
    await writeFile(serverFile(), JSON.stringify({ server: on }));
    hostChanged();
    broadcast("openbots:change", { botId: null } satisfies Change);
  };

  const state = (): AppState => ({
    chatgpt: chatgpt.state(),
    ownModels: own.state(),
    plugins: plugins.state(),
    hosts: [
      { ...self(), online: true, self: true } satisfies Host,
      ...peers.hosts(),
    ],
    multidesktop: computer?.multidesktop() ?? {
      computers: null,
      current: false,
      installing: false,
      signingIn: false,
      version: null,
    },
    chrome: browser.state(),
    pairing: peers.pairing(),
    tailscale: peers.tailscale,
    update: updates().state(),
    channel: updates().channel(),
    analytics: analyticsOn(),
    user,
  });
  const pushState = async () => broadcast("openbots:state", state());

  await chatgpt.load();
  await own.load();
  await plugins.load();
  await peers.load();
  await peers.start();
  await browser
    .start()
    .catch((error: unknown) =>
      logError("browser", "Chrome's connection failed to start.", { error }),
    );
  if (await readServerMode()) await startServer();

  // What the user asks of this computer, recorded by name and outcome.
  const act = <A extends unknown[], R>(
    name: string,
    run: (...args: A) => R | Promise<R>,
    failed?: (result: R) => boolean,
  ) =>
    ipcMain.handle(`openbots:${name}`, (_event, ...args: A) =>
      tracked(name, () => run(...args), failed),
    );
  // Answers that tell of a failure without throwing.
  const updateFailed = (update: UpdateState) => update.status === "error";
  const openFailed = (problem: string) => problem !== "";
  ipcMain.handle("openbots:state", () => state());
  // The window has drawn the app, also after a reload: the release works.
  ipcMain.on("openbots:ready", () => updates().ready());
  ipcMain.on("openbots:flags", (_event, flags: string[]) => setFlags(flags));
  ipcMain.on("openbots:error", (_event, error: unknown) =>
    logError("window", "The window hit an error.", { error }),
  );
  ipcMain.handle("openbots:analytics", async (_event, on: boolean) => {
    await setAnalytics(on);
    void pushState();
  });
  ipcMain.handle("openbots:call", (_event, command: Command) =>
    untracked.has(command.type)
      ? route(command)
      : tracked(command.type, () => route(command)),
  );
  act("server", (on: boolean) => setServer(on));
  act("update-check", () => updates().check(), updateFailed);
  act("update-install", () => updates().install());
  act(
    "update-channel",
    (channel: Channel) => {
      // Followed at once; the check it starts may download for a while.
      const checked = updates().setChannel(channel);
      void pushState();
      return checked;
    },
    updateFailed,
  );
  act("sign-in", () => chatgpt.signIn());
  act("sign-out", () => chatgpt.signOut());
  act("pair", (code: string | null) => peers.pair(code));
  ipcMain.handle(
    "openbots:served-models",
    (_event, address: string, key: string) => own.served(address, key),
  );
  act("connect-model", (kind: OwnModelKind, input: OwnModelInput) =>
    own.connect(kind, input),
  );
  act("disconnect-model", (id: string) => own.disconnect(id));
  act("order-models", (list: ModelList, order: string[]) =>
    own.order(list, order),
  );
  act("composio-key", (key: string) => plugins.setKey(key));
  ipcMain.handle(
    "openbots:plugins",
    (_event, query: Parameters<Bridge["plugins"]>[0]) => plugins.plugins(query),
  );
  act("connect-plugin", (slug: string) => plugins.connect(slug));
  act("disconnect-plugin", (slug: string) => plugins.disconnect(slug));
  act("allow-screen", () => computer?.allow());
  act("install-multidesktop", () => computer?.install());
  act("set-up-chrome", async () => {
    const folder = await browser.setUp();
    shell.showItemInFolder(join(folder, "manifest.json"));
    spawn(
      process.platform === "darwin" ? "open" : "google-chrome",
      process.platform === "darwin"
        ? ["-a", "Google Chrome", "chrome://extensions"]
        : ["chrome://extensions"],
      { detached: true, stdio: "ignore" },
    )
      .on("error", () => {})
      .unref();
  });
  act("sign-in-multidesktop", () => computer?.signIn());
  ipcMain.handle("openbots:grok-bots", () =>
    localGrokBots(app.getPath("appData")),
  );
  act(
    "open-folder",
    async (botId: string) => {
      const folder = join(botsDir, botId, "files");
      await mkdir(folder, { recursive: true });
      return shell.openPath(folder);
    },
    openFailed,
  );
  // A file of a bot opens from this server's copy, or on a client from a
  // copy in the data folder, which only the user reads, kept until the app
  // starts again.
  const opened = join(home, "opened");
  await rm(opened, { force: true, recursive: true });
  act(
    "open-file",
    async (botId: string, path: string) => {
      if (bots) return shell.openPath(join(botsDir, botId, "files", path));
      const data = (await route({ botId, path, type: "file.read" })) as string;
      const copy = resolve(opened, botId, path);
      if (!copy.startsWith(opened + sep))
        throw new Error("That file is outside the bot's folder.");
      await mkdir(dirname(copy), { recursive: true });
      await writeFile(copy, Buffer.from(data, "base64"));
      return shell.openPath(copy);
    },
    openFailed,
  );

  // Stops every bot's run, with what its shell started, the webhooks, the
  // peers and the desktop.
  const shutDown = () => {
    void bots?.close();
    peers.close();
    computer?.close();
    void browser.close();
  };
  app.on("before-quit", shutDown);
  setMenu();
  createWindow();
  // A restart into an update exits without quitting, so it shuts down here.
  updates().start({
    onChange(_state, menuChanged) {
      void pushState();
      if (menuChanged) setMenu();
    },
    prepareToRestart: async () => {
      shutDown();
      return true;
    },
    reload: async () => {
      await Promise.all([...windows].map((window) => load(window)));
    },
  });
};

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    const [window] = windows;
    if (window?.isMinimized()) window.restore();
    window?.focus();
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
  app.on("activate", () => {
    if (!windows.size) createWindow();
  });
  void app.whenReady().then(start);
}
