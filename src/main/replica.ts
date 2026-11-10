import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";

import { unseal, writeSealed } from "./sealed";

// Every server keeps a copy of every bot's folder (`bots/<id>`), so the bots
// outlive any server. One server writes a bot at a time (src/main/bots.ts),
// and sends each file it changes to the other servers at once, with its
// version: when it was written, and by which server. A copy takes a file
// only when it is newer than the one it has. Every change to a bot's
// folder, written here or sent from elsewhere, is made after the one before
// it, so each is compared with, written and recorded as that one left it.
// Two servers that meet, as when one was away, each take what the other has
// newer, by their versions. A file removed, and a bot
// deleted, are kept as versions too, so a copy that was away does not bring
// them back. A sealed file travels as what it holds, sealed again by each
// server's own keychain.

// When it was written, never before the version it replaced, and by which
// server; and for a bot's run state, its term: how many times a server
// was given the bot, which outranks the time, so a server that held the bot
// before cannot write over the one holding it now, however late it writes.
export type Version = [at: number, by: string, term?: number];
type Entry =
  | { v: Version; size: number; mtime: number }
  | { v: Version; gone: true };
// A bot's files, by their paths in its folder, with `/` between names.
type Manifest = Record<string, Entry>;
// What one server tells another it has: each bot's files' versions.
export type Manifests = Record<string, Record<string, Version>>;
// A file on its way to another server, base64, or null when removed.
export type Copy = {
  botId: string;
  path: string;
  v: Version;
  data: string | null;
};

const newer = (a: Version, than: Version | undefined) => {
  if (!than) return true;
  const terms = (a[2] ?? 0) - (than[2] ?? 0);
  if (terms) return terms > 0;
  return a[0] > than[0] || (a[0] === than[0] && a[1] > than[1]);
};

// A bot's own files, which say what it is, go before its library's.
const byFolder = (a: string, b: string) =>
  Number(a.includes("/")) - Number(b.includes("/"));

const versions = ".versions.json";
// What marks a deleted bot.
export const deleted = "deleted";
// The folders of a bot whose files change without a write here: its library,
// which its shell writes, and its whiteboard's images. Packages a shell
// installs are left out; they come again from where they came.
const scanned = ["files", "whiteboard"];
const skipped = new Set(["node_modules"]);
// Larger files stay on the server that has them.
const largest = 200 * 1024 * 1024;

const sealed = (path: string) => path.endsWith(".sealed");

// A file or folder that is not there is null; failing to read one that is
// fails, so it is never taken for removed.
const absent = (error: NodeJS.ErrnoException) => {
  if (error.code === "ENOENT") return null;
  throw error;
};

export class Replica {
  private readonly manifests = new Map<string, Manifest>();
  // Each server's copies, sent in order.
  private readonly queues = new Map<string, Promise<unknown>>();
  // Each bot's changes, made in order.
  private readonly changes = new Map<string, Promise<unknown>>();
  // The servers a copy failed to reach, handed what they missed later.
  private readonly behind = new Set<string>();
  // The servers this one could not catch up with yet.
  private readonly uncaught = new Set<string>();

  constructor(
    private readonly options: {
      dir: string;
      hostId: string;
      // The other servers online, by id.
      servers: () => string[];
      send: (hostId: string, copy: Copy) => Promise<void>;
      manifest: (hostId: string) => Promise<Manifests>;
      fetch: (
        hostId: string,
        botId: string,
        path: string,
      ) => Promise<Copy | null>;
      // A file another server wrote is here now: the change settles once
      // what it says is taken in.
      onApplied: (botId: string, path: string) => Promise<void>;
      // Catching up with another server failed, to be tried again.
      onBehind: (hostId: string, error: unknown) => void;
      // Two servers' versions of a file, each with what the other lacks,
      // as after servers that could not reach each other both wrote it:
      // what the two make together, or null when the newer has it all.
      merge: (path: string, older: string, newer: string) => string | null;
    },
  ) {}

  private file(botId: string, path = "") {
    return join(this.options.dir, botId, ...path.split("/"));
  }

  async load() {
    await mkdir(this.options.dir, { recursive: true });
    for (const botId of await readdir(this.options.dir)) {
      const saved = await readFile(this.file(botId, versions), "utf8").then(
        (text) => JSON.parse(text) as Manifest,
        () => null,
      );
      if (saved) {
        this.manifests.set(botId, saved);
        continue;
      }
      // A bot from before servers: each of its files as of when it was
      // last written.
      const manifest: Manifest = {};
      for (const [path, info] of await this.walk(botId, [""]))
        if (info.size <= largest)
          manifest[path] = {
            mtime: info.mtimeMs,
            size: info.size,
            v: [Math.floor(info.mtimeMs), this.options.hostId],
          };
      if (!manifest["bot.json"]) continue;
      this.manifests.set(botId, manifest);
      await this.saveManifest(botId);
    }
  }

  // The bots here, deleted ones left out.
  ids() {
    return [...this.manifests]
      .filter(([, manifest]) => manifest["bot.json"] && !manifest[deleted])
      .map(([id]) => id);
  }

  has(botId: string, path: string) {
    const entry = this.manifests.get(botId)?.[path];
    return Boolean(entry && !("gone" in entry));
  }

  // A file's every path and stats under the bot's folders, by path; one
  // removed while it is looked at is left out, and one that cannot be
  // read fails the walk.
  private async walk(botId: string, dirs: string[]) {
    const root = this.file(botId);
    const found = new Map<string, { size: number; mtimeMs: number }>();
    const walk = async (dir: string) => {
      for (const entry of (await readdir(dir, { withFileTypes: true }).catch(
        absent,
      )) ?? []) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!skipped.has(entry.name)) await walk(full);
        } else if (
          entry.isFile() &&
          entry.name !== versions &&
          !entry.name.endsWith(".tmp")
        ) {
          const info = await stat(full).catch(absent);
          if (info) found.set(relative(root, full).split(sep).join("/"), info);
        }
      }
    };
    for (const dir of dirs) await walk(join(root, dir));
    return found;
  }

  // Settles once the changes to a bot's folder asked for so far are made.
  settled(botId: string) {
    return (this.changes.get(botId) ?? Promise.resolve()).then(
      () => {},
      () => {},
    );
  }

  // Makes a change to a bot's folder once those before it are made.
  private change<T>(botId: string, make: () => Promise<T>) {
    const made = (this.changes.get(botId) ?? Promise.resolve())
      .catch(() => {})
      .then(make);
    this.changes.set(botId, made);
    return made;
  }

  private async saveManifest(botId: string) {
    const path = this.file(botId, versions);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(
      `${path}.tmp`,
      JSON.stringify(this.manifests.get(botId) ?? {}),
    );
    await rename(`${path}.tmp`, path);
  }

  // The next version of a file, after the one here, in its term.
  private next(botId: string, path: string, term = 0): Version {
    const before = this.manifests.get(botId)?.[path]?.v[0] ?? 0;
    const at = Math.max(Date.now(), before + 1);
    return term ? [at, this.options.hostId, term] : [at, this.options.hostId];
  }

  private async record(botId: string, path: string, v: Version) {
    const manifest = this.manifests.get(botId) ?? {};
    this.manifests.set(botId, manifest);
    const info = await stat(this.file(botId, path)).catch(absent);
    manifest[path] = info
      ? { mtime: info.mtimeMs, size: info.size, v }
      : { gone: true, v };
    await this.saveManifest(botId);
  }

  // A file as it travels, or null when it does not: too large, or gone
  // since it was recorded, which the next scan records. One that cannot be
  // read now fails, to be sent again later.
  private async encode(botId: string, path: string) {
    const file = this.file(botId, path);
    if (sealed(path)) {
      const saved = await readFile(file).catch(absent);
      return saved
        ? Buffer.from(JSON.stringify(await unseal(saved))).toString("base64")
        : null;
    }
    const info = await stat(file).catch(absent);
    if (!info || info.size > largest) return null;
    return (await readFile(file).catch(absent))?.toString("base64") ?? null;
  }

  private async put(botId: string, path: string, data: string | null) {
    const file = this.file(botId, path);
    if (data === null) {
      await rm(file, { force: true });
      return;
    }
    await mkdir(dirname(file), { recursive: true });
    const bytes = Buffer.from(data, "base64");
    if (sealed(path)) {
      await writeSealed(file, JSON.parse(bytes.toString()));
      return;
    }
    await writeFile(`${file}.tmp`, bytes);
    await rename(`${file}.tmp`, file);
  }

  // Sends a file as it was just written to every other server, settling
  // once each has it or could not be reached. Called while the change is
  // made, so each server gets the changes in the order they were made. The
  // file goes as it is when its turn comes, with the version it has then,
  // so at most one waits in memory for each server.
  private send(botId: string, path: string) {
    return Promise.all(
      this.options.servers().map((hostId) => {
        const sent = (this.queues.get(hostId) ?? Promise.resolve())
          .catch(() => {})
          .then(async () => {
            const copy = await this.copy(botId, path);
            if (copy) await this.options.send(hostId, copy);
          })
          .catch(() => {
            this.behind.add(hostId);
          });
        this.queues.set(hostId, sent);
        return sent;
      }),
    );
  }

  // A file written here, recorded as a new version of it, on its way to
  // the others.
  private async mine(botId: string, path: string, term?: number) {
    const v = this.next(botId, path, term);
    await this.record(botId, path, v);
    return { sent: this.send(botId, path) };
  }

  // Writes one of a bot's files, as JSON, this server being its writer:
  // the data `value` gives when the change is made, in its term, or nothing
  // when it gives nothing or the bot was deleted meanwhile. Settles with
  // whether it wrote.
  async write(
    botId: string,
    path: string,
    value: () => { data: unknown; term?: number } | undefined,
  ) {
    const { sent } = await this.change(botId, async () => {
      const made = value();
      if (made === undefined || this.manifests.get(botId)?.[deleted])
        return { sent: null };
      const file = this.file(botId, path);
      await mkdir(dirname(file), { recursive: true });
      if (sealed(path)) await writeSealed(file, made.data);
      else {
        await writeFile(`${file}.tmp`, JSON.stringify(made.data));
        await rename(`${file}.tmp`, file);
      }
      return this.mine(botId, path, made.term);
    });
    await sent;
    return sent !== null;
  }

  // What changed in the bot's library and whiteboard since they were last
  // looked at here, sent on to the other servers. A file grown too large
  // to go keeps the version the others have.
  async scan(botId: string) {
    const { sent } = await this.change(botId, async () => {
      const manifest = this.manifests.get(botId) ?? {};
      if (manifest[deleted]) return { sent: null };
      const found = await this.walk(botId, scanned);
      const changed: string[] = [];
      for (const [path, info] of found) {
        const entry = manifest[path];
        if (
          info.size <= largest &&
          (!entry ||
            "gone" in entry ||
            entry.size !== info.size ||
            entry.mtime !== info.mtimeMs)
        )
          changed.push(path);
      }
      for (const [path, entry] of Object.entries(manifest))
        if (
          !("gone" in entry) &&
          scanned.some((dir) => path.startsWith(`${dir}/`)) &&
          !found.has(path)
        )
          changed.push(path);
      const sending: Promise<unknown>[] = [];
      for (const path of changed)
        sending.push((await this.mine(botId, path)).sent);
      return { sent: Promise.all(sending) };
    });
    await sent;
  }

  // A deleted bot leaves only what marks it deleted.
  async delete(botId: string) {
    const { sent } = await this.change(botId, async () => {
      const v = this.next(botId, deleted);
      await rm(this.file(botId), { force: true, recursive: true });
      this.manifests.set(botId, { [deleted]: { gone: true, v } });
      await this.saveManifest(botId);
      return { sent: this.send(botId, deleted) };
    });
    await sent;
  }

  manifest(): Manifests {
    return Object.fromEntries(
      [...this.manifests].map(([botId, manifest]) => [
        botId,
        Object.fromEntries(
          Object.entries(manifest).map(([path, entry]) => [path, entry.v]),
        ),
      ]),
    );
  }

  // A file as it is here, with its version, read as a change is made so
  // the two are of the same moment: null when it does not go, which is not
  // its removal.
  copy(botId: string, path: string): Promise<Copy | null> {
    return this.change(botId, async () => {
      const entry = this.manifests.get(botId)?.[path];
      if (!entry) return null;
      if ("gone" in entry) return { botId, data: null, path, v: entry.v };
      const data = await this.encode(botId, path);
      return data === null ? null : { botId, data, path, v: entry.v };
    });
  }

  // A file another server sent, taken when it is newer than the one here.
  apply(copy: Copy) {
    return this.change(copy.botId, () => this.take(copy));
  }

  private async take({ botId, data, path, v }: Copy) {
    const manifest = this.manifests.get(botId);
    if (manifest?.[deleted] || !newer(v, manifest?.[path]?.v)) return;
    if (path === deleted) {
      await rm(this.file(botId), { force: true, recursive: true });
      this.manifests.set(botId, { [deleted]: { gone: true, v } });
      await this.saveManifest(botId);
      await this.options.onApplied(botId, path);
      return;
    }
    if (path.includes("..") || path.startsWith("/") || path === versions)
      throw new Error("That is not a bot's file.");
    // What a write here lacks of an older one is kept, and sent back on.
    const older =
      data === null || path.includes("/") || !this.has(botId, path)
        ? null
        : await readFile(this.file(botId, path), "utf8").catch(absent);
    const merged =
      older === null
        ? null
        : this.options.merge(
            path,
            older,
            Buffer.from(data!, "base64").toString(),
          );
    if (merged === null) {
      await this.put(botId, path, data);
      await this.record(botId, path, v);
    } else {
      const ours: Version = [
        Math.max(Date.now(), v[0] + 1),
        this.options.hostId,
      ];
      const both = Buffer.from(merged).toString("base64");
      await this.put(botId, path, both);
      await this.record(botId, path, ours);
      void this.send(botId, path);
    }
    await this.options.onApplied(botId, path);
  }

  // Takes what another server has newer than here, each bot's own files
  // before its library's. A file that could not be had leaves the rest to
  // be taken, and the server to catch up with again.
  async catchUp(hostId: string) {
    this.uncaught.delete(hostId);
    const failures: unknown[] = [];
    try {
      const theirs = await this.options.manifest(hostId);
      const wanted = Object.entries(theirs)
        .flatMap(([botId, files]) => {
          const ours = this.manifests.get(botId);
          if (ours?.[deleted]) return [];
          return (files[deleted] ? [deleted] : Object.keys(files))
            .filter((path) => newer(files[path]!, ours?.[path]?.v))
            .map((path) => ({ botId, path }));
        })
        .sort((a, b) => byFolder(a.path, b.path));
      for (const { botId, path } of wanted)
        try {
          const copy = await this.options.fetch(hostId, botId, path);
          if (copy) await this.apply(copy);
        } catch (error) {
          failures.push(error);
        }
    } catch (error) {
      failures.push(error);
    }
    if (!failures.length) return;
    this.uncaught.add(hostId);
    this.options.onBehind(hostId, failures[0]);
  }

  // Sends another server what it has older than here, each bot's own files
  // before its library's: what a copy failed to bring it, or every bot
  // before this computer lets its copies go.
  async hand(hostId: string) {
    const theirs = await this.options.manifest(hostId);
    const older = [...this.manifests]
      .flatMap(([botId, manifest]) =>
        Object.entries(manifest)
          .filter(([path, entry]) => newer(entry.v, theirs[botId]?.[path]))
          .map(([path]) => ({ botId, path })),
      )
      .sort((a, b) => byFolder(a.path, b.path));
    const failures: unknown[] = [];
    for (const { botId, path } of older)
      try {
        const copy = await this.copy(botId, path);
        if (copy) await this.options.send(hostId, copy);
      } catch (error) {
        failures.push(error);
      }
    if (failures.length) throw failures[0];
  }

  // Another server is online again, or for the first time: each takes
  // what the other wrote while they could not reach each other.
  async meet(hostId: string) {
    await this.catchUp(hostId);
    await this.hand(hostId).catch(() => {
      this.behind.add(hostId);
    });
  }

  // Tries again what failed: handing each server a copy failed to reach
  // what it missed, and catching up with those it could not.
  async retry() {
    const online = new Set(this.options.servers());
    for (const hostId of this.behind)
      if (online.has(hostId))
        await this.hand(hostId).then(
          () => this.behind.delete(hostId),
          () => {},
        );
    for (const hostId of this.uncaught)
      if (online.has(hostId)) await this.catchUp(hostId);
  }

  // This computer keeps no bots.
  async clear() {
    this.manifests.clear();
    await rm(this.options.dir, { force: true, recursive: true });
  }
}
