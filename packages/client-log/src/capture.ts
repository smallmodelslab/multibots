import {
  createLogId,
  DEBUG,
  ERROR,
  redactText,
  WARN,
  type ClientLogSink,
} from "./record.ts";

/**
 * The console as it was before capture. Loggers mirror through it so a
 * captured `console.error` cannot loop back into the log.
 */
export const rawConsole = {
  debug: console.debug.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
};

/** Text arguments only; objects are named, never dumped. */
function describeConsoleArgs(args: unknown[]): string {
  return redactText(
    args
      .map((arg) => {
        if (typeof arg === "string") return arg;
        if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
        if (arg === null || typeof arg !== "object") return String(arg);
        return `[${arg.constructor?.name || "object"}]`;
      })
      .join(" "),
  );
}

/**
 * Records every `console.warn` and `console.error`, then prints as before.
 * `ignore` sees each line as it would be recorded and skips the ones another
 * record already covers.
 */
export function captureConsole(
  log: ClientLogSink,
  ignore?: (text: string) => boolean,
): () => void {
  const original = { warn: console.warn, error: console.error };
  const wrap =
    (method: "warn" | "error") =>
    (...args: unknown[]): void => {
      rawConsole[method](...args);
      const text = describeConsoleArgs(args);
      if (ignore?.(text)) return;
      const error = args.find((arg) => arg instanceof Error);
      log(
        method === "warn" ? WARN : ERROR,
        "console",
        method === "warn" ? "Console warning." : "Console error.",
        { console: text, error },
      );
    };
  console.warn = wrap("warn");
  console.error = wrap("error");
  return () => {
    console.warn = original.warn;
    console.error = original.error;
  };
}

type FetchInput = Parameters<typeof fetch>[0];
/** The call alone: a runtime's own `fetch` may carry extras, such as Bun's `preconnect`. */
type Fetch = (input: FetchInput, init?: RequestInit) => Promise<Response>;
type FetchTarget = { fetch: Fetch };

export type FetchCaptureOptions = {
  /** Our own backends: requests to them carry the trace as `X-Request-Id`. */
  isTracedOrigin(origin: string): boolean;
  /** The trace of the operation in progress, if the runtime tracks one. */
  currentTrace?: () => string | undefined;
};

function requestUrl(input: FetchInput): URL | null {
  const raw =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
  try {
    return new URL(raw, globalThis.location?.href);
  } catch {
    return null;
  }
}

/**
 * Tags requests to our backends with `X-Request-Id` (the record's `trace`) and
 * logs failed HTTP calls with method, endpoint, status and duration. The
 * endpoint is the origin and path for our backends and only the origin for
 * anyone else. Request and response bodies are never read.
 */
export function captureFetch(
  target: FetchTarget,
  log: ClientLogSink,
  options: FetchCaptureOptions,
): () => void {
  const original = target.fetch;
  const instrumented: Fetch = async (input, init) => {
    const started = Date.now();
    const url = requestUrl(input);
    const method = (
      init?.method ?? (input instanceof Request ? input.method : "GET")
    ).toUpperCase();
    const isHttp = url?.protocol === "http:" || url?.protocol === "https:";
    // Only http(s) has an origin; data:, blob: and custom schemes report "null".
    const traced = isHttp && options.isTracedOrigin(url!.origin);
    // Other origins' paths can carry tokens and file names (signed asset URLs).
    const endpoint = traced
      ? `${url!.origin}${url!.pathname}`
      : isHttp
        ? url!.origin
        : url?.protocol;
    let trace: string | undefined;
    if (traced) {
      const headers = new Headers(
        init?.headers ?? (input instanceof Request ? input.headers : undefined),
      );
      trace =
        headers.get("x-request-id") ??
        options.currentTrace?.() ??
        createLogId();
      headers.set("x-request-id", trace);
      init = { ...init, headers };
    }
    try {
      const response = await original.call(target, input, init);
      if (!response.ok) {
        log(
          response.status >= 500 ? ERROR : WARN,
          "net",
          "Request failed.",
          {
            trace,
            method,
            endpoint,
            status: response.status,
            durationMs: Date.now() - started,
          },
        );
      }
      return response;
    } catch (error) {
      const aborted =
        (error as { name?: unknown } | null)?.name === "AbortError";
      log(
        aborted ? DEBUG : ERROR,
        "net",
        aborted ? "Request aborted." : "Request failed.",
        {
          trace,
          method,
          endpoint,
          durationMs: Date.now() - started,
          error: aborted ? undefined : error,
        },
      );
      throw error;
    }
  };
  target.fetch = instrumented;
  return () => {
    if (target.fetch === instrumented) target.fetch = original;
  };
}
