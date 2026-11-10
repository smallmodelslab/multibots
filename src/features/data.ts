import { useCallback, useSyncExternalStore } from "react";

import type {
  AppState,
  Bot,
  BotDetail,
  Bridge,
  Commands,
  CommandName,
  ResultOf,
} from "../shared/types";
import {
  botKey,
  botsKey,
  createStore,
  keyParts,
  whiteboardKey,
} from "../shared/store";

declare global {
  interface Window {
    openbots: Bridge;
  }
}

export const bridge = window.openbots;

// What went wrong, without what Electron says around it.
export const messageOf = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).replace(
    /^Error invoking remote method '[^']+': (Error: )?/,
    "",
  );

export const call = <K extends CommandName>(
  command: { type: K } & Commands[K]["args"],
) => bridge.call(command);

// What every view reads, loaded from the servers.
const store = createStore((key) => {
  const [kind, botId] = keyParts(key);
  return kind === "bots"
    ? call({ type: "bots.list" })
    : kind === "whiteboard"
      ? call({ botId, type: "whiteboard.get" })
      : call({ botId, type: "bot.get" });
});
export const { patch, refresh } = store;
export { botKey, botsKey };
bridge.onChange(store.changed);

const useEntry = <T>(key: string | null) => {
  const subscribe = useCallback(
    (listener: () => void) => (key ? store.watch(key, listener) : () => {}),
    [key],
  );
  return useSyncExternalStore(subscribe, () =>
    key ? (store.get(key) as T | undefined) : undefined,
  );
};

let state: AppState | null = null;
const stateListeners = new Set<() => void>();
// The servers online, by id: the bots are read anew whenever they change,
// such as when the first comes.
const serversOf = (hosts: AppState["hosts"] = []) =>
  hosts
    .filter((host) => host.server)
    .map((host) => host.id)
    .sort()
    .join(" ");
const setState = (next: AppState) => {
  const changed = serversOf(state?.hosts) !== serversOf(next.hosts);
  state = next;
  if (changed) store.changed({ botId: null });
  for (const listener of stateListeners) listener();
};
void bridge.state().then(setState);
bridge.onState(setState);

export const useAppState = () =>
  useSyncExternalStore(
    (listener) => {
      stateListeners.add(listener);
      return () => stateListeners.delete(listener);
    },
    () => state,
  );

// Every bot, oldest first; null until they are known.
export const useBots = () => useEntry<Bot[]>(botsKey) ?? null;

export const useBotDetail = (botId: string | null) =>
  useEntry<BotDetail | null>(botId ? botKey(botId) : null);

export const useWhiteboard = (botId: string) =>
  useEntry<ResultOf<"whiteboard.get">>(whiteboardKey(botId));
