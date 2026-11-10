import { DurableObject } from "cloudflare:workers";
import { check, isSender, type Sender } from "@wrkrsh/webhooks";

// Webhooks for OpenBots, which has no server: a sender POSTs to a webhook's
// URL here, and the relay holds each request until the computer whose bot it
// wakes takes it over a WebSocket, so none is lost while that computer
// sleeps. There are no accounts. Each webhook is a Durable Object named by
// its id, the first half of the SHA-256 of a secret only its computer holds,
// so only that computer registers it, listens to it and deletes it. The
// relay keeps which sender calls it and the secret that sender proves itself
// with (@wrkrsh/webhooks), so it answers a sender's own checks itself.
//
// POST /<id>    A sender's request, with a body of at most 64 KiB: 202 once
//               held; 200 with the answer to a sender's check (Slack's URL
//               challenge, GitHub's ping); 401 when it is not the sender's
//               or the sender's secret is not given yet; 404 for no such
//               webhook; 413 for a larger body; and 429 past 30 a minute or
//               when 100 requests or 1 MiB are held.
// GET /<id>     A WebSocket, with Authorization: Bearer <secret>, X-Sender
//               and, once it is known, X-Secret: the sender's secret. It
//               registers the webhook, or changes its sender, then sends
//               each request held as {"id", "at", "body"}, oldest first, and
//               each new one as it comes; each stays held until the computer
//               answers {"ack": id}, for 7 days at most. "ping" is answered
//               "pong". A new listener replaces the one before.
// DELETE /<id>  Authorization: Bearer <secret>: 204, the webhook and what it
//               held forgotten.
//
// Listening and deleting answer 429 past 60 a minute from one address. A
// POST is limited only per webhook, as senders such as GitHub, Stripe and
// Slack post for all their customers from shared addresses.
//
// A webhook nothing listened to for 30 days is forgotten too, and registered
// again when its computer next listens.

type Env = {
  HOOKS: DurableObjectNamespace<Hook>;
  // Listens and deletes a minute from one address, which bounds how fast it
  // makes webhooks and wakes their objects to forget them.
  COMPUTERS: RateLimit;
  // Requests a minute to one webhook, refused before its object wakes.
  POSTS: RateLimit;
};

// Who calls a webhook, and their secret, null until the user gives it.
type Registered = { sender: Sender; secret: string | null };

const bodyLimit = 64 * 1024;
const heldLimit = 100;
const heldBytes = 1024 * 1024;
const holdMs = 7 * 24 * 60 * 60_000;
const idleMs = 30 * 24 * 60 * 60_000;

const sha256 = async (text: string) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
    ),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");

const answer = (status: number, text?: string) =>
  new Response(text ?? null, {
    headers: text === undefined ? {} : { "content-type": "text/plain" },
    status,
  });

// The body as text, or null once it passes the limit, read no further.
const readBody = async (request: Request) => {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of request.body ?? new ReadableStream()) {
    size += chunk.byteLength;
    if (size > bodyLimit) return null;
    chunks.push(chunk);
  }
  return new Blob(chunks).text();
};

export class Hook extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair("ping", "pong"),
    );
  }

  // What has waited past its time is let go.
  private expire() {
    this.ctx.storage.sql.exec(
      "DELETE FROM requests WHERE at < ?",
      Date.now() - holdMs,
    );
  }

  // A sender's request, its headers as entries.
  async post(
    headers: [string, string][],
    body: string,
  ): Promise<{ status: number; text?: string }> {
    const registered = await this.ctx.storage.get<Registered>("registered");
    if (!registered) return { status: 404 };
    const checked = await check(
      registered.sender,
      registered.secret,
      new Headers(headers),
      body,
    );
    if (checked === "refuse") return { status: 401 };
    if (checked !== "take") return { status: 200, text: checked.answer };
    const { sql } = this.ctx.storage;
    this.expire();
    const { bytes, held } = sql
      .exec<{ bytes: number; held: number }>(
        "SELECT count(*) AS held, coalesce(sum(length(CAST(body AS BLOB))), 0) AS bytes FROM requests",
      )
      .one();
    if (
      held >= heldLimit ||
      bytes + new TextEncoder().encode(body).byteLength > heldBytes
    )
      return { status: 429 };
    const at = Date.now();
    const { id } = sql
      .exec<{
        id: number;
      }>("INSERT INTO requests (at, body) VALUES (?, ?) RETURNING id", at, body)
      .one();
    const request = JSON.stringify({ at, body, id });
    for (const socket of this.ctx.getWebSockets()) socket.send(request);
    return { status: 202 };
  }

  // A listener, whose secret the Worker checked; it brings the sender and
  // the sender's secret.
  override async fetch(request: Request) {
    const { sql } = this.ctx.storage;
    sql.exec(
      "CREATE TABLE IF NOT EXISTS requests (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, body TEXT NOT NULL)",
    );
    await this.ctx.storage.put("registered", {
      secret: request.headers.get("x-secret"),
      sender: request.headers.get("x-sender") as Sender,
    } satisfies Registered);
    for (const socket of this.ctx.getWebSockets())
      socket.close(1000, "Another listener took over.");
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    this.expire();
    for (const held of sql.exec(
      "SELECT id, at, body FROM requests ORDER BY id",
    ))
      server.send(JSON.stringify(held));
    await this.ctx.storage.setAlarm(Date.now() + idleMs);
    return new Response(null, { status: 101, webSocket: client });
  }

  override webSocketMessage(_socket: WebSocket, message: string | ArrayBuffer) {
    try {
      const { ack } = JSON.parse(String(message)) as { ack?: unknown };
      if (typeof ack === "number")
        this.ctx.storage.sql.exec("DELETE FROM requests WHERE id = ?", ack);
    } catch {
      // Not an answer.
    }
  }

  // A webhook is kept 30 days from when its listener left.
  override async webSocketClose() {
    if (await this.ctx.storage.get("registered"))
      await this.ctx.storage.setAlarm(Date.now() + idleMs);
  }

  override async webSocketError() {
    await this.webSocketClose();
  }

  override async alarm() {
    if (this.ctx.getWebSockets().length)
      await this.ctx.storage.setAlarm(Date.now() + idleMs);
    else await this.ctx.storage.deleteAll();
  }

  async forget() {
    for (const socket of this.ctx.getWebSockets())
      socket.close(1000, "This webhook was deleted.");
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }
}

export default {
  async fetch(request, env) {
    const id = new URL(request.url).pathname.slice(1);
    if (!/^[0-9a-f]{32}$/.test(id)) return answer(404);
    const hook = env.HOOKS.getByName(id);
    if (request.method === "POST") {
      if (!(await env.POSTS.limit({ key: id })).success) return answer(429);
      const body = await readBody(request);
      if (body === null) return answer(413);
      const { status, text } = await hook.post([...request.headers], body);
      return answer(status, text);
    }
    // What only the webhook's computer does.
    const bearer = /^Bearer\s+(\S+)$/i.exec(
      request.headers.get("authorization") ?? "",
    )?.[1];
    if (!bearer || (await sha256(bearer)).slice(0, 32) !== id)
      return answer(401);
    const from = request.headers.get("cf-connecting-ip") ?? "";
    if (!(await env.COMPUTERS.limit({ key: from })).success) return answer(429);
    if (request.method === "DELETE") {
      await hook.forget();
      return answer(204);
    }
    if (
      request.method !== "GET" ||
      request.headers.get("upgrade")?.toLowerCase() !== "websocket" ||
      !isSender(request.headers.get("x-sender")) ||
      (request.headers.get("x-secret")?.length ?? 0) > 1024
    )
      return answer(400);
    return hook.fetch(request);
  },
} satisfies ExportedHandler<Env>;
