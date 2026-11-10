import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

import type { BotStatus, Change, Host } from "./types";

// How a client reaches another's OpenBots over the user's tailnet: another
// computer's (src/main/peers.ts), or the phone's (mobile/src/data.ts).
//
// The user's computers and phone share a pairing code. Every request is
// signed with it, and the computer answering proves it holds the code too,
// so the code itself never crosses the tailnet: another user of one of the
// computers, or whatever else listens at a computer's address, can neither
// ask its bots anything nor learn the code. A page in a browser cannot sign
// a request either, nor name an address as its host after rebinding a name.

export const defaultPort = 47100;

// Twenty of Crockford's base 32 digits: 100 bits, typed in four groups.
const digits = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const codeLength = 20;

// A new code, from random bytes; 256 is a multiple of 32, so each digit is
// as likely as any other.
export const codeFrom = (random: Uint8Array) =>
  Array.from(random.slice(0, codeLength), (byte) => digits[byte % 32]).join("");

// What the user typed, without its dashes and spaces, read as Crockford
// reads it: O is 0, I and L are 1.
export const normalizeCode = (typed: string) =>
  typed
    .toUpperCase()
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1")
    .replace(/[^0-9A-HJKMNP-TV-Z]/g, "");

export const formatCode = (code: string) => code.match(/.{1,5}/g)?.join("-");

const mac = (code: string, text: string) =>
  bytesToHex(hmac(sha256, utf8ToBytes(code), utf8ToBytes(text)));

// A request's signature: its method, the address it was sent to, its path,
// when it was sent and what it carries. A computer takes only requests sent
// to its own address within `skewMs` of its own clock.
export const signRequest = (
  code: string,
  request: {
    method: string;
    address: string;
    path: string;
    at: string;
    body: string;
  },
) =>
  mac(
    code,
    [
      request.method,
      request.address,
      request.path,
      request.at,
      bytesToHex(sha256(utf8ToBytes(request.body))),
    ].join("\n"),
  );

export const skewMs = 5 * 60_000;

// What the computer answering a signed request sends back with its answer.
export const proofOf = (code: string, signature: string) =>
  mac(code, `answer\n${signature}`);

export class Unpaired extends Error {
  constructor() {
    super(
      "That computer has another pairing code. Copy it from Settings on that computer.",
    );
  }
}

type Answer = {
  ok: boolean;
  status: number;
  headers: { get: (name: string) => string | null };
};

// Asks the OpenBots at `address`, and checks the answer comes from one that
// holds the same code. A phone passes its own fetch for a stream.
export const ask = async <A extends Answer = Response>(
  address: string,
  code: string,
  path: string,
  options: {
    body?: string;
    signal?: AbortSignal;
    fetch?: (
      url: string,
      init: {
        body?: string;
        headers: Record<string, string>;
        method: string;
        signal?: AbortSignal;
      },
    ) => Promise<A>;
  } = {},
): Promise<A> => {
  const method = options.body === undefined ? "GET" : "POST";
  const at = String(Date.now());
  const signature = signRequest(code, {
    address,
    at,
    body: options.body ?? "",
    method,
    path: `/openbots${path}`,
  });
  const send =
    options.fetch ?? (fetch as unknown as NonNullable<typeof options.fetch>);
  const answer = await send(`http://${address}/openbots${path}`, {
    body: options.body,
    headers: {
      "content-type": "application/json",
      "x-openbots-at": at,
      "x-openbots-signature": signature,
    },
    method,
    signal: options.signal,
  });
  if (answer.status === 401) throw new Unpaired();
  if (answer.headers.get("x-openbots-proof") !== proofOf(code, signature))
    throw new Error("No OpenBots of this user answered there.");
  return answer;
};

// What a computer says of itself.
export type HostInfo = Omit<Host, "self" | "online">;

// What a computer's events stream says: a bot changed, or only its
// whiteboard, or which there are, with what the server writing it is doing
// with it when that is the one saying it; or the computer itself did.
export type HostEvent = (Change & { status?: BotStatus }) | { host: HostInfo };

// A host's events as they come, until its stream ends. `heard` hears every
// piece, its heartbeats included.
export const readEvents = async (
  body: ReadableStream<Uint8Array>,
  onEvent: (event: HostEvent) => void,
  heard?: () => void,
) => {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    heard?.();
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";
    for (const event of events) {
      const data = event.split("\n").find((line) => line.startsWith("data: "));
      if (data) onEvent(JSON.parse(data.slice(6)) as HostEvent);
    }
  }
};

// Asks the OpenBots at `address` what it answers at `path`, with what a
// POST carries: a command a client asks the servers at "/call", or the
// computers it reaches at "/peers".
export const askAt = async <T = unknown>(
  address: string,
  code: string,
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> => {
  const answer = await ask(address, code, path, {
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
  const read = (await answer.json()) as { result?: T; error?: string };
  if (read.error !== undefined) throw new Error(read.error);
  return read.result as T;
};
