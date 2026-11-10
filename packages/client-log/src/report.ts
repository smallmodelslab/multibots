import { CRITICAL, formatLogLine, type ClientLogRecord } from "./record.ts";

/** admin.wrkrsh.com's report endpoint, outside Cloudflare Access. */
export const REPORT_ENDPOINT = "https://logs.wrkrsh.com/v1/reports";

/** Records of the session sent ahead of the critical one. */
const CONTEXT_RECORDS = 50;
/** `sendBeacon` and keepalive requests refuse bodies over 64 KiB. */
const MAX_BODY_BYTES = 60_000;
const MAX_REPORTS_PER_SESSION = 10;

/**
 * Sees every record of a session. When it reports one, it returns the send, so
 * a process about to end (a fatal error on mobile) can wait for it to leave.
 */
export type CriticalReporter = (record: ClientLogRecord) => Promise<void> | undefined;

/** Fetch before any capture wraps it, so a failed report is not logged as a failed request. */
const rawFetch = typeof fetch === "function" ? fetch.bind(globalThis) : undefined;
const encoder = new TextEncoder();

/**
 * One key per error, as admin.wrkrsh.com groups them: scope, message and
 * error, with every word holding a digit (ids, counts) masked in the message.
 */
function errorKey(record: ClientLogRecord): string {
  const error = record.error as { name?: unknown; message?: unknown } | undefined;
  const message = String(error?.message ?? "").replace(/[\w-]+/g, (word) => (/\d/.test(word) ? "#" : word));
  return [record.scope, record.msg, String(error?.name ?? ""), message].join("\n");
}

/**
 * Watches every record of one session and sends each CRITICAL one, after the
 * records that led up to it, to admin.wrkrsh.com as JSON Lines. Each error
 * is sent once and a session sends at most ten, so a crash loop cannot
 * flood the endpoint. A failed send is dropped: reporting must never fail the
 * app or log about itself.
 */
export function createCriticalReporter(
  product: string,
  endpoint = REPORT_ENDPOINT,
): CriticalReporter {
  // Records are kept as they are and serialized only for a report.
  const recent: ClientLogRecord[] = [];
  const sent = new Set<string>();
  const url = `${endpoint}?product=${encodeURIComponent(product)}`;
  return (record) => {
    let sending: Promise<void> | undefined;
    if (record.level <= CRITICAL) {
      const key = errorKey(record);
      if (!sent.has(key) && sent.size < MAX_REPORTS_PER_SESSION) {
        sent.add(key);
        const lines = [...recent, record].map(formatLogLine);
        const sizes = lines.map((line) => encoder.encode(line).byteLength);
        let bytes = sizes.reduce((total, size) => total + size, 0);
        while (bytes > MAX_BODY_BYTES && lines.length > 1) {
          lines.shift();
          bytes -= sizes.shift()!;
        }
        sending = send(url, lines.join(""));
      }
    }
    recent.push(record);
    if (recent.length > CONTEXT_RECORDS) recent.shift();
    return sending;
  };
}

/** Settles once the report has left or failed; it never rejects. */
async function send(url: string, body: string): Promise<void> {
  try {
    // A beacon outlives a closing page; elsewhere fetch carries the report.
    if (typeof navigator !== "undefined" && navigator.sendBeacon?.(url, body)) return;
    await rawFetch?.(url, {
      method: "POST",
      body,
      keepalive: true,
      headers: { "content-type": "text/plain" },
    });
  } catch {
    // Offline, or no network API in this runtime.
  }
}
