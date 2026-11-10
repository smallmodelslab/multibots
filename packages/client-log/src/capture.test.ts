import assert from "node:assert/strict";
import { test } from "node:test";
import { captureFetch } from "./capture.ts";

test("fetch capture traces our backends, keeps only other origins and passes other schemes through", async () => {
  const seen: Array<string | null> = [];
  const records: Array<Record<string, unknown> | undefined> = [];
  const target = {
    fetch: (async (_input: unknown, init?: RequestInit) => {
      seen.push(new Headers(init?.headers).get("x-request-id"));
      return new Response(null, { status: 503 });
    }) as typeof fetch,
  };
  captureFetch(target, (_level, _scope, _msg, fields) => records.push(fields), {
    isTracedOrigin: (origin) => new URL(origin).hostname === "turbotex.app",
  });

  await target.fetch("data:text/plain,hi");
  await target.fetch("https://turbotex.app/v0/chat?token=abc", {
    headers: { authorization: "Bearer x" },
  });
  await target.fetch("https://assets.example.com/t/secret-token/thesis.pdf");

  assert.equal(seen[0], null);
  assert.match(String(seen[1]), /^[0-9a-f-]{36}$/);
  assert.equal(records[1]?.trace, seen[1]);
  assert.equal(records[1]?.endpoint, "https://turbotex.app/v0/chat");
  assert.equal(records[1]?.status, 503);
  assert.equal(seen[2], null);
  assert.equal(records[2]?.endpoint, "https://assets.example.com");
});
