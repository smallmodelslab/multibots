import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { filesUsed, type BoardElement, type BoardFile } from "./scene";

// A board's images' files in a folder, for apps that keep boards on disk:
// each `<id>.json`, its type and data URL.

const pathOf = (dir: string, id: string) => {
  if (!/^[\w-]{1,100}$/.test(id)) throw new Error("That is not an image's id.");
  return join(dir, `${id}.json`);
};

export const boardFileIds = async (dir: string) =>
  (await readdir(dir).catch(() => []))
    .filter((name) => name.endsWith(".json"))
    .map((name) => name.slice(0, -5));

export const readBoardFile = async (dir: string, id: string): Promise<BoardFile> => {
  const { mimeType, dataURL } = JSON.parse(await readFile(pathOf(dir, id), "utf8")) as {
    mimeType: string;
    dataURL: string;
  };
  return { id, mimeType, url: dataURL };
};

// Written whole and swapped in, so a crash never leaves half of it. An id is
// its image's content, so two writers of one id write the same file.
export const writeBoardFile = async (
  dir: string,
  { id, mimeType, dataURL }: { id: string; mimeType: string; dataURL: string },
) => {
  const path = pathOf(dir, id);
  const draft = `${path}.${randomUUID()}.tmp`;
  await mkdir(dir, { recursive: true });
  await writeFile(draft, JSON.stringify({ mimeType, dataURL }));
  await rename(draft, path);
};

// A file can arrive before the element showing it, so one no element uses
// is kept this long before it goes.
const keepUnusedMs = 10 * 60_000;

export const pruneBoardFiles = async (dir: string, elements: readonly BoardElement[]) => {
  const used = filesUsed(elements);
  for (const id of await boardFileIds(dir)) {
    if (used.has(id)) continue;
    const path = pathOf(dir, id);
    const info = await stat(path).catch(() => null);
    if (info && Date.now() - info.mtimeMs > keepUnusedMs) await rm(path, { force: true });
  }
};
