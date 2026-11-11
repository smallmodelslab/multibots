import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

import {
  createLogRecord,
  ERROR,
  formatLogLine,
  type ClientLogFields,
} from "@wrkrsh/client-log";
import { updates } from "@wrkrsh/electron-update";
import { app } from "electron";

import { activeFlags, captureError } from "./analytics";

// An error the app recovers from, in OpenBots' log, the launcher's
// openbots.jsonl in the platform's log folder, in its session
// (docs/diagnostics.md in the monorepo), and in analytics. Fields name
// things, never secrets.
export const logError = (
  scope: string,
  msg: string,
  fields?: ClientLogFields,
) => {
  const { session, version } = updates();
  const line = formatLogLine(
    createLogRecord(
      { flags: activeFlags(), session, source: "main", version },
      ERROR,
      scope,
      msg,
      fields,
    ),
  );
  process.stderr.write(line);
  const folder = app.getPath("logs");
  void mkdir(folder, { recursive: true })
    .then(() => appendFile(join(folder, "openbots.jsonl"), line))
    .catch(() => {});
  captureError(scope, msg, fields?.error);
};
