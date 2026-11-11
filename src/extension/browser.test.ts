import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Writable } from "node:stream";
import { after, before, test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { Browser } from "../main/browser";
import { browserProtocol } from "../shared/browser";
import { botTools } from "../main/tools";
import { feedItems, members, serveFixtures } from "./fixtures";

// A bot's browser tool against a real Chrome, with the built extension
// loaded and the native messaging host set up as Multibots sets it up, in a
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

// Chrome's own protocol over its pipe, the only way to load an unpacked
// extension into it.
let next = 0;
const waiting = new Map<
  number,
  { done(value: unknown): void; fail(error: Error): void }
>();
const listen = () => {
  let buffer = "";
  chrome.stdio[4]!.on("data", (chunk: Buffer) => {
    buffer += chunk.toString();
    for (let end = buffer.indexOf("\0"); end >= 0; end = buffer.indexOf("\0")) {
      const message = JSON.parse(buffer.slice(0, end)) as {
        id?: number;
        result?: unknown;
        error?: { message: string };
      };
      buffer = buffer.slice(end + 1);
      const waiter = waiting.get(message.id ?? 0);
      waiting.delete(message.id ?? 0);
      if (message.error) waiter?.fail(new Error(message.error.message));
      else waiter?.done(message.result);
    }
  });
  chrome.once("exit", () => {
    for (const waiter of waiting.values())
      waiter.fail(new Error("Chrome exited."));
  });
};
const cdp = <T>(method: string, params: object = {}, sessionId?: string) =>
  new Promise<T>((done, fail) => {
    const id = ++next;
    waiting.set(id, { done: (value) => done(value as T), fail });
    setTimeout(
      () => fail(new Error(`${method} got no answer.`)),
      30_000,
    ).unref();
    (chrome.stdio[3] as Writable).write(
      `${JSON.stringify({ id, method, params, sessionId })}\0`,
    );
  });

// Allows the extension on the page it opens when installed, as a person
// would.
const allow = async () => {
  for (let waited = 0; ; waited += 100) {
    const { targetInfos } = await cdp<{
      targetInfos: { targetId: string; type: string; url: string }[];
    }>("Target.getTargets");
    const page = targetInfos.find(
      ({ type, url }) => type === "page" && url.endsWith("/popup.html"),
    );
    if (page) {
      const { sessionId } = await cdp<{ sessionId: string }>(
        "Target.attachToTarget",
        { flatten: true, targetId: page.targetId },
      );
      const clicked = await cdp<{ result: { value: boolean } }>(
        "Runtime.evaluate",
        {
          expression: `(() => { const allow = document.querySelector("#allow"); if (!allow || allow.closest("[hidden]")) return false; allow.click(); return true; })()`,
          returnByValue: true,
        },
        sessionId,
      );
      if (clicked.result.value) return;
    }
    if (waited > 20_000)
      throw new Error("The extension did not ask to be allowed.");
    await sleep(100);
  }
};

before(async () => {
  if (!existsSync(join(built, "browserHost.js")))
    throw new Error("Run `bun run build` first.");
  scratch = await mkdtemp(join(tmpdir(), "multibots-chrome-"));
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
  listen();
  await cdp("Extensions.loadUnpacked", { path: extension });
  // Nothing connects before it is allowed.
  await sleep(1000);
  assert.equal(browser.state().connected, false);
  await allow();
  for (let waited = 0; !browser.state().connected; waited += 100) {
    if (waited > 20_000) throw new Error("The extension did not connect.");
    await sleep(100);
  }
});

after(async () => {
  // Its profile is removed once it has exited.
  if (chrome && chrome.exitCode === null && chrome.signalCode === null) {
    const exited = once(chrome, "exit");
    chrome.kill();
    await exited;
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
  // Each row's own "Follow" and "Message", though the list moves their
  // nodes from row to row; the sticky header once; and nothing from
  // behind the dialog.
  assert.equal(count(lines, "Follow"), members);
  assert.equal(count(lines, "Message"), members);
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

test("an extension Chrome loaded before Multibots updated it reloads into this one", async () => {
  const { socket: path, token } = JSON.parse(
    await readFile(join(scratch, "home", "browser", "connection.json"), "utf8"),
  ) as { socket: string; token: string };
  const old = connect(path);
  old.write(
    `${JSON.stringify({ token })}\n${JSON.stringify({ hello: browserProtocol - 1 })}\n`,
  );
  const [reply] = (await once(old.setEncoding("utf8"), "data")) as [string];
  old.destroy();
  assert.deepEqual(JSON.parse(reply.split("\n")[0]!), { reload: true });
});
