import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { redactText, serializeError } from "@wrkrsh/client-log";
import { updates } from "@wrkrsh/electron-update";
import { app } from "electron";
import { PostHog } from "posthog-node";

// Which features Multibots is used for and what fails, sent to the PostHog
// project every wrkrsh product reports to (docs/analytics.md in the
// monorepo), through multibots.ca, from released builds, unless the user turns
// it off in Settings. Events name an action or an error and how it ended,
// never messages, files, keys or what a model or tool gave. Each carries the
// feature flags on, so a failure can be compared with how many have a flag on.
// Each is sent as it happens, and only while the switch is on: what was not
// sent yet when it is turned off is dropped.

type Properties = Record<string, string | boolean>;

const os =
  { darwin: "macOS", linux: "Linux", win32: "Windows" }[
    process.platform as string
  ] ?? process.platform;

let client: PostHog | null = null;
let file = "";
// This computer's id among the user's: there is no account to name them by.
let distinctId = "";
let on = false;
// The feature flags on, by id, as this computer's window reports them;
// unknown until it first does.
let flags: string[] | undefined;

export const startAnalytics = async (home: string, computerId: string) => {
  file = join(home, "analytics.json");
  distinctId = computerId;
  on = await readFile(file, "utf8").then(
    (text) => (JSON.parse(text) as { on: boolean }).on,
    () => true,
  );
  if (app.isPackaged && app.getVersion() !== "0.0.0")
    client = new PostHog("phc_oFwEfJVgTTkyJDj6xCPSCb2bbSjb7suJYan9AyfJBqpr", {
      fetch: (url, options) =>
        on
          ? fetch(url, options as RequestInit)
          : Promise.resolve(new Response()),
      flushAt: 1,
      flushInterval: 0,
      host: "https://multibots.ca/antenna",
    });
};

export const analyticsOn = () => on;

export const setAnalytics = async (next: boolean) => {
  on = next;
  await writeFile(file, JSON.stringify({ on }));
};

export const activeFlags = () => flags;

const properties = (extra?: Properties) => ({
  product: "multibots",
  surface: "desktop",
  app_version: updates().version,
  channel: updates().channel(),
  $os: os,
  $process_person_profile: false,
  ...(flags && { flags }),
  ...extra,
});

export const capture = (event: string, extra?: Properties) => {
  if (client && on)
    client.capture({ distinctId, event, properties: properties(extra) });
};

// Where an error was thrown: the frames after the `name: message` its stack
// starts with, whose message can span lines that look like frames. None when
// the stack does not start so.
const framesOf = (error: unknown) => {
  const { name, message, stack } = Object(error) as Record<string, unknown>;
  const head = message ? `${String(name)}: ${String(message)}` : String(name);
  if (typeof stack !== "string" || !stack.startsWith(`${head}\n`)) return [];
  const lines = stack.slice(head.length + 1).split("\n");
  const end = lines.findIndex((line) => !/^\s+at /.test(line));
  return lines
    .slice(0, end < 0 ? undefined : end)
    .map((line) => redactText(line));
};

// What failed, as `msg` says, with the error's kind, code and where in
// Multibots it was thrown, never its message: a provider's error can quote
// what the user sent, as a validation error quotes its input.
export const captureError = (
  scope: string,
  msg: string,
  error?: unknown,
  extra?: Properties,
) => {
  if (!client || !on) return;
  const { name, code } =
    error === undefined ? { name: "Error" } : serializeError(error);
  const frames = framesOf(error);
  client.captureException(
    Object.assign(new Error(msg), {
      name,
      stack: [`${name}: ${msg}`, ...frames].join("\n"),
    }),
    distinctId,
    properties({
      scope,
      ...(code !== undefined && { code: String(code) }),
      ...extra,
    }),
  );
};

// The window reports the flags on as it starts and whenever they change. Its
// first report of this launch means the app opened.
export const setFlags = (next: string[]) => {
  const opened = !flags;
  flags = next;
  if (opened) capture("app opened");
};

// An action the user took, by name, and whether it worked: it threw, or
// gave what `failed` takes for a failure.
export const tracked = async <T>(
  action: string,
  run: () => T | Promise<T>,
  failed: (result: T) => boolean = () => false,
) => {
  let result: T;
  try {
    result = await run();
  } catch (error) {
    capture("action completed", { action, succeeded: false });
    captureError("action", `${action} failed.`, error, { action });
    throw error;
  }
  capture("action completed", { action, succeeded: !failed(result) });
  return result;
};
