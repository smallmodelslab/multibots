/// <reference types="chrome" />
import {
  browserHost,
  browserProtocol,
  type BrowserRequest,
  type BrowserTab,
  type BrowserWelcome,
} from "../shared/browser";
import {
  click,
  forget,
  press,
  screenshot,
  scrollCapture,
  snapshot,
  type,
} from "./page";

// Multibots' hands in the user's Chrome. Bots work in tabs of their own, in
// a window of each bot's that opens without taking the focus, grouped under
// the bot's name; the user's own tabs stay theirs. A tab is a bot's while it
// stays in that bot's window. While a bot acts, Chrome shows its bar saying
// Multibots is debugging the browser; cancelling it there, or Stop in the
// popup, stops every bot until the user lets them go on. Nothing connects
// until the user, told what bots do and where what they read goes, allows
// it on the page the extension opens when installed.

type Owner = { bot: string; window: number };

// Kept in session storage for Chrome restarting this worker.
const owners = new Map<number, Owner>();
const attached = new Set<number>();
const queues = new Map<number, Promise<unknown>>();
let port: chrome.runtime.Port | null = null;
let connected = false;
let stopped = false;
let allowed = false;
let error: string | undefined;

const loaded = Promise.all([
  chrome.storage.session.get("owners"),
  chrome.storage.local.get(["stopped", "allowed"]),
]).then(([saved, local]) => {
  stopped = local.stopped === true;
  allowed = local.allowed === true;
  for (const [tab, owner] of Object.entries(saved.owners ?? {}))
    owners.set(Number(tab), owner as Owner);
});

const save = async () => {
  await chrome.storage.session.set({ owners: Object.fromEntries(owners) });
  await chrome.storage.local.set({ allowed, stopped });
  await chrome.action.setBadgeText({
    text: owners.size ? String(owners.size) : "",
  });
};

const web = (url: string) => /^https?:\/\//i.test(url);

const describe = async (tab: number): Promise<BrowserTab> => {
  const { title = "", url = "", pendingUrl } = await chrome.tabs.get(tab);
  return { tab, title, url: pendingUrl ?? url };
};

// Until the tab has loaded, or a while has passed.
const settle = async (tab: number) => {
  for (let waited = 0; waited < 15_000; waited += 100) {
    const { status } = await chrome.tabs.get(tab);
    if (status === "complete") return;
    await new Promise((done) => setTimeout(done, 100));
  }
};

const release = async (tab: number) => {
  forget(tab);
  if (attached.delete(tab))
    await chrome.debugger.detach({ tabId: tab }).catch(() => {});
};

// The bot's own tab, shown in its window.
const own = async (bot: string, tab: number) => {
  const owner = owners.get(tab);
  const current = await chrome.tabs.get(tab).catch(() => null);
  if (owner?.bot !== bot || current?.windowId !== owner.window)
    throw new Error(
      `Tab ${tab} is not one of yours. Use tabs to list yours, or open one.`,
    );
  if (!web(current.pendingUrl ?? current.url ?? ""))
    throw new Error(
      "Bots use web pages only, not Chrome's own or local files.",
    );
  if (!current.active) await chrome.tabs.update(tab, { active: true });
  return tab;
};

// The debugger on the tab, for what the bot does in its page.
const debug = async (tab: number) => {
  if (!attached.has(tab)) {
    await chrome.debugger.attach({ tabId: tab }, "1.3");
    attached.add(tab);
    // Focus works in a window the user is not looking at.
    await chrome.debugger.sendCommand(
      { tabId: tab },
      "Emulation.setFocusEmulationEnabled",
      { enabled: true },
    );
  }
  // Stopping while it attached found nothing to detach yet.
  if (stopped) {
    await release(tab);
    throw stoppedError();
  }
};

const open = async (bot: string, name: string, url: string) => {
  const sibling = [...owners].find(([, owner]) => owner.bot === bot);
  let tab: chrome.tabs.Tab;
  if (sibling) {
    tab = await chrome.tabs.create({ url, windowId: sibling[1].window });
  } else {
    const window = await chrome.windows.create({ focused: false, url });
    tab = window?.tabs?.[0] as chrome.tabs.Tab;
  }
  if (tab?.id === undefined || tab.windowId === undefined)
    throw new Error("Chrome did not open the tab.");
  owners.set(tab.id, { bot, window: tab.windowId });
  await save();
  const group = sibling
    ? (await chrome.tabs.get(sibling[0])).groupId
    : chrome.tabGroups.TAB_GROUP_ID_NONE;
  const groupId = await chrome.tabs.group({
    tabIds: tab.id,
    ...(group !== chrome.tabGroups.TAB_GROUP_ID_NONE
      ? { groupId: group }
      : { createProperties: { windowId: tab.windowId } }),
  });
  await chrome.tabGroups.update(groupId, { color: "green", title: name });
  await settle(tab.id);
  return describe(tab.id);
};

const stoppedError = () =>
  new Error(
    "The user stopped bots in Chrome. They can let them go on in the Multibots extension.",
  );

const run = async (request: BrowserRequest): Promise<unknown> => {
  if (stopped) throw stoppedError();
  const { bot } = request;
  switch (request.action) {
    case "tabs":
      return Promise.all(
        [...owners]
          .filter(([, owner]) => owner.bot === bot)
          .map(([tab]) => describe(tab)),
      );
    case "open":
      if (!web(request.url)) throw new Error("Open http or https addresses.");
      return open(bot, request.name, request.url);
  }
  const tab = await own(bot, request.tab);
  switch (request.action) {
    case "navigate":
      if (!web(request.url)) throw new Error("Open http or https addresses.");
      await chrome.tabs.update(tab, { url: request.url });
      await settle(tab);
      return describe(tab);
    case "back":
      await chrome.tabs.goBack(tab);
      await settle(tab);
      return describe(tab);
    case "close":
      await release(tab);
      owners.delete(tab);
      await save();
      await chrome.tabs.remove(tab);
      return null;
  }
  await debug(tab);
  switch (request.action) {
    case "snapshot":
      await settle(tab);
      return {
        ...(await describe(tab)),
        outline: await snapshot(tab, request.ref),
      };
    case "click":
      await click(tab, request);
      await settle(tab);
      return describe(tab);
    case "type":
      await type(tab, request.ref, request.text, request.submit);
      await settle(tab);
      return describe(tab);
    case "press":
      await press(tab, request.key);
      await settle(tab);
      return describe(tab);
    case "screenshot":
      await settle(tab);
      return { ...(await describe(tab)), ...(await screenshot(tab)) };
    case "scroll_capture":
      await settle(tab);
      return {
        ...(await describe(tab)),
        ...(await scrollCapture(tab, request, request.maxSteps ?? 100)),
      };
  }
};

// One command at a time in each tab.
const dispatch = async (request: BrowserRequest) => {
  await loaded;
  const key = "tab" in request ? request.tab : -1;
  const work = (queues.get(key) ?? Promise.resolve())
    .catch(() => {})
    .then(() => run(request));
  queues.set(key, work);
  void work
    .finally(() => {
      if (queues.get(key) === work) queues.delete(key);
    })
    .catch(() => {});
  return work;
};

const stop = async () => {
  stopped = true;
  await Promise.all([...attached].map(release));
  await save();
};

chrome.debugger.onDetach.addListener(({ tabId }, reason) => {
  if (tabId === undefined || !attached.delete(tabId)) return;
  forget(tabId);
  // The user cancelled Chrome's bar.
  if (reason === "canceled_by_user") void stop();
});
const drop = (tab: number) => {
  void loaded.then(async () => {
    await release(tab);
    if (owners.delete(tab)) await save();
  });
};
chrome.tabs.onRemoved.addListener(drop);
chrome.tabs.onDetached.addListener(drop);

const connect = () => {
  if (port || !allowed) return;
  error = undefined;
  const current = chrome.runtime.connectNative(browserHost);
  port = current;
  current.onMessage.addListener((message: BrowserWelcome | BrowserRequest) => {
    if (port !== current) return;
    if ("ready" in message) {
      connected = true;
      void chrome.alarms.clear("reconnect");
      return;
    }
    // Multibots updated the folder this was loaded from.
    if ("reload" in message) return chrome.runtime.reload();
    if ("error" in message) {
      error = message.error;
      current.disconnect();
      return disconnected(current);
    }
    void dispatch(message).then(
      (result) => {
        if (port === current) current.postMessage({ id: message.id, result });
      },
      (failure: unknown) => {
        if (port === current)
          current.postMessage({
            error:
              failure instanceof Error
                ? failure.message
                : "Chrome could not do that.",
            id: message.id,
          });
      },
    );
  });
  current.onDisconnect.addListener(() => {
    void chrome.runtime.lastError;
    disconnected(current);
  });
  current.postMessage({ hello: browserProtocol });
};

const disconnected = (current: chrome.runtime.Port) => {
  if (port !== current) return;
  port = null;
  connected = false;
  queues.clear();
  void chrome.alarms.create("reconnect", { delayInMinutes: 0.5 });
};

chrome.runtime.onMessage.addListener((message, sender, answer) => {
  if (sender.id !== chrome.runtime.id) return;
  void (async () => {
    await loaded;
    if (message === "stop") await stop();
    if (message === "go on") {
      stopped = false;
      await save();
    }
    if (message === "allow") {
      allowed = true;
      await save();
    }
    if (message === "connect" || message === "allow") connect();
    answer({ allowed, connected, error, stopped, tabs: owners.size });
  })();
  return true;
});
chrome.alarms.onAlarm.addListener(({ name }) => {
  if (name === "reconnect") connect();
});
chrome.runtime.onStartup.addListener(connect);
// What it does, and the choice to allow it, first: also for one that
// updated from before it asked.
chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === "install" || reason === "update")
    void loaded.then(() => {
      if (!allowed) void chrome.tabs.create({ url: "popup.html" });
    });
});
void loaded.then(async () => {
  await save();
  connect();
});
