import { createHash, randomBytes } from "node:crypto";

import { senders, type Sender } from "@wrkrsh/webhooks";

import type { Webhook } from "../shared/types";
import { logError } from "./log";

// Webhook routines' webhooks. OpenBots has no server of its own on the
// internet, so they are at a relay (relay/, at hooks.wrkrsh.com) that holds
// each request until the server writing the routine's bot takes it. Each
// webhook is kept with its bot (src/main/bots.ts), sealed on every server:
// who calls it, which the user picks; the secret that sender proves itself
// with, made here for a sender that takes one and pasted by the user from
// one that makes its own; and the secret its server listens with, whose
// hash names the webhook at the relay. The bot never sees either secret.

const relay = (
  process.env.OPENBOTS_RELAY ?? "https://hooks.wrkrsh.com"
).replace(/\/+$/, "");

export type SavedWebhook = {
  sender: Sender;
  // Null until the user pastes the sender's own.
  secret: string | null;
  listen: string;
  // Whether the relay has taken it as it is.
  registered: boolean;
};

const sha256 = (text: string) =>
  createHash("sha256").update(text).digest("hex");
const urlOf = (listen: string) => `${relay}/${sha256(listen).slice(0, 32)}`;
const newSecret = () => randomBytes(32).toString("base64url");

// Silence this long means the connection died, as it does when the computer
// sleeps, though nothing closed it; the relay answers each ping.
const pingMs = 30_000;
const silentMs = 75_000;

// The webhooks this server listens to: those of the routines of the bots
// it writes. A new listener at the relay replaces the one before, so the
// server that writes a bot next takes its requests from then on.
export class Webhooks {
  // What stops listening to each, by routine, and what it listens with.
  private readonly listeners = new Map<
    string,
    { as: string; stop: () => void }
  >();

  constructor(
    private readonly options: {
      // A request for a routine's webhook: what it carried, when it came
      // and its id at the relay, both newer for each new request. The relay
      // holds it until this has kept it, and sends it again otherwise.
      onRequest: (
        routineId: string,
        body: string,
        at: number,
        id: number,
      ) => Promise<void>;
      // The relay took a routine's webhook as it is.
      onRegistered: (routineId: string) => void;
    },
  ) {}

  // A new routine's webhook, called with a Bearer key until the user picks
  // another sender.
  make(): SavedWebhook {
    return {
      listen: newSecret(),
      registered: false,
      secret: newSecret(),
      sender: "bearer",
    };
  }

  // What the user sees of a routine's webhook.
  view(saved: SavedWebhook): Webhook {
    return {
      registered: saved.registered,
      secret: saved.secret,
      sender: saved.sender,
      url: urlOf(saved.listen),
    };
  }

  // The user picks who calls a routine's webhook, which gives it a new
  // secret, or none until they paste the sender's own; or pastes that.
  // Null when nothing changes.
  change(
    saved: SavedWebhook,
    sender: Sender,
    pasted?: string,
  ): SavedWebhook | null {
    const secret = pasted?.trim();
    if (
      secret !== undefined &&
      (senders[sender].ours || !secret || secret.length > 1024)
    )
      throw new Error(`That is not ${senders[sender].label}'s secret.`);
    if (secret === undefined && sender === saved.sender) return null;
    return {
      ...saved,
      registered: false,
      secret:
        secret ??
        (sender === saved.sender
          ? saved.secret
          : senders[sender].ours
            ? newSecret()
            : null),
      sender,
    };
  }

  // A deleted routine's webhook goes from the relay too, which in any case
  // forgets one nothing listened to for a month.
  delete(routineId: string, saved: SavedWebhook) {
    void fetch(urlOf(saved.listen), {
      headers: { authorization: `Bearer ${saved.listen}` },
      method: "DELETE",
    }).catch((error: unknown) =>
      logError("webhooks", "A webhook could not be deleted at its relay.", {
        error,
        relay,
        routineId,
      }),
    );
  }

  // Listens to these webhooks, by routine, and to no others; one whose
  // sender or secret changed, anew.
  listen(webhooks: Map<string, SavedWebhook>) {
    for (const [id, listener] of this.listeners)
      if (webhooks.get(id) === undefined) {
        listener.stop();
        this.listeners.delete(id);
      }
    for (const [id, saved] of webhooks) {
      const as = `${saved.listen} ${saved.sender} ${saved.secret}`;
      const listener = this.listeners.get(id);
      if (listener?.as === as) continue;
      listener?.stop();
      this.listeners.set(id, { as, stop: this.follow(id, saved) });
    }
  }

  close() {
    for (const { stop } of this.listeners.values()) stop();
    this.listeners.clear();
  }

  // Listens to a routine's webhook, which registers it as it is saved, until
  // stopped, connecting again whenever the connection drops, each time a
  // little later, up to a minute.
  private follow(routineId: string, saved: SavedWebhook) {
    let stopped = false;
    let retry: NodeJS.Timeout | undefined;
    let wait = 1000;
    let drop = () => {};
    const connect = () => {
      // Node's WebSocket takes headers, which the DOM's type knows nothing of.
      const socket = new WebSocket(urlOf(saved.listen).replace(/^http/, "ws"), {
        headers: {
          authorization: `Bearer ${saved.listen}`,
          "x-sender": saved.sender,
          ...(saved.secret === null ? {} : { "x-secret": saved.secret }),
        },
      } as unknown as string[]);
      let opened = false;
      let heard = Date.now();
      const beat = setInterval(() => {
        if (Date.now() - heard > silentMs) drop();
        else if (socket.readyState === WebSocket.OPEN) socket.send("ping");
      }, pingMs);
      let dropped = false;
      drop = () => {
        if (dropped) return;
        dropped = true;
        clearInterval(beat);
        socket.close();
        if (stopped) return;
        logError(
          "webhooks",
          opened
            ? "A webhook's connection to its relay dropped."
            : "A webhook could not reach its relay.",
          { relay, retryMs: wait, routineId },
        );
        retry = setTimeout(connect, wait);
        wait = Math.min(wait * 2, 60_000);
      };
      socket.onopen = () => {
        opened = true;
        wait = 1000;
        if (!saved.registered) this.options.onRegistered(routineId);
      };
      socket.onmessage = ({ data }) => {
        heard = Date.now();
        if (data !== "pong") void this.take(routineId, socket, String(data));
      };
      socket.onclose = () => drop();
    };
    connect();
    return () => {
      stopped = true;
      clearTimeout(retry);
      drop();
    };
  }

  // Hands a request on, and answers it once it is kept, so the relay holds
  // it until then.
  private async take(routineId: string, socket: WebSocket, data: string) {
    try {
      const { at, body, id } = JSON.parse(data) as {
        at: number;
        body: string;
        id: number;
      };
      await this.options.onRequest(routineId, body, at, id);
      if (socket.readyState === WebSocket.OPEN)
        socket.send(JSON.stringify({ ack: id }));
    } catch (error) {
      logError("webhooks", "A webhook request could not be kept.", {
        error,
        routineId,
      });
    }
  }
}
