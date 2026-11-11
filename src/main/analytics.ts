import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { serializeError } from "@wrkrsh/client-log";
import { updates } from "@wrkrsh/electron-update";
import { app } from "electron";
import { PostHog } from "posthog-node";

// Which features OpenBots is used for and what fails, sent to the PostHog
// project every wrkrsh product reports to (docs/analytics.md in the
// monorepo), through openbots.ca, from released builds, unless the user turns
// it off in Settings. Events name an action or an error and how it ended,
// never messages, files, keys or what a model or tool gave. Each carries the
// feature flags on, so a failure can be compared with how many have a flag on.

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
      host: "https://openbots.ca/antenna",
    });
};

export const analyticsOn = () => on;

export const setAnalytics = async (next: boolean) => {
  on = next;
  await writeFile(file, JSON.stringify({ on }));
};

export const activeFlags = () => flags;

const properties = (extra?: Properties) => ({
  product: "openbots",
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

// What failed, redacted as client logs are (docs/diagnostics.md).
export const captureError = (
  scope: string,
  error: unknown,
  extra?: Properties,
) => {
  if (!client || !on) return;
  const safe = serializeError(error);
  client.captureException(
    Object.assign(new Error(safe.message), safe),
    distinctId,
    properties({ scope, ...extra }),
  );
};

// The window reports the flags on as it starts and whenever they change. Its
// first report of this launch means the app opened.
export const setFlags = (next: string[]) => {
  const opened = !flags;
  flags = next;
  if (opened) capture("app opened");
};

// An action the user took, by name, and whether it worked.
export const tracked = async <T>(action: string, run: () => T | Promise<T>) => {
  try {
    const result = await run();
    capture("action completed", { action, succeeded: true });
    return result;
  } catch (error) {
    capture("action completed", { action, succeeded: false });
    captureError("action", error, { action });
    throw error;
  }
};

// Sends what is left, as the app quits.
export const stopAnalytics = () => client?.shutdown();
