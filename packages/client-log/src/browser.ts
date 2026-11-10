import {
  captureConsole,
  captureFetch,
  rawConsole,
  type FetchCaptureOptions,
} from "./capture.ts";
import {
  consoleMethod,
  createLogId,
  createLogRecord,
  ERROR,
  formatLogLine,
  INFO,
  logExportFileName,
  WARN,
  type ClientLogContext,
  type ClientLogFields,
  type ClientLogSink,
} from "./record.ts";
import type { CriticalReporter } from "./report.ts";

type LineStorage = Pick<Storage, "getItem" | "setItem">;

export type BrowserLogStoreOptions = {
  product: string;
  /** `version` is `<version>+<commit>`; `session` is generated per page load. */
  context: Omit<ClientLogContext, "session">;
  /** Defaults to `localStorage`, or memory where the browser blocks site data. */
  storage?: LineStorage;
  /** Fields for this session's start-up record. */
  startup: ClientLogFields;
  maxRecords?: number;
  maxChars?: number;
  /** Mirror records to the developer console. */
  mirror?: boolean;
  /** Sees every record of this page load and sends the critical ones. */
  report?: CriticalReporter;
};

/** `localStorage`, whose getter throws where the browser blocks site data. */
function siteStorage(): LineStorage {
  try {
    return localStorage;
  } catch {
    const items = new Map<string, string>();
    return {
      getItem: (key) => items.get(key) ?? null,
      setItem: (key, value) => void items.set(key, value),
    };
  }
}

export type BrowserLogStore = {
  log: ClientLogSink;
  session: string;
  /** The export file: this session's start-up record, then every kept record. */
  exportText(): string;
  exportFileName(now?: Date): string;
  flush(): void;
};

/**
 * A bounded JSON Lines buffer persisted in browser storage so records survive
 * reloads and crashes. Every flush appends this tab's new records to what is
 * stored, so open tabs share one log. The oldest records are dropped first.
 */
export function createBrowserLogStore(
  options: BrowserLogStoreOptions,
): BrowserLogStore {
  const storage = options.storage ?? siteStorage();
  const storageKey = `${options.product}:client-log`;
  const maxRecords = options.maxRecords ?? 3000;
  const maxChars = options.maxChars ?? 1_000_000;
  /** What storage held at the last flush, plus this tab's records since. */
  let lines: string[] = [];
  let unflushed: string[] = [];
  let flushTimer: ReturnType<typeof setTimeout> | null = null;

  const bounded = (all: string[]): string[] => {
    let chars = all.reduce((total, line) => total + line.length + 1, 0);
    let start = 0;
    while (
      all.length - start > maxRecords ||
      (chars > maxChars && all.length - start > 1)
    ) {
      chars -= (all[start]?.length ?? 0) + 1;
      start += 1;
    }
    return all.slice(start);
  };

  const flush = (): void => {
    if (flushTimer !== null) clearTimeout(flushTimer);
    flushTimer = null;
    try {
      const stored = (storage.getItem(storageKey) ?? "")
        .split("\n")
        .filter(Boolean);
      lines = bounded([...stored, ...unflushed]);
      unflushed = [];
      storage.setItem(storageKey, lines.join("\n"));
    } catch {
      // Storage full or unavailable; keep the records in memory for export.
      lines = bounded([...lines, ...unflushed]);
      unflushed = [];
    }
  };

  const context: ClientLogContext = {
    ...options.context,
    session: createLogId(),
  };
  const startup = createLogRecord(
    context,
    INFO,
    "app",
    "Session started.",
    options.startup,
  );
  const startupLine = formatLogLine(startup).trimEnd();
  options.report?.(startup);
  unflushed.push(startupLine);
  flush();

  const log: ClientLogSink = (level, scope, msg, fields) => {
    const record = createLogRecord(context, level, scope, msg, fields);
    if (options.mirror)
      rawConsole[consoleMethod(record.level)](
        `[${record.scope}] ${record.msg}`,
        fields ?? "",
      );
    options.report?.(record);
    unflushed.push(formatLogLine(record).trimEnd());
    // Errors are written soon in case the tab is about to die; bursts coalesce.
    flushTimer ??= setTimeout(flush, record.level <= ERROR ? 50 : 500);
  };

  return {
    log,
    session: context.session,
    exportText: () => {
      flush();
      return `${[startupLine, ...lines.filter((line) => line !== startupLine)].join("\n")}\n`;
    },
    exportFileName: (now) => logExportFileName(options.product, now),
    flush,
  };
}

/** Saves text through the browser's normal download flow. */
export function downloadTextFile(
  fileName: string,
  text: string,
  type: string,
): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // Safari still reads the URL well after click() returns.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export type BrowserCaptureOptions = FetchCaptureOptions & {
  /** Console lines, as they would be recorded, that another record already covers. */
  ignoreConsole?: (text: string) => boolean;
};

/**
 * Browser-side capture shared by the web app and the desktop renderer:
 * uncaught errors, unhandled rejections, console warnings and errors, failed
 * fetches and connectivity changes.
 */
export function installBrowserCapture(
  target: Window,
  log: ClientLogSink,
  options: BrowserCaptureOptions,
): () => void {
  const onError = (event: ErrorEvent): void => {
    log(ERROR, "app", "Uncaught exception.", {
      error: event.error ?? event.message,
      file: event.filename,
      line: event.lineno,
      column: event.colno,
    });
  };
  const onRejection = (event: PromiseRejectionEvent): void => {
    log(ERROR, "app", "Unhandled promise rejection.", {
      error: event.reason,
    });
  };
  const onOnline = (): void => log(INFO, "net", "Connection restored.");
  const onOffline = (): void => log(WARN, "net", "Connection lost.");
  target.addEventListener("error", onError);
  target.addEventListener("unhandledrejection", onRejection);
  target.addEventListener("online", onOnline);
  target.addEventListener("offline", onOffline);
  const restoreConsole = captureConsole(log, options.ignoreConsole);
  const restoreFetch = captureFetch(target, log, options);
  return () => {
    target.removeEventListener("error", onError);
    target.removeEventListener("unhandledrejection", onRejection);
    target.removeEventListener("online", onOnline);
    target.removeEventListener("offline", onOffline);
    restoreConsole();
    restoreFetch();
  };
}
