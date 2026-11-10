import { createCriticalReporter } from "./report.ts";
import {
  CRITICAL,
  createLogId,
  createLogRecord,
  type ClientLogFields,
} from "./record.ts";

/** A process about to exit waits this long for its report to leave. */
const EXIT_WAIT_MS = 5_000;

/**
 * Reports a Node service's critical errors to admin.wrkrsh.com as a client
 * reports its own (docs/diagnostics.md); its other logs stay with its host.
 * An uncaught exception is reported before the process exits on it, as it
 * would anyway. Returns the reporter for failures the service catches
 * itself, which settles once the report has left or after a few seconds.
 */
export function reportServiceFailures(
  product: string,
  context: { source: string; version: string },
): (scope: string, msg: string, fields?: ClientLogFields) => Promise<void> {
  const report = createCriticalReporter(product);
  const session = createLogId();
  const critical = (scope: string, msg: string, fields?: ClientLogFields) =>
    Promise.race([
      report(createLogRecord({ ...context, session }, CRITICAL, scope, msg, fields)),
      new Promise<void>((resolve) => setTimeout(resolve, EXIT_WAIT_MS).unref()),
    ]);
  process.once("uncaughtException", (error) => {
    console.error(error);
    void critical("app", "Uncaught exception.", { error }).finally(() => process.exit(1));
  });
  return critical;
}
