import { execFile } from "node:child_process";
import { randomBytes, timingSafeEqual } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { isIP } from "node:net";

import {
  ask,
  askAt,
  codeFrom,
  codeLength,
  defaultPort,
  formatCode,
  normalizeCode,
  proofOf,
  readEvents,
  signRequest,
  skewMs,
  Unpaired,
  type HostInfo as Info,
} from "../shared/peer";
import {
  uploadLimits,
  type AppState,
  type Change,
  type BotStatus,
  type Command,
  type Host,
} from "../shared/types";
import type { Copy, Manifests } from "./replica";
import { readSealed, writeSealed } from "./sealed";

// OpenBots on the user's other computers, found and reached over their
// tailnet: nothing on the internet between them. Each client listens on its
// own tailnet address and answers only the computers of the same Tailscale
// user, whose addresses Tailscale vouches for. A tagged device keeps the ID
// of the user who made it but belongs to its tags, such as a shared server,
// so it is not the user's. Of those, it answers only the clients that hold
// its pairing code (src/shared/peer.ts), and it reaches only those. A client
// asks the servers about the bots, and hears what changes on their events
// streams; the servers send each other their copies of the bots
// (src/main/replica.ts), and what a bot one of them writes is doing.

type Status = {
  BackendState: string;
  Self: { HostName: string; TailscaleIPs: string[] | null; UserID: number };
  Peer?: Record<
    string,
    {
      HostName: string;
      TailscaleIPs: string[] | null;
      UserID: number;
      Online: boolean;
      Tags?: string[];
    }
  >;
};

// The CLI is on the PATH only when the user put it there; each platform's
// app keeps one of its own.
const tailscaleCommands =
  process.platform === "darwin"
    ? ["tailscale", "/Applications/Tailscale.app/Contents/MacOS/Tailscale"]
    : process.platform === "win32"
      ? ["tailscale", "C:\\Program Files\\Tailscale\\tailscale.exe"]
      : ["tailscale"];

const tailscaleStatus = async (): Promise<Status | "missing"> => {
  for (const command of tailscaleCommands) {
    const output = await new Promise<string | null>((done) =>
      execFile(
        command,
        ["status", "--json"],
        { timeout: 10_000 },
        (error, stdout) => done(error && !stdout ? null : stdout),
      ),
    );
    if (output) return JSON.parse(output) as Status;
  }
  return "missing";
};

const ipv4 = (ips: string[] | null) =>
  ips?.find((ip) => isIP(ip) === 4) ?? null;

// Decoded once it is all in, so no character is split between pieces and
// the body is the text that was signed.
const readBody = (request: IncomingMessage, limit: number) =>
  new Promise<string>((done, fail) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
      size += chunk.length;
      if (size > limit) request.destroy(new Error("Too large."));
    });
    request.on("end", () => done(Buffer.concat(chunks).toString()));
    request.on("error", fail);
  });

type Peer = { info: Info; address: string; stop: AbortController };

// Each events stream beats every 25 seconds.
const silentMs = 60_000;

export class Peers {
  private readonly peers = new Map<string, Peer>();
  private readonly subscribers = new Set<ServerResponse>();
  private readonly connecting = new Set<string>();
  // The user's computers whose OpenBots holds another code, by address.
  private readonly unpaired = new Map<string, string>();
  // The user's tailnet addresses, this computer's included.
  private allowed = new Set<string>();
  private code = "";
  private server: Server | null = null;
  private listening: string | null = null;
  private timer: NodeJS.Timeout | null = null;
  tailscale: AppState["tailscale"] = "stopped";

  constructor(
    private readonly options: {
      // Where the pairing code is kept, sealed.
      file: string;
      port: number;
      self: () => Info;
      // A command from a window elsewhere, or handed on by another server
      // to be handled here.
      handle: (command: Command, handedOn: boolean) => Promise<unknown>;
      // What another server asks of this one's copies of the bots.
      replica: {
        manifest: () => Manifests;
        copy: (botId: string, path: string) => Promise<Copy | null>;
        apply: (copy: Copy) => Promise<void>;
      };
      onHosts: () => void;
      onChange: (change: Change, from: string, status?: BotStatus) => void;
      // What the bots this server writes are doing, those doing anything.
      statuses: () => [string, BotStatus][];
    },
  ) {}

  // The first launch makes a code of its own.
  async load() {
    const saved = await readSealed<{ code: string }>(this.options.file);
    if (saved) this.code = saved.code;
    else await this.pair(null);
  }

  pairing(): AppState["pairing"] {
    return {
      code: formatCode(this.code) ?? "",
      unpaired: [...new Set(this.unpaired.values())],
    };
  }

  // Takes another computer's code, or makes a new one. The clients that
  // held the old one are cut off, and those that hold the new one are
  // found again.
  async pair(typed: string | null) {
    const code =
      typed === null ? codeFrom(randomBytes(codeLength)) : normalizeCode(typed);
    if (code.length !== codeLength)
      throw new Error("A pairing code has 20 letters and digits.");
    await writeSealed(this.options.file, { code });
    this.code = code;
    for (const peer of this.peers.values()) peer.stop.abort();
    this.peers.clear();
    for (const response of this.subscribers) response.end();
    this.subscribers.clear();
    this.unpaired.clear();
    this.options.onHosts();
    if (this.timer) void this.discover();
  }

  // Settles once the computers online are first found.
  async start() {
    this.timer = setInterval(() => void this.discover(), 30_000);
    await this.discover();
  }

  close() {
    if (this.timer) clearInterval(this.timer);
    for (const peer of this.peers.values()) peer.stop.abort();
    for (const response of this.subscribers) response.end();
    this.server?.close();
  }

  hosts(): Host[] {
    return [...this.peers.values()].map(({ info }) => ({
      ...info,
      online: true,
      self: false,
    }));
  }

  // The other servers online.
  servers() {
    return [...this.peers.values()]
      .filter(({ info }) => info.server)
      .map(({ info }) => info);
  }

  private async discover() {
    const status = await tailscaleStatus().catch(() => "missing" as const);
    const state =
      status === "missing"
        ? "missing"
        : status.BackendState === "Running"
          ? "running"
          : "stopped";
    if (state !== this.tailscale) {
      this.tailscale = state;
      this.options.onHosts();
    }
    if (status === "missing" || state !== "running") return;
    const own = ipv4(status.Self.TailscaleIPs);
    const mine = Object.values(status.Peer ?? {}).filter(
      (peer) => peer.UserID === status.Self.UserID && !peer.Tags?.length,
    );
    this.allowed = new Set(
      [status.Self, ...mine].flatMap((peer) => peer.TailscaleIPs ?? []),
    );
    if (own) this.listen(own);
    const known = new Set([...this.peers.values()].map((peer) => peer.address));
    const candidates = [status.Self, ...mine.filter((peer) => peer.Online)]
      .map((peer) => ({ ip: ipv4(peer.TailscaleIPs), name: peer.HostName }))
      .filter((peer): peer is { ip: string; name: string } => Boolean(peer.ip))
      .map((peer) => ({ ...peer, address: `${peer.ip}:${defaultPort}` }))
      .filter((peer) => !known.has(peer.address));
    for (const address of this.unpaired.keys())
      if (!candidates.some((peer) => peer.address === address))
        this.unpaired.delete(address);
    await Promise.all([
      ...candidates.map((peer) => this.connect(peer.address, peer.name)),
      ...[...this.peers.values()].map(({ address }) =>
        this.reachThrough(address),
      ),
    ]);
  }

  // The computers the one at `address` reaches that Tailscale does not
  // name, such as another client on one computer.
  private async reachThrough(address: string) {
    const own = `${this.listening}:${this.options.port}`;
    const addresses = await askAt<string[]>(address, this.code, "/peers").catch(
      () => [],
    );
    await Promise.all(
      addresses
        .filter((each) => each !== own)
        .map((each) => this.connect(each)),
    );
  }

  private listen(ip: string) {
    if (this.listening === ip) return;
    this.server?.close();
    this.listening = ip;
    this.server = createServer(
      (request, response) => void this.serve(request, response),
    );
    this.server.on("error", (error) => {
      console.error("OpenBots could not listen on the tailnet:", error);
      this.listening = null;
    });
    this.server.listen(this.options.port, ip);
  }

  private async serve(request: IncomingMessage, response: ServerResponse) {
    const from = (request.socket.remoteAddress ?? "").replace(/^::ffff:/, "");
    const address = `${this.listening}:${this.options.port}`;
    if (!this.allowed.has(from) || request.headers.host !== address) {
      response.writeHead(403).end();
      return;
    }
    const json = (status: number, body: unknown) => {
      response
        .writeHead(status, { "content-type": "application/json" })
        .end(JSON.stringify(body));
    };
    try {
      // A call carries at most a message's files, in base64.
      const body =
        request.method === "POST"
          ? await readBody(
              request,
              uploadLimits.count * uploadLimits.bytes * 1.4,
            )
          : "";
      const at = String(request.headers["x-openbots-at"]);
      const given = Buffer.from(
        String(request.headers["x-openbots-signature"] ?? ""),
      );
      const signature = signRequest(this.code, {
        address,
        at,
        body,
        method: request.method ?? "",
        path: request.url ?? "",
      });
      if (
        !(Math.abs(Date.now() - Number(at)) <= skewMs) ||
        given.length !== signature.length ||
        !timingSafeEqual(given, Buffer.from(signature))
      ) {
        response.writeHead(401).end();
        return;
      }
      response.setHeader("x-openbots-proof", proofOf(this.code, signature));
      if (request.method === "GET" && request.url === "/openbots") {
        json(200, this.options.self());
      } else if (
        request.method === "GET" &&
        request.url === "/openbots/events"
      ) {
        response.writeHead(200, {
          "cache-control": "no-store",
          "content-type": "text/event-stream",
        });
        response.write(": open\n\n");
        // What the bots this server writes are doing now.
        for (const [botId, status] of this.options.statuses())
          response.write(`data: ${JSON.stringify({ botId, status })}\n\n`);
        this.subscribers.add(response);
        const beat = setInterval(() => response.write(": beat\n\n"), 25_000);
        request.on("close", () => {
          clearInterval(beat);
          this.subscribers.delete(response);
        });
      } else if (
        request.method === "GET" &&
        request.url === "/openbots/peers"
      ) {
        // The user's other computers this one reaches, for a phone, or
        // another client on this computer, that knows only this one.
        json(200, {
          result: [...this.peers.values()].map((peer) => peer.address),
        });
      } else if (
        request.method === "POST" &&
        request.url === "/openbots/hello"
      ) {
        // The caller found this computer: this one connects back.
        const { port } = JSON.parse(body) as { port: number };
        void this.connect(`${from}:${Number(port)}`);
        json(200, null);
      } else if (
        request.method === "POST" &&
        (request.url === "/openbots/call" || request.url === "/openbots/here")
      ) {
        const command = JSON.parse(body) as Command;
        json(200, {
          result: await this.options.handle(
            command,
            request.url === "/openbots/here",
          ),
        });
      } else if (
        request.method === "GET" &&
        request.url === "/openbots/manifest"
      ) {
        json(200, { result: this.options.replica.manifest() });
      } else if (
        request.method === "POST" &&
        request.url === "/openbots/copy"
      ) {
        const { botId, path } = JSON.parse(body) as {
          botId: string;
          path: string;
        };
        json(200, { result: await this.options.replica.copy(botId, path) });
      } else if (
        request.method === "POST" &&
        request.url === "/openbots/replicate"
      ) {
        await this.options.replica.apply(JSON.parse(body) as Copy);
        json(200, { result: null });
      } else {
        response.writeHead(404).end();
      }
    } catch (error) {
      json(500, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // `name` is the computer's on the tailnet, shown while its OpenBots
  // holds another code.
  private async connect(address: string, name = address) {
    if (
      this.connecting.has(address) ||
      [...this.peers.values()].some((peer) => peer.address === address)
    )
      return;
    this.connecting.add(address);
    const code = this.code;
    const stop = new AbortController();
    try {
      const response = await ask(address, code, "", {
        signal: AbortSignal.timeout(3000),
      });
      if (this.unpaired.delete(address)) this.options.onHosts();
      if (!response.ok) return;
      const info = (await response.json()) as Info;
      if (info.id === this.options.self().id || this.peers.has(info.id)) return;
      const events = await ask(address, code, "/events", {
        signal: stop.signal,
      });
      if (!events.ok || !events.body || code !== this.code) {
        stop.abort();
        return;
      }
      const peer = { address, info, stop };
      this.peers.set(info.id, peer);
      this.options.onHosts();
      // What changed while it was away is read anew.
      this.options.onChange({ botId: null }, info.id);
      void ask(address, code, "/hello", {
        body: JSON.stringify({ port: this.options.port }),
      }).catch(() => {});
      void this.follow(info.id, peer, events.body);
      await this.reachThrough(address);
    } catch (error) {
      stop.abort();
      if (error instanceof Unpaired && code === this.code) {
        this.unpaired.set(address, name);
        this.options.onHosts();
      }
      // Otherwise out of reach for now.
    } finally {
      this.connecting.delete(address);
    }
  }

  // A peer's events, until it goes away or the code changes.
  private async follow(
    hostId: string,
    peer: Peer,
    body: ReadableStream<Uint8Array>,
  ) {
    // A stream that says nothing, not even its heartbeat, for this long went
    // away without closing, as when its computer slept.
    let silence = setTimeout(() => peer.stop.abort(), silentMs);
    await readEvents(
      body,
      (event) => {
        if ("host" in event) {
          peer.info = event.host;
          this.options.onHosts();
        } else {
          this.options.onChange(
            {
              botId: event.botId,
              ...(event.whiteboard && { whiteboard: true }),
            },
            hostId,
            event.status,
          );
        }
      },
      () => {
        clearTimeout(silence);
        silence = setTimeout(() => peer.stop.abort(), silentMs);
      },
    ).catch(() => {
      // Gone: it closed, slept or left the tailnet.
    });
    clearTimeout(silence);
    peer.stop.abort();
    if (this.peers.get(hostId) !== peer) return;
    this.peers.delete(hostId);
    this.options.onHosts();
  }

  private send(event: unknown) {
    for (const response of this.subscribers)
      response.write(`data: ${JSON.stringify(event)}\n\n`);
  }

  // Tells the peers a bot changed, or only its whiteboard, or which there
  // are; or what this server is doing with a bot it writes.
  changed(
    botId: string | null,
    extra?: { whiteboard?: true; status?: BotStatus },
  ) {
    this.send({ botId, ...extra });
  }

  // Tells the peers this computer changed, such as its ChatGPT sign-in.
  hostChanged() {
    this.send({ host: this.options.self() });
  }

  private peer(hostId: string) {
    const peer = this.peers.get(hostId);
    if (!peer) throw new Error("That computer is offline.");
    return peer;
  }

  // A request to a server ends once it has taken this long, or the server
  // went away.
  private deadline(hostId: string, ms: number) {
    return AbortSignal.any([
      this.peer(hostId).stop.signal,
      AbortSignal.timeout(ms),
    ]);
  }

  // Asks a server, which hands it to the one writing the bot.
  call(hostId: string, command: Command) {
    return askAt(this.peer(hostId).address, this.code, "/call", command);
  }

  // Hands a command to the server writing its bot, to be handled there.
  handOn(hostId: string, command: Command) {
    return askAt(this.peer(hostId).address, this.code, "/here", command);
  }

  manifest(hostId: string) {
    return askAt<Manifests>(
      this.peer(hostId).address,
      this.code,
      "/manifest",
      undefined,
      this.deadline(hostId, 60_000),
    );
  }

  copy(hostId: string, botId: string, path: string) {
    return askAt<Copy | null>(
      this.peer(hostId).address,
      this.code,
      "/copy",
      { botId, path },
      this.deadline(hostId, 300_000),
    );
  }

  async replicate(hostId: string, copy: Copy) {
    await askAt(
      this.peer(hostId).address,
      this.code,
      "/replicate",
      copy,
      this.deadline(hostId, 300_000),
    );
  }
}
