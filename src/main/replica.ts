import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import {
  lstat,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  rmdir,
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
// them back. A bot's own sealed file travels as what it holds, sealed again
// by each server's own keychain. Only regular files travel: a link is taken
// for a file removed.

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

// A bot's library goes before its own files, which refer to it, so a server
// that has a step of a run has the files that step made.
const byFolder = (a: string, b: string) =>
  Number(b.includes("/")) - Number(a.includes("/"));

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

// A bot's own sealed file, such as its webhooks' secrets; one in its library
// is the user's own file.
const sealed = (path: string) =>
  !path.includes("/") && path.endsWith(".sealed");

// A path in a bot's folder, every name in it a name.
const inFolder = (path: string) =>
  path !== versions &&
  path.split("/").every((name) => name && name !== "." && name !== "..");

type Info = { size: number; mtimeMs: number };

// A file or folder that is not there is null; failing to read one that is
// fails, so it is never taken for removed.
const absent = (error: NodeJS.ErrnoException) => {
  if (error.code === "ENOENT") return null;
  throw error;
};

// Removes a folder that holds only folders, and what no copy keeps (links,
// left as such, and scratch), deepest first, one at a time, so one that
// holds a file, even one made meanwhile, fails it.
const removeFolders = async (dir: string) => {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (skipped.has(entry.name))
      await rm(full, { force: true, recursive: true });
    else if (entry.isDirectory()) await removeFolders(full);
    else if (entry.isSymbolicLink() || entry.name.endsWith(".tmp"))
      await rm(full, { force: true });
  }
  await rmdir(dir);
};

// A file's bytes, not through a link put in its place.
const readOwn = (file: string) =>
  readFile(file, {
    flag: constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  }).catch(absent);

const sameVersion = (a: Version, b: Version) =>
  a[0] === b[0] && a[1] === b[1] && (a[2] ?? 0) === (b[2] ?? 0);

// Where a file that came for a path whose file here is too large to go is
// kept, beside it, named for the server it came from, and numbered after
// the first, so none is written over; its name cut short to fit the 255
// bytes file systems allow, with room for a write's ".tmp".
const beside = (path: string, by: string, copy = 1) => {
  const folder = path.slice(0, path.lastIndexOf("/") + 1);
  const name = path.slice(folder.length);
  const dot = name.lastIndexOf(".");
  let [stem, extension] =
    dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
  const mark = ` (from ${by.slice(0, 8)}${copy > 1 ? ` ${copy}` : ""})`;
  const room = () => Buffer.byteLength(`${stem}${mark}${extension}.tmp`);
  while (room() > 255 && stem) stem = [...stem].slice(0, -1).join("");
  while (room() > 255 && extension)
    extension = [...extension].slice(0, -1).join("");
  return `${folder}${stem}${mark}${extension}`;
};

export class Replica {
  private readonly manifests = new Map<string, Manifest>();
  // Each server's copies, sent in order.
  private readonly queues = new Map<string, Promise<unknown>>();
  // Each bot's changes, made in order.
  private readonly changes = new Map<string, Promise<unknown>>();
  // The servers a copy failed to reach, by the bots whose copies they
  // missed ("*" for all, as for a server back online), handed what they
  // missed later and sent no copy of those bots until then; and the bots
  // whose copies skipped or failed them meanwhile.
  private readonly behind = new Map<string, Set<string>>();
  private readonly missed = new Map<string, Set<string>>();
  // The servers this one could not catch up with yet.
  private readonly uncaught = new Set<string>();
  // The retry under way, which a later one waits for rather than repeats,
  // and each server's handing of what it missed, one at a time.
  private retrying: Promise<void> | null = null;
  private readonly handing = new Map<string, Promise<void>>();
  // How many times each server came back online, so a handing begun
  // before does not decide what it now waits for.
  private readonly meetings = new Map<string, number>();
  // This computer let its copies go: nothing changes them any more.
  private cleared = false;

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

  // Whether copies of a bot wait for a server to be handed what it missed.
  behindOn(hostId: string, botId: string) {
    const bots = this.behind.get(hostId);
    return Boolean(bots && (bots.has("*") || bots.has(botId)));
  }

  private note(noted: Map<string, Set<string>>, hostId: string, botId: string) {
    noted.set(hostId, new Set(noted.get(hostId)).add(botId));
  }

  private file(botId: string, path = "") {
    return join(this.options.dir, botId, ...path.split("/"));
  }

  async load() {
    this.cleared = false;
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

  // Whether a file stays here for its size, so a copy of it never goes.
  private async stays(botId: string, path: string) {
    const info = await lstat(this.file(botId, path)).catch(absent);
    return Boolean(info?.isFile() && info.size > largest);
  }

  // Whether a folder on the way to a file in a bot's folder is a link,
  // which nothing is read through.
  private async linked(botId: string, path: string) {
    const names = path.split("/").slice(0, -1);
    for (let at = 1; at <= names.length; at += 1) {
      const info = await lstat(
        this.file(botId, names.slice(0, at).join("/")),
      ).catch(absent);
      if (info && !info.isDirectory()) return true;
    }
    return false;
  }

  // A file's every path and stats under the bot's folders, by path; one
  // removed while it is looked at is left out, and one that cannot be
  // read fails the walk. Links, to folders too, are not followed.
  private async walk(botId: string, dirs: string[]) {
    const root = this.file(botId);
    const found = new Map<string, Info>();
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
          const info = await lstat(full).catch(absent);
          if (info?.isFile())
            found.set(relative(root, full).split(sep).join("/"), info);
        }
      }
    };
    for (const dir of dirs) {
      const info = await lstat(join(root, dir)).catch(absent);
      if (!dir || info?.isDirectory()) await walk(join(root, dir));
    }
    return found;
  }

  // Settles once the changes to a bot's folder asked for so far are made.
  settled(botId: string) {
    return (this.changes.get(botId) ?? Promise.resolve()).then(
      () => {},
      () => {},
    );
  }

  // Makes a change to a bot's folder once those before it are made, unless
  // this computer let its copies go meanwhile.
  private change<T>(botId: string, make: () => Promise<T>) {
    const made = (this.changes.get(botId) ?? Promise.resolve())
      .catch(() => {})
      .then(() => {
        if (this.cleared) throw new Error("This computer keeps no bots.");
        return make();
      });
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

  // Records a file's version as the file is now, or as a scan found it
  // (`found`, null when it found none); anything but a regular file counts
  // as removed.
  private async record(
    botId: string,
    path: string,
    v: Version,
    found?: Info | null,
  ) {
    const manifest = this.manifests.get(botId) ?? {};
    this.manifests.set(botId, manifest);
    const info =
      found === undefined
        ? await lstat(this.file(botId, path)).then(
            (stats) => (stats.isFile() ? stats : null),
            absent,
          )
        : found;
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
      const saved = await readOwn(file);
      return saved
        ? Buffer.from(JSON.stringify(await unseal(saved))).toString("base64")
        : null;
    }
    const info = await lstat(file).catch(absent);
    if (
      !info?.isFile() ||
      info.size > largest ||
      (await this.linked(botId, path))
    )
      return null;
    return (await readOwn(file))?.toString("base64") ?? null;
  }

  // On a file system that doesn't tell letters' case apart, a folder on
  // the way to a path named only in another case takes the path's case, so
  // what is here is spelled as it is on the server it came from.
  private async spell(botId: string, path: string) {
    const names = path.split("/").slice(0, -1);
    for (let at = 0; at < names.length; at += 1) {
      const parent = this.file(botId, names.slice(0, at).join("/"));
      const name = names[at]!;
      const here = await readdir(parent).catch(absent);
      if (!here || here.includes(name)) continue;
      const other = here.find(
        (each) => each.toLowerCase() === name.toLowerCase(),
      );
      // Only where that case is the same folder, not one of its own.
      if (other && (await lstat(join(parent, name)).catch(absent)))
        await rename(join(parent, other), join(parent, name));
    }
  }

  // Whether a path is here with every name in it spelled as given.
  private async spelled(botId: string, path: string) {
    const names = path.split("/");
    for (let at = 0; at < names.length; at += 1) {
      const here: string[] = await readdir(
        this.file(botId, names.slice(0, at).join("/")),
      ).catch(() => []);
      if (!here.includes(names[at]!)) return false;
    }
    return true;
  }

  private async put(botId: string, path: string, data: string | null) {
    const file = this.file(botId, path);
    if (data === null) {
      // Only the file at that very path, every name in it as spelled, not
      // one in another case that a file system not telling them apart
      // takes for it; a folder at its path now holds newer files, which
      // stay.
      if (
        (await this.spelled(botId, path)) &&
        !(await lstat(file).catch(absent))?.isDirectory()
      )
        await rm(file, { force: true });
      return;
    }
    await this.spell(botId, path);
    await mkdir(dirname(file), { recursive: true });
    const bytes = Buffer.from(data, "base64");
    if (sealed(path)) {
      await writeSealed(file, JSON.parse(bytes.toString()));
      return;
    }
    // Written beside it under a short name of its own, so a name near the
    // file system's limit still takes the ".tmp".
    const written = join(
      dirname(file),
      `.${randomBytes(6).toString("hex")}.tmp`,
    );
    try {
      await writeFile(written, bytes);
      // A folder the file took the place of goes once it holds no files,
      // only folders they left.
      if ((await lstat(file).catch(absent))?.isDirectory())
        await removeFolders(file);
      await rename(written, file);
    } finally {
      await rm(written, { force: true });
    }
  }

  // Sends a file as it was just written to every other server, settling
  // with whether each has it. Called while the change is made, so each
  // server gets the changes in the order they were made; one a copy of a
  // bot failed to reach gets none of that bot after it until it is handed
  // what it missed. The
  // file goes as it is when its turn comes, with the version it has then,
  // so at most one waits in memory for each server.
  private send(botId: string, path: string) {
    return Promise.all(
      this.options.servers().map((hostId) => {
        const sent = (this.queues.get(hostId) ?? Promise.resolve())
          .catch(() => {})
          .then(async () => {
            if (this.behindOn(hostId, botId)) {
              this.note(this.missed, hostId, botId);
              return false;
            }
            const copy = await this.copy(botId, path);
            // Not there to go, unless it stays for its size: handed later.
            // A bot's own file that stays reached no one.
            if (!copy) {
              if (!(await this.stays(botId, path)))
                throw new Error("That file isn't there to send.");
              return path.includes("/");
            }
            await this.options.send(hostId, copy);
            return true;
          })
          .catch(() => {
            this.note(this.behind, hostId, botId);
            this.note(this.missed, hostId, botId);
            return false;
          });
        this.queues.set(hostId, sent);
        return sent;
      }),
    ).then((reached) => reached.every(Boolean));
  }

  // A file written here, recorded as a new version of it, on its way to
  // the others.
  private async mine(
    botId: string,
    path: string,
    term?: number,
    found?: Info | null,
  ) {
    const v = this.next(botId, path, term);
    await this.record(botId, path, v, found);
    return { sent: this.send(botId, path) };
  }

  // Writes one of a bot's files, as JSON, this server being its writer:
  // the data `value` gives when the change is made, in its term, or nothing
  // when it gives nothing or the bot was deleted meanwhile. Settles with
  // whether it wrote, and whether every other server online has it.
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
    return sent === null
      ? { reached: false, wrote: false }
      : { reached: await sent, wrote: true };
  }

  // What changed in the bot's library and whiteboard since they were last
  // looked at here, sent on to the other servers, settling with how many
  // files did. A file grown too large to go keeps the version the others
  // have.
  async scan(botId: string) {
    const { changed, sent } = await this.change(botId, async () => {
      const manifest = this.manifests.get(botId) ?? {};
      if (manifest[deleted]) return { changed: 0, sent: null };
      const found = await this.walk(botId, scanned);
      // Removals first, so a file renamed only in its letters' case
      // isn't removed after its new name on a server that doesn't tell
      // them apart.
      const changed: string[] = [];
      for (const [path, entry] of Object.entries(manifest))
        if (
          !("gone" in entry) &&
          scanned.some((dir) => path.startsWith(`${dir}/`)) &&
          !found.has(path)
        )
          changed.push(path);
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
      const sending: Promise<unknown>[] = [];
      for (const path of changed)
        sending.push(
          (await this.mine(botId, path, undefined, found.get(path) ?? null))
            .sent,
        );
      return { changed: changed.length, sent: Promise.all(sending) };
    });
    await sent;
    return changed ?? 0;
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
    if (!inFolder(path)) throw new Error("That is not a bot's file.");
    // Nothing is written through a folder a link took the place of here: a
    // file's removal is only recorded, and its contents fail, so the server
    // sending it keeps its own.
    if (await this.linked(botId, path)) {
      if (data !== null)
        throw new Error(
          `A link takes the place of a folder of ${path} on this server.`,
        );
      await this.record(botId, path, v, null);
      return;
    }
    // A file here too large to go is its only copy: it stays, and counts
    // as the version sent, which goes beside it, so neither is lost.
    const here = await lstat(this.file(botId, path)).catch(absent);
    if (here?.isFile() && here.size > largest) {
      if (data !== null) {
        let kept = beside(path, v[1]);
        for (let copy = 2; ; copy += 1) {
          const taken =
            this.has(botId, kept) ||
            (await lstat(this.file(botId, kept)).catch(absent));
          if (!taken) break;
          kept = beside(path, v[1], copy);
        }
        await this.put(botId, kept, data);
        void (await this.mine(botId, kept)).sent;
      }
      await this.record(botId, path, v);
      return;
    }
    // What a write here lacks of an older one is kept, and sent back on:
    // the file here, never what a link in its place leads to.
    const older =
      data === null ||
      path.includes("/") ||
      !this.has(botId, path) ||
      !(await lstat(this.file(botId, path)).catch(absent))?.isFile()
        ? null
        : ((await readOwn(this.file(botId, path)))?.toString() ?? null);
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

  // Takes what another server has newer than here, each bot's library
  // before its own files. A file that could not be had leaves the rest to
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
            .map((path) => ({ botId, path, v: files[path]! }));
        })
        .sort((a, b) => byFolder(a.path, b.path));
      // A bot whose library did not all come takes none of its own files
      // this time, nor a file newer than the one listed, which may refer
      // to library files this pass did not take. A library file that
      // failed is tried once more after the rest, as one taking the place
      // of a folder whose files had not gone yet.
      const short = new Set<string>();
      const take = async ({ botId, path, v }: (typeof wanted)[number]) => {
        const copy = await this.options.fetch(hostId, botId, path);
        if (copy && !sameVersion(copy.v, v)) {
          this.uncaught.add(hostId);
          return false;
        }
        if (copy) await this.apply(copy);
        return true;
      };
      const again: typeof wanted = [];
      for (const each of wanted.filter(({ path }) => path.includes("/")))
        try {
          if (!(await take(each))) short.add(each.botId);
        } catch {
          again.push(each);
        }
      for (const each of again)
        try {
          if (!(await take(each))) short.add(each.botId);
        } catch (error) {
          failures.push(error);
          short.add(each.botId);
        }
      for (const each of wanted.filter(({ path }) => !path.includes("/")))
        try {
          if (!short.has(each.botId)) await take(each);
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

  // Sends another server what it has older than here, each bot's library
  // before its own files: what a copy failed to bring it, or every bot
  // before this computer lets its copies go. Settles with the bots it did
  // not send all it listed of, none when it did.
  async hand(hostId: string) {
    const theirs = await this.options.manifest(hostId);
    const older = [...this.manifests]
      .flatMap(([botId, manifest]) =>
        Object.entries(manifest)
          .filter(([path, entry]) => newer(entry.v, theirs[botId]?.[path]))
          .map(([path, entry]) => ({
            botId,
            gone: "gone" in entry,
            path,
            v: entry.v,
          })),
      )
      // Removals first, so a file or folder that took another's place
      // finds it gone.
      .sort(
        (a, b) => byFolder(a.path, b.path) || Number(b.gone) - Number(a.gone),
      );
    // A file written since the list was made waits for the next pass, as
    // it may refer to library files this one leaves out; a bot whose
    // library did not all go sends none of its own files this time.
    const short = new Set<string>();
    for (const { botId, path, v } of older)
      try {
        if (!path.includes("/") && short.has(botId)) continue;
        const copy = await this.copy(botId, path);
        // A file listed that is not there to go, unless it stays here for
        // its size, may come back as it was: it goes next pass.
        if (copy ? !sameVersion(copy.v, v) : !(await this.stays(botId, path))) {
          short.add(botId);
          continue;
        }
        if (copy) await this.options.send(hostId, copy);
      } catch {
        short.add(botId);
      }
    return short;
  }

  // Another server is online again, or for the first time: each takes
  // what the other wrote while they could not reach each other, this one
  // first, and hands it what it missed in the background. Copies made
  // meanwhile wait for the handing, so none overtakes what it missed.
  async meet(hostId: string) {
    this.meetings.set(hostId, (this.meetings.get(hostId) ?? 0) + 1);
    this.behind.set(hostId, new Set(["*"]));
    await this.catchUp(hostId);
    void this.handMissed(hostId);
  }

  // Hands a server behind what it missed, again, a few times at most,
  // while copies made meanwhile skip it or files change on the way, then
  // sends it copies again; else it is handed again next time. One handing
  // at a time per server, which alone lets copies of its bots go again,
  // those it handed all of.
  private handMissed(hostId: string) {
    let handing = this.handing.get(hostId);
    if (!handing) {
      handing = this.handMissedNow(hostId).finally(() =>
        this.handing.delete(hostId),
      );
      this.handing.set(hostId, handing);
    }
    return handing;
  }

  private async handMissedNow(hostId: string) {
    try {
      for (let pass = 0; pass < 5; pass += 1) {
        const meeting = this.meetings.get(hostId);
        this.missed.delete(hostId);
        const short = await this.hand(hostId);
        if (meeting !== this.meetings.get(hostId)) continue;
        for (const botId of this.missed.get(hostId) ?? []) short.add(botId);
        if (!short.size) {
          this.behind.delete(hostId);
          return;
        }
        this.behind.set(hostId, short);
      }
    } catch {
      // Handed again next time.
    }
  }

  // Tries again what failed: handing each server a copy failed to reach
  // what it missed, and catching up with those it could not.
  retry() {
    this.retrying ??= this.retryAll().finally(() => {
      this.retrying = null;
    });
    return this.retrying;
  }

  private async retryAll() {
    const online = new Set(this.options.servers());
    for (const hostId of [...this.behind.keys()])
      if (online.has(hostId)) await this.handMissed(hostId);
    for (const hostId of [...this.uncaught])
      if (online.has(hostId)) await this.catchUp(hostId);
  }

  // The files of the bots here too large to go to another server, their
  // own as well as their libraries', which stay only here, by their paths
  // on this computer.
  async large() {
    const found: string[] = [];
    for (const botId of this.ids())
      for (const [path, info] of await this.walk(botId, [""]))
        if (info.size > largest) found.push(this.file(botId, path));
    return found;
  }

  // This computer keeps no bots: once the changes already under way are
  // made, nothing changes its copies again, a copy still coming included.
  async clear() {
    this.cleared = true;
    await Promise.allSettled(this.changes.values());
    this.manifests.clear();
    this.changes.clear();
    this.behind.clear();
    this.missed.clear();
    this.uncaught.clear();
    await rm(this.options.dir, { force: true, recursive: true });
  }
}
