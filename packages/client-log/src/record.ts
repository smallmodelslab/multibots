/**
 * Client log records as defined in the monorepo's `docs/diagnostics.md`:
 * JSON Lines with `t`, `level`, `msg`, `scope`, `source`, `version` and
 * `session` on every record, plus fields each call site picks explicitly.
 */

/**
 * Severity from 0, the most severe, upwards. CRITICAL records are reported to
 * us as they happen; every other record stays on the device until someone
 * exports it.
 */
export const CRITICAL = 0;
export const ERROR = 1;
export const WARN = 2;
export const INFO = 3;
export const DEBUG = 4;

export type ClientLogLevel =
  | typeof CRITICAL
  | typeof ERROR
  | typeof WARN
  | typeof INFO
  | typeof DEBUG;

/** The console method that mirrors a record of this level. */
export function consoleMethod(
  level: ClientLogLevel,
): "error" | "warn" | "info" | "debug" {
  return level <= ERROR
    ? "error"
    : level === WARN
      ? "warn"
      : level === INFO
        ? "info"
        : "debug";
}

export type ClientLogFields = Record<string, unknown>;

/** Who wrote a record: stamped onto every record. */
export type ClientLogContext = {
  /** `main`, `renderer`, `service`, `sidecar` or `extension`, optionally `:module`. */
  source: string;
  /** Build version plus short commit, as `1.4.2+3f9c2ab`. */
  version: string;
  /** Random per launch. */
  session: string;
};

export type ClientLogRecord = {
  t: string;
  level: ClientLogLevel;
  msg: string;
  scope: string;
} & ClientLogContext &
  ClientLogFields;

export type ClientLogSink = (
  level: ClientLogLevel,
  scope: string,
  msg: string,
  fields?: ClientLogFields,
) => void;

export type SerializedError = {
  name: string;
  message: string;
  stack?: string;
  code?: string | number;
};

const SCOPE_PATTERN = /^[a-z0-9][a-z0-9._-]{0,47}$/i;
const RESERVED_KEYS = new Set([
  "t",
  "level",
  "msg",
  "scope",
  "source",
  "version",
  "session",
]);
const MAX_MSG_CHARS = 200;
const MAX_STRING_CHARS = 400;
const MAX_ERROR_MESSAGE_CHARS = 600;
const MAX_STACK_CHARS = 4000;
const MAX_ARRAY_ITEMS = 20;
const MAX_CAUSES = 4;

/**
 * Field names that hold secrets or user content. Call sites pick fields, so
 * this is a backstop: their values are dropped even if a call site passes them.
 */
const PRIVATE_KEY_PATTERN =
  /token|secret|passw|cookie|authorization|credential|api[-_]?key|private[-_]?key|^auth$|^headers?$|^(content|contents|text|body|bodies|prompt|prompts|message|messages|completion|response|request|payload|data|document|html|markdown|latex|input|output|value|values|selection|diff|patch|stdout|clipboard|email|query)$/i;

const REDACTIONS: Array<[RegExp, string]> = [
  // A Convex function error reads "[CONVEX M(path)] [Request ID: …] Server
  // Error …", and the rest can echo call arguments, so only the function and
  // request ID are kept, up to any stack frames. Where that prefix is gone,
  // the "Object:" and "Value:" lines on which validation errors quote the
  // arguments lose their values.
  [
    /(\[CONVEX [A-Z?]+\([^)\n]*\)\](?: \[Request ID: [^\]\n]+\])?)[\s\S]*?(?=\n +at |$)|((?:^|\n)[ \t]*(?:Object|Value):)[^\n]*/g,
    "$1$2",
  ],
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [redacted]"],
  [/\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}/g, "[jwt]"],
  [
    /\b(?:sk|pk|rk|ghp|gho|ghs|ghu|github_pat|xox[abpr])[-_][A-Za-z0-9_-]{12,}/g,
    "[key]",
  ],
  [
    /((?:token|secret|passw(?:or)?d|api[-_]?key|access[-_]?key|client[-_]?secret|signature|cookie)["']?\s*[=:]\s*["']?)[^\s"'&,;}]+/gi,
    "$1[redacted]",
  ],
  [/([?&](?:code|state|sig|session)=)[^\s"'&#]+/gi, "$1[redacted]"],
  [
    /\b(https?|wss?):\/\/([^\s/?#"'@]+@)?([^\s?#"']+)[?#][^\s"')]*/gi,
    "$1://$3?[redacted]",
  ],
  [/\b(https?|wss?):\/\/[^\s/?#"'@]+@/gi, "$1://[redacted]@"],
  [
    /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g,
    "[email]",
  ],
  [/(?:\/Users|\/home)\/[^/\s"']+/g, "~"],
  [/[A-Za-z]:\\Users\\[^\\\s"']+/gi, "~"],
];

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  const suffix = ` [+${value.length - maxChars} chars]`;
  return `${value.slice(0, Math.max(0, maxChars - suffix.length))}${suffix}`;
}

/** Strips credentials, URL queries, emails and home directories, then truncates. */
export function redactText(value: string, maxChars = MAX_STRING_CHARS): string {
  let result = value;
  for (const [pattern, replacement] of REDACTIONS) {
    result = result.replace(pattern, replacement);
  }
  return truncate(result, maxChars);
}

function readString(value: unknown, key: string): string | undefined {
  const field = (value as Record<string, unknown> | null)?.[key];
  return typeof field === "string" ? field : undefined;
}

function causeChainStack(error: unknown): string | undefined {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; current && depth <= MAX_CAUSES; depth += 1) {
    const stack =
      readString(current, "stack") ??
      (readString(current, "message") !== undefined
        ? `${readString(current, "name") ?? "Error"}: ${readString(current, "message")}`
        : typeof current === "string"
          ? current
          : undefined);
    if (stack) parts.push(depth === 0 ? stack : `Caused by: ${stack}`);
    const cause =
      typeof current === "object"
        ? (current as { cause?: unknown }).cause
        : undefined;
    current = cause === current ? undefined : cause;
  }
  return parts.length > 0
    ? redactText(parts.join("\n"), MAX_STACK_CHARS)
    : undefined;
}

/** `{name, message, stack}` with the stack covering the cause chain. */
export function serializeError(error: unknown): SerializedError {
  if (typeof error === "object" && error !== null) {
    const code = (error as { code?: unknown }).code;
    const stack = causeChainStack(error);
    return {
      name: redactText(readString(error, "name") || "Error", 80),
      message: redactText(
        readString(error, "message") ?? "",
        MAX_ERROR_MESSAGE_CHARS,
      ),
      ...(stack ? { stack } : {}),
      ...(typeof code === "string"
        ? { code: redactText(code, 80) }
        : typeof code === "number"
          ? { code }
          : {}),
    };
  }
  return {
    name: "Error",
    message: redactText(String(error), MAX_ERROR_MESSAGE_CHARS),
  };
}

function sanitizePrimitive(value: unknown): unknown {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number")
    return Number.isFinite(value) ? value : String(value);
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string") return redactText(value);
  return undefined;
}

/**
 * Keeps picked fields only: primitives, arrays of primitives, and `error`.
 * Nested objects are dropped, so a model passed whole cannot leak into logs.
 */
export function sanitizeLogFields(fields?: ClientLogFields): ClientLogFields {
  const safe: ClientLogFields = {};
  if (!fields) return safe;
  for (const [key, value] of Object.entries(fields)) {
    if (RESERVED_KEYS.has(key) || PRIVATE_KEY_PATTERN.test(key)) continue;
    if (value === undefined) continue;
    if (key === "error") {
      safe.error = serializeError(value);
      continue;
    }
    if (Array.isArray(value)) {
      const items = value
        .slice(0, MAX_ARRAY_ITEMS)
        .map(sanitizePrimitive)
        .filter((item) => item !== undefined);
      safe[key] =
        value.length > MAX_ARRAY_ITEMS
          ? [...items, `+${value.length - MAX_ARRAY_ITEMS} items`]
          : items;
      continue;
    }
    const primitive = sanitizePrimitive(value);
    if (primitive !== undefined) safe[key] = primitive;
  }
  return safe;
}

export function createLogRecord(
  context: ClientLogContext,
  level: ClientLogLevel,
  scope: string,
  msg: string,
  fields?: ClientLogFields,
  now: Date = new Date(),
): ClientLogRecord {
  return {
    t: now.toISOString(),
    level:
      Number.isInteger(level) && level >= CRITICAL && level <= DEBUG
        ? level
        : INFO,
    msg: redactText(msg, MAX_MSG_CHARS),
    scope: SCOPE_PATTERN.test(scope) ? scope : "app",
    source: context.source,
    version: context.version,
    session: context.session,
    ...sanitizeLogFields(fields),
  };
}

export function formatLogLine(record: ClientLogRecord): string {
  return `${JSON.stringify(record)}\n`;
}

/**
 * A random ID for one launch (`session`) or one operation (`trace`).
 * `randomUUID` exists only in secure contexts, so a page served over plain
 * http from another host gets 16 random bytes as hex instead. Hermes (Expo)
 * has no Web Crypto at all; an ID only has to be unique, not secret.
 */
export function createLogId(): string {
  const crypto = globalThis.crypto as Crypto | undefined;
  if (typeof crypto?.randomUUID === "function") return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (crypto) crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  let id = "";
  for (const byte of bytes) id += byte.toString(16).padStart(2, "0");
  return id;
}

/** `<product>-logs-<UTC timestamp>.<extension>`, safe on every file system. */
export function logExportFileName(
  product: string,
  now: Date = new Date(),
  extension = "jsonl",
): string {
  const stamp = now
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z")
    .replace(/:/g, "-");
  return `${product}-logs-${stamp}.${extension}`;
}
