import type { Change } from "./types";

// What a window reads of the bots, cached for the window's life so moving
// between views never shows a reload. Each entry loads once it is first
// watched and again whenever a server says it changed. The desktop's window
// and the phone share it, each loading over its own way to the servers.

export const botsKey = "bots";
export const botKey = (botId: string) => `bot:${botId}`;
export const whiteboardKey = (botId: string) => `whiteboard:${botId}`;

// A key's kind and bot.
export const keyParts = (key: string) =>
  key.split(":") as ["bots" | "bot" | "whiteboard", string];

type Entry = {
  value: unknown;
  loaded: boolean;
  loading: boolean;
  again: boolean;
  listeners: Set<() => void>;
};

export const createStore = (load: (key: string) => Promise<unknown>) => {
  const entries = new Map<string, Entry>();

  const notify = (entry: Entry) => {
    for (const listener of entry.listeners) listener();
  };

  // Loads an entry again from the servers, such as after a change it showed
  // ahead of them failed.
  const refresh = (key: string) => {
    const entry = entries.get(key);
    if (!entry) return;
    if (entry.loading) {
      entry.again = true;
      return;
    }
    entry.loading = true;
    load(key)
      .then(
        (value) => {
          entry.value = value;
          entry.loaded = true;
        },
        (error: unknown) => console.error(`Loading ${key} failed:`, error),
      )
      .finally(() => {
        entry.loading = false;
        notify(entry);
        if (entry.again) {
          entry.again = false;
          refresh(key);
        }
      });
  };

  const watch = (key: string, listener: () => void) => {
    let entry = entries.get(key);
    if (!entry) {
      entry = {
        again: false,
        listeners: new Set(),
        loaded: false,
        loading: false,
        value: undefined,
      };
      entries.set(key, entry);
    }
    entry.listeners.add(listener);
    if (!entry.loaded && !entry.loading) refresh(key);
    return () => void entry.listeners.delete(listener);
  };

  const get = (key: string) => entries.get(key)?.value;

  // Changes a cached value at once, ahead of what the servers will say.
  const patch = <T>(key: string, change: (value: T) => T) => {
    const entry = entries.get(key);
    if (!entry?.loaded) return;
    entry.value = change(entry.value as T);
    notify(entry);
  };

  // A bot's whiteboard changing reloads only it; anything else of a bot's
  // reloads it and the list of bots, and of which there are, everything.
  const changed = ({ botId, whiteboard }: Change) => {
    if (!whiteboard) refresh(botsKey);
    for (const key of entries.keys()) {
      const [kind, bot] = keyParts(key);
      if (kind === "bots") continue;
      if (!botId || (bot === botId && (kind === "whiteboard") === !!whiteboard))
        refresh(key);
    }
  };

  return { changed, get, patch, refresh, watch };
};
