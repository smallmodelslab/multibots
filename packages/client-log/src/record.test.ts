import assert from "node:assert/strict";
import { test } from "node:test";
import { createLogRecord, ERROR, INFO, redactText } from "./record.ts";

const context = { source: "main", version: "1.4.2+3f9c2ab", session: "s1" };

test("records keep picked diagnostics but drop secrets, content and objects", () => {
  const privateText = "CONFIDENTIAL paper about Montréal";
  const cause = new Error("connect ECONNREFUSED to ada@example.com");
  const error = Object.assign(
    new Error(
      "fetch https://api.example.com/v1?key=abc failed in /Users/ada/paper",
      { cause },
    ),
    { code: "ENOSPC" },
  );
  const record = createLogRecord(
    context,
    ERROR,
    "compile",
    "Compile failed with Bearer abc.def.ghi",
    {
      session: "spoofed",
      token: "secret-token",
      authorization: "Bearer secret-token",
      prompt: privateText,
      messages: [privateText],
      stdout: privateText,
      project: { title: privateText, id: "p1" },
      endpoint: "https://turbotex.app/review?token=abc#frag",
      stderr: "texlab: reading /home/ada/thesis/main.tex",
      launchArgs: ["--log", 3, { nested: true }],
      jwt: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJlLXZhbHVl",
      durationMs: 812,
      ok: false,
      error,
    },
    new Date("2026-10-02T04:30:00.123Z"),
  );
  const { error: serialized, ...rest } = record;
  assert.deepEqual(rest, {
    t: "2026-10-02T04:30:00.123Z",
    level: ERROR,
    msg: "Compile failed with Bearer [redacted]",
    scope: "compile",
    ...context,
    endpoint: "https://turbotex.app/review?[redacted]",
    stderr: "texlab: reading ~/thesis/main.tex",
    launchArgs: ["--log", 3],
    jwt: "[jwt]",
    durationMs: 812,
    ok: false,
  });
  const { stack = "", ...errorFields } = serialized as Record<string, string>;
  assert.deepEqual(errorFields, {
    name: "Error",
    message: "fetch https://api.example.com/v1?[redacted] failed in ~/paper",
    code: "ENOSPC",
  });
  assert.match(
    stack,
    /^Error: fetch[\s\S]*Caused by: Error: connect ECONNREFUSED to \[email\]/,
  );
  assert.doesNotMatch(stack, /ada|key=abc/);
});

test("Convex errors keep the function and request ID but not the arguments they echo", () => {
  // As the Convex client throws and prints a failed call.
  const error = new Error(
    '[CONVEX M(keys/actions:create)] [Request ID: 8f2c1d3e4b5a6978] Server Error\nArgumentValidationError: Value does not match validator.\nPath: .name\nValue: "Acme merger plan"\nValidator: v.string()\n\n  Called by client',
  );
  const record = createLogRecord(
    context,
    ERROR,
    "convex",
    "Convex call failed.",
    {
      error,
      console:
        '[CONVEX A(decisions/run:run)] ConvexError {"input": "Acme merger plan"}',
    },
  );
  assert.equal(record.console, "[CONVEX A(decisions/run:run)]");
  const serialized = record.error as Record<string, string>;
  assert.equal(
    serialized.message,
    "[CONVEX M(keys/actions:create)] [Request ID: 8f2c1d3e4b5a6978]",
  );
  assert.match(
    serialized.stack ?? "",
    /^Error: \[CONVEX M\(keys\/actions:create\)\] \[Request ID: 8f2c1d3e4b5a6978\]\n +at /,
  );
  assert.doesNotMatch(JSON.stringify(record), /Acme/);
  // A validation error that lost its Convex prefix still drops the arguments.
  assert.equal(
    redactText(
      'ArgumentValidationError: Object is missing the required field `name`.\n\nObject: {title: "Acme merger plan"}\nValidator: v.object({name: v.string()})',
    ),
    "ArgumentValidationError: Object is missing the required field `name`.\n\nObject:\nValidator: v.object({name: v.string()})",
  );
});

test("malformed scopes and levels fall back and long strings are truncated", () => {
  const record = createLogRecord(
    context,
    9 as typeof ERROR,
    "private document title",
    "x".repeat(1000),
  );
  assert.equal(record.level, INFO);
  assert.equal(record.scope, "app");
  assert.equal(record.msg.length, 200);
});
