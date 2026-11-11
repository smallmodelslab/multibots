// Feature flags for apps released on stable and nightly channels. A feature in
// progress ships in every build behind a flag that is on in the channels it
// lists, and anyone can turn it on or off on the app's Flags page. Once the
// feature is on in stable, delete its flag and the code path the flag hid.

export type Channel = "stable" | "nightly";

export type Flag = {
  name: string;
  description: string;
  // Where it is on until someone sets it: ["nightly"] while nightly tries it,
  // [] while only people who turn it on see it.
  on: readonly Channel[];
};

// "default" follows the channel.
export type Setting = "default" | "on" | "off";

export type Flags<Id extends string> = {
  readonly definitions: Readonly<Record<Id, Flag>>;
  // The channel the app follows, which picks each flag's default.
  channel(): Channel;
  setChannel(channel: Channel): void;
  enabled(id: Id): boolean;
  setting(id: Id): Setting;
  // The flags on, by id and sorted, as client logs record them.
  active(): Id[];
  set(id: Id, setting: Setting): void;
  // Calls `listener` after every change, from this window or another.
  subscribe(listener: () => void): () => void;
};

// Settings persist in localStorage under `key`; a flag that is no longer
// defined is dropped on the next change.
export function createFlags<Id extends string>(
  key: string,
  definitions: Record<Id, Flag>,
  channel: Channel = "stable",
): Flags<Id> {
  const listeners = new Set<() => void>();
  const read = (): Record<string, unknown> => {
    try {
      const value: unknown = JSON.parse(localStorage.getItem(key) ?? "{}");
      return value && typeof value === "object"
        ? (value as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  };
  let settings = read();
  const changed = () => {
    for (const listener of listeners) listener();
  };
  window.addEventListener("storage", (event) => {
    if (event.key !== key) return;
    settings = read();
    changed();
  });
  const setting = (id: Id): Setting =>
    typeof settings[id] === "boolean"
      ? settings[id]
        ? "on"
        : "off"
      : "default";
  const enabled = (id: Id): boolean =>
    setting(id) === "default"
      ? definitions[id].on.includes(channel)
      : setting(id) === "on";

  return {
    definitions,
    channel: () => channel,
    setChannel(next) {
      if (next === channel) return;
      channel = next;
      changed();
    },
    enabled,
    setting,
    active: () => (Object.keys(definitions) as Id[]).filter(enabled).sort(),
    set(id, value) {
      const next = Object.fromEntries(
        Object.entries(settings).filter(
          ([flag, on]) =>
            flag !== id && flag in definitions && typeof on === "boolean",
        ),
      );
      if (value !== "default") next[id] = value === "on";
      settings = next;
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // The setting lasts until the app closes.
      }
      changed();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
