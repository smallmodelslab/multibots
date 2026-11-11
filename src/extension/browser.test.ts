import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Writable } from "node:stream";
import { after, before, test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { Browser } from "../main/browser";
import { botTools } from "../main/tools";
import { feedItems, members, serveFixtures } from "./fixtures";

// A bot's browser tool against a real Chrome, with the built extension
// loaded and the native messaging host set up as OpenBots sets it up, in a
// profile of its own. Run `bun run build` first. CHROME names the browser
// when it is not Google Chrome where it usually is.

const built = fileURLToPath(new URL("../../out/main", import.meta.url));
const chromePath =
  process.env.CHROME ??
  (process.platform === "darwin"
    ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    : "google-chrome");

let scratch: string;
let chrome: ChildProcess;
let browser: Browser;
let fixtures: Awaited<ReturnType<typeof serveFixtures>>;
let folder: string;

// Loads an unpacked extension, which only a client on Chrome's pipe may.
const loadExtension = (path: string) =>
  new Promise<void>((done, fail) => {
    chrome.once("exit", () => fail(new Error("Chrome exited.")));
    setTimeout(
      () => fail(new Error("Chrome did not load the extension.")),
      30_000,
    ).unref();
    const output = chrome.stdio[4]!;
    let buffer = "";
    output.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      for (
        let end = buffer.indexOf("\0");
        end >= 0;
        end = buffer.indexOf("\0")
      ) {
        const message = JSON.parse(buffer.slice(0, end)) as {
          id?: number;
          error?: { message: string };
        };
        buffer = buffer.slice(end + 1);
        if (message.id !== 1) continue;
        if (message.error) fail(new Error(message.error.message));
        else done();
      }
    });
    (chrome.stdio[3] as Writable).write(
      `${JSON.stringify({ id: 1, method: "Extensions.loadUnpacked", params: { path } })}\0`,
    );
  });

before(async () => {
  if (!existsSync(join(built, "browserHost.js")))
    throw new Error("Run `bun run build` first.");
  scratch = await mkdtemp(join(tmpdir(), "openbots-chrome-"));
  folder = join(scratch, "files");
  const profile = join(scratch, "profile");
  fixtures = await serveFixtures();
  // Chrome looks for the user's native messaging hosts in its profile.
  browser = new Browser(join(scratch, "home"), built, () => {}, [
    join(profile, "NativeMessagingHosts"),
  ]);
  const extension = await browser.setUp();
  await browser.start();
  chrome = spawn(
    chromePath,
    [
      "--remote-debugging-pipe",
      "--enable-unsafe-extension-debugging",
      `--user-data-dir=${profile}`,
      "--headless=new",
      "--no-first-run",
      "--no-default-browser-check",
      "--window-size=1200,900",
      // CI's Linux may not let Chromium sandbox itself, as Playwright's
      // runs assume too; the pages are the test's own.
      ...(process.platform === "linux" ? ["--no-sandbox"] : []),
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] },
  );
  await loadExtension(extension);
  for (let waited = 0; !browser.state().connected; waited += 100) {
    if (waited > 20_000) throw new Error("The extension did not connect.");
    await sleep(100);
  }
});

after(async () => {
  // Its profile is removed once it has exited.
  if (chrome?.exitCode === null) {
    chrome.kill();
    await once(chrome, "exit");
  }
  fixtures?.stop();
  await browser?.close();
  await rm(scratch, { force: true, recursive: true });
});

const toolsOf = (bot: string) =>
  botTools({
    browser: { bot, name: `Bot ${bot}`, onUse: () => {}, send: browser.send },
    folder,
    here: "this computer",
    onCommand: () => {},
    onRoutines: async () => {},
    others: [],
    reads: false,
    repls: () => {
      throw new Error("No screen here.");
    },
    routines: () => [],
    screen: false,
    whiteboard: {
      edit: async () => ({ added: [], text: "" }),
      view: async () => ({ image: null, text: "" }),
    },
  });

type Input = Parameters<
  NonNullable<ReturnType<typeof toolsOf>["browser"]>["execute"]
>[0];
const use = (bot: string, input: Partial<Input>) =>
  toolsOf(bot).browser!.execute!(input as Input, {
    context: {},
    messages: [],
    toolCallId: "test",
  }) as Promise<{ text: string; images: string[] }>;

const tabOf = (text: string) => Number(/^Tab (\d+)/.exec(text)![1]);
// The ref of the outline's line that has the text.
const refOf = (outline: string, text: string) => {
  const line = outline.split("\n").find((each) => each.includes(text));
  if (!line) throw new Error(`No "${text}" in:\n${outline}`);
  return Number(/\[(\d+)\]/.exec(line)![1]);
};

test("a bot reads a form, fills it in and sees what it did", async () => {
  const opened = await use("a", {
    action: "open",
    url: `${fixtures.url}form`,
  });
  assert.match(opened.text, /Greeter/);
  const tab = tabOf(opened.text);
  const { text: outline } = await use("a", { action: "snapshot", tab });
  assert.match(outline, /textbox "Name" = "someone"/);
  await use("a", {
    action: "type",
    ref: refOf(outline, 'textbox "Name"'),
    tab,
    text: "Ada",
  });
  await use("a", {
    action: "click",
    ref: refOf(outline, 'button "Greet"'),
    tab,
  });
  const done = await use("a", { action: "snapshot", tab });
  assert.match(done.text, /text "Hello, Ada!"/);
  // What an iframe holds is in the snapshot, and acts by its refs too.
  await use("a", {
    action: "click",
    ref: refOf(done.text, 'button "Inside"'),
    tab,
  });
  assert.match(
    (await use("a", { action: "snapshot", tab })).text,
    /text "Clicked inside"/,
  );
  const shot = await use("a", { action: "screenshot", tab });
  assert.equal(shot.images.length, 1);
  assert.equal(
    Buffer.from(shot.images[0]!, "base64").subarray(1, 4).toString(),
    "PNG",
  );
  assert.match(
    (await use("a", { action: "tabs" })).text,
    new RegExp(`Tab ${tab}:`),
  );
  // Another bot's tabs are out of reach, as are the user's.
  await assert.rejects(
    use("b", { action: "snapshot", tab }),
    /is not one of yours/,
  );
  assert.equal(
    (await use("b", { action: "tabs" })).text,
    "You have no tabs open.",
  );
  await use("a", { action: "close", tab });
  assert.equal(
    (await use("a", { action: "tabs" })).text,
    "You have no tabs open.",
  );
});

const linesOf = (text: string) => text.split("\n");
const count = (lines: string[], line: string) =>
  lines.filter((each) => each === line).length;

test("scroll_capture reads a long virtualized list inside a dialog whole, each row once", async () => {
  const tab = tabOf(
    (await use("a", { action: "open", url: `${fixtures.url}members` })).text,
  );
  const { text: outline } = await use("a", { action: "snapshot", tab });
  const read = await use("a", {
    action: "scroll_capture",
    maxSteps: 300,
    // The dialog, whose list scrolls inside it.
    ref: refOf(outline, 'dialog "Members"'),
    tab,
  });
  assert.match(read.text, /reached the end/);
  const lines = linesOf(read.text);
  for (let index = 1; index <= members; index++) {
    const n = String(index).padStart(4, "0");
    assert.equal(count(lines, `Member ${n} @member${n}`), 1, `Member ${n}`);
  }
  // Each row's own "Follow", though the list moves its node from row to
  // row; the sticky header once; and nothing from behind the dialog.
  assert.equal(count(lines, "Follow"), members);
  assert.equal(count(lines, "Members"), 1);
  assert.doesNotMatch(read.text, /Behind the dialog/);
  assert.ok(read.images.length > 0);
  const saved = await readdir(join(folder, "captures"));
  assert.ok(saved.some((name) => name.endsWith(".txt")));
  assert.ok(saved.filter((name) => name.endsWith(".png")).length > 1);
});

test("scroll_capture waits for a page that loads more at its end, and what loads above moves nothing twice", async () => {
  const tab = tabOf(
    (await use("a", { action: "open", url: `${fixtures.url}feed` })).text,
  );
  const read = await use("a", { action: "scroll_capture", tab });
  assert.match(read.text, /reached the end/);
  const lines = linesOf(read.text);
  for (let index = 1; index <= feedItems; index++)
    assert.equal(count(lines, `Post number ${index}`), 1, `Post ${index}`);
  assert.equal(count(lines, "End of feed"), 1);
});
