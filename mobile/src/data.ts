import { fetch as streamingFetch } from "expo/fetch";
import { File, Paths } from "expo-file-system";
import { useCallback, useSyncExternalStore } from "react";
import { AppState } from "react-native";

import {
  ask,
  askAt,
  codeLength,
  defaultPort,
  formatCode,
  normalizeCode,
  readEvents,
  Unpaired,
  type HostInfo,
} from "../../src/shared/peer";
import {
  botKey,
  botsKey,
  createStore,
  keyParts,
  whiteboardKey,
} from "../../src/shared/store";
import type {
  Bot,
  BotDetail,
  Command,
  CommandName,
  Commands,
  Host,
  ResultOf,
} from "../../src/shared/types";

// The user's computers running OpenBots, reached over their tailnet as they
// reach each other: the phone is one of the user's devices there, and holds
// the pairing code they share, so their computers answer it. It asks the
// servers among them about the bots, keeps none of its own, and listens for
// none.

export const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

// The addresses of the computers the user added, and of those found
// through them.
const saved = new File(Paths.document, "computers.json");
let addresses: string[] = (() => {
  try {
    return saved.exists ? (JSON.parse(saved.textSync()) as string[]) : [];
  } catch {
    return [];
  }
})();
const remember = (address: string) => {
  if (addresses.includes(address)) return;
  addresses = [...addresses, address];
  void saved.write(JSON.stringify(addresses));
};

// The pairing code the phone signs its requests with.
const pairingFile = new File(Paths.document, "pairing.json");
let code: string = (() => {
  try {
    return pairingFile.exists
      ? (JSON.parse(pairingFile.textSync()) as { code: string }).code
      : "";
  } catch {
    return "";
  }
})();

type Connection = { address: string; info: HostInfo; stop: AbortController };
const connections = new Map<string, Connection>();
const connecting = new Set<string>();
// The addresses whose OpenBots holds another code.
const unpaired = new Set<string>();

// What the screens show of the computers: those it reaches, the addresses
// of those it cannot, and the phone's pairing code.
type Computers = {
  code: string;
  hosts: Host[];
  offline: { address: string; unpaired: boolean }[];
};
let computers: Computers = { code: "", hosts: [], offline: [] };
const listeners = new Set<() => void>();
// The servers it reaches, by id: the bots are read anew whenever they
// change, such as when the first comes.
const serversOf = (hosts: HostInfo[]) =>
  hosts
    .filter((host) => host.server)
    .map((host) => host.id)
    .sort()
    .join(" ");
const publish = () => {
  const reached = [...connections.values()];
  const before = serversOf(computers.hosts);
  computers = {
    code: formatCode(code) ?? "",
    hosts: reached.map(({ info }) => ({ ...info, online: true, self: false })),
    offline: addresses
      .filter((address) => !reached.some((each) => each.address === address))
      .map((address) => ({ address, unpaired: unpaired.has(address) })),
  };
  if (serversOf(computers.hosts) !== before) store.changed({ botId: null });
  for (const listener of listeners) listener();
};

export const useComputers = () =>
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => computers,
  );

// What the computer at `address` answers, or null when it doesn't; it
// throws `Unpaired` when it holds another code.
const get = async (address: string, path: string, withCode = code) => {
  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(), 3000);
  try {
    const response = await ask(address, withCode, path, {
      signal: stop.signal,
    });
    return response.ok ? ((await response.json()) as unknown) : null;
  } catch (error) {
    if (error instanceof Unpaired) throw error;
    return null;
  } finally {
    clearTimeout(timer);
  }
};

// A stream that says nothing, not even its heartbeat, for this long went
// away without closing, as when the phone changed networks.
const silentMs = 60_000;

// `withCode` is the code the connection began with: a stream that answers
// after the code changed is let go.
const follow = async (
  hostId: string,
  connection: Connection,
  withCode: string,
) => {
  const events = await ask(connection.address, withCode, "/events", {
    fetch: streamingFetch,
    signal: connection.stop.signal,
  });
  if (!events.ok || !events.body || withCode !== code) {
    connection.stop.abort();
    throw new Error("No events.");
  }
  connections.set(hostId, connection);
  publish();
  // What changed while it was away is read anew.
  store.changed({ botId: null });
  let timer = setTimeout(() => connection.stop.abort(), silentMs);
  void readEvents(
    events.body,
    (event) => {
      if ("host" in event) {
        connection.info = event.host;
        publish();
      } else store.changed(event);
    },
    () => {
      clearTimeout(timer);
      timer = setTimeout(() => connection.stop.abort(), silentMs);
    },
  )
    .catch(() => {
      // Gone: it closed, slept or left the tailnet.
    })
    .finally(() => {
      clearTimeout(timer);
      connection.stop.abort();
      if (connections.get(hostId) === connection) connections.delete(hostId);
      publish();
    });
};

const connect = async (address: string) => {
  if (
    connecting.has(address) ||
    [...connections.values()].some((each) => each.address === address)
  )
    return;
  connecting.add(address);
  const withCode = code;
  try {
    const info = (await get(address, "", withCode)) as HostInfo | null;
    if (unpaired.delete(address)) publish();
    if (!info || connections.has(info.id)) return;
    await follow(
      info.id,
      { address, info, stop: new AbortController() },
      withCode,
    );
    await discover(address);
  } catch (error) {
    if (
      error instanceof Unpaired &&
      withCode === code &&
      !unpaired.has(address)
    ) {
      unpaired.add(address);
      publish();
    }
    // Otherwise out of reach for now.
  } finally {
    connecting.delete(address);
  }
};

// The user's other computers, as the one at `address` reaches them.
const discover = async (address: string) => {
  const found = await askAt<string[]>(address, code, "/peers").catch(
    () => null,
  );
  for (const each of found ?? []) {
    remember(each);
    void connect(each);
  }
};

// Every computer it knows, again, while the app is open.
const reach = () => {
  for (const address of addresses) void connect(address);
  for (const { address } of connections.values()) void discover(address);
  publish();
};
setInterval(() => {
  if (AppState.currentState === "active") reach();
}, 15_000);
AppState.addEventListener("change", (state) => {
  if (state === "active") reach();
});
reach();

// The computer at the address the user typed, which must answer to the code
// they typed before either is kept; or only a new code, for the computers it
// knows.
export const addComputer = async (typedAddress: string, typedCode: string) => {
  const next = normalizeCode(typedCode);
  if (next.length !== codeLength)
    throw new Error(
      "A pairing code has 20 letters and digits. Find it in Settings on your computer.",
    );
  const typed = typedAddress.trim();
  const address = !typed
    ? null
    : /:\d+$/.test(typed)
      ? typed
      : `${typed}:${defaultPort}`;
  if (address && !(await get(address, "", next)))
    throw new Error(
      "No OpenBots answered there. Check the address, and that this phone is on the same Tailscale account.",
    );
  if (next !== code) {
    code = next;
    void pairingFile.write(JSON.stringify({ code }));
    for (const connection of connections.values()) connection.stop.abort();
    connections.clear();
    unpaired.clear();
  }
  if (address) remember(address);
  reach();
};

// Asks a server, which hands a bot's command to the one writing the bot; a
// screen is its computer's own.
export const call = async <K extends CommandName>(
  command: { type: K } & Commands[K]["args"],
) => {
  const connection =
    "hostId" in command
      ? connections.get(command.hostId)
      : [...connections.values()].find(({ info }) => info.server);
  if (!connection)
    throw new Error(
      "hostId" in command
        ? "That computer is offline."
        : "None of your OpenBots servers is online.",
    );
  return askAt<ResultOf<K>>(
    connection.address,
    code,
    "/call",
    command as Command,
  );
};

// What every screen reads, loaded from the servers. The whiteboard is an
// image a server draws.
export const store = createStore((key) => {
  const [kind, botId] = keyParts(key);
  return kind === "bots"
    ? call({ type: "bots.list" })
    : kind === "whiteboard"
      ? call({ botId, type: "whiteboard.image" })
      : call({ botId, type: "bot.get" });
});
export { botKey, botsKey };

const useEntry = <T>(key: string) => {
  const subscribe = useCallback(
    (listener: () => void) => store.watch(key, listener),
    [key],
  );
  return useSyncExternalStore(subscribe, () => store.get(key) as T | undefined);
};

// Every bot, oldest first; null until they are known.
export const useBots = () => useEntry<Bot[]>(botsKey) ?? null;

// A bot, with the server running it.
export const useBot = (botId: string) => {
  const { hosts } = useComputers();
  const bot = (useBots() ?? []).find((each) => each.id === botId) ?? null;
  const host = hosts.find((each) => each.id === bot?.server) ?? null;
  return { bot, host };
};

export const useBotDetail = (botId: string) =>
  useEntry<BotDetail | null>(botKey(botId));

export const useWhiteboardImage = (botId: string) =>
  useEntry<string | null>(whiteboardKey(botId));

// The newest message of each bot the user has seen, so the list marks what
// arrived while they were elsewhere.
const seenFile = new File(Paths.document, "seen.json");
let seen: Record<string, string> = (() => {
  try {
    return seenFile.exists
      ? (JSON.parse(seenFile.textSync()) as Record<string, string>)
      : {};
  } catch {
    return {};
  }
})();
const seenListeners = new Set<() => void>();
export const markSeen = (bot: Bot) => {
  if (!bot.last || seen[bot.id] === bot.last.id) return;
  seen = { ...seen, [bot.id]: bot.last.id };
  void seenFile.write(JSON.stringify(seen));
  for (const listener of seenListeners) listener();
};
export const useSeen = () =>
  useSyncExternalStore(
    (listener) => {
      seenListeners.add(listener);
      return () => seenListeners.delete(listener);
    },
    () => seen,
  );
