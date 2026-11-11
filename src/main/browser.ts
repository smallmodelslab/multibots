import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import {
  chmod,
  copyFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import {
  browserHost,
  browserProtocol,
  type BrowserCommand,
  type BrowserReply,
  type BrowserResults,
} from "../shared/browser";
import type { ChromeState } from "../shared/types";

// The user's Chrome, for bots to use tabs of their own in, through the
// Multibots extension. Setting it up copies the extension to a folder of
// Multibots', for the user to load in Chrome once, and registers a native
// messaging host that only that extension may start: Multibots itself run as
// Node (browserHost.ts). The host reaches Multibots over a private socket,
// with a token both read from a file only the user can; nothing listens on
// a port a web page could find. A setup made before is refreshed at each
// launch, so updates reach the extension, which reloads when its protocol
// is not Multibots'.

// Where Chrome looks for the user's own native messaging hosts.
export const chromeHosts = join(
  homedir(),
  process.platform === "darwin"
    ? "Library/Application Support/Google/Chrome/NativeMessagingHosts"
    : ".config/google-chrome/NativeMessagingHosts",
);

// Chrome's id for an extension, from its manifest's key.
const idOf = (key: string) =>
  [
    ...createHash("sha256")
      .update(Buffer.from(key, "base64"))
      .digest()
      .subarray(0, 16),
  ]
    .map((byte) => String.fromCharCode(97 + (byte >> 4), 97 + (byte & 15)))
    .join("");

const quoted = (text: string) => `'${text.replaceAll("'", `'\\''`)}'`;

const disconnected = () =>
  new Error(
    "Chrome is not connected. Set it up in Multibots' settings, with the Multibots extension on in Chrome.",
  );

export class Browser {
  private readonly folder: string;
  private server: Server | null = null;
  private token = "";
  private temporary: string | null = null;
  private connected: Socket | null = null;
  // Whether an extension that does not match was asked to reload since one
  // that does connected.
  private reloading = false;
  private next = 0;
  private readonly pending = new Map<
    number,
    { resolve(value: unknown): void; reject(error: Error): void }
  >();

  constructor(
    home: string,
    // The built app's main folder: the host, with the extension beside it.
    private readonly built: string,
    private readonly onChange: () => void,
    // Where Chrome looks for native messaging hosts.
    private readonly hosts = [chromeHosts],
  ) {
    this.folder = join(home, "browser");
  }

  state(): ChromeState {
    return {
      connected: this.connected !== null,
      setUp: existsSync(join(this.folder, "host.json")),
    };
  }

  // Sets Chrome up: the folder to load the extension from.
  async setUp() {
    if (process.platform === "win32")
      throw new Error("Chrome can't be set up on Windows yet.");
    await mkdir(this.folder, { mode: 0o700, recursive: true });
    const extension = join(this.folder, "extension");
    await rm(extension, { force: true, recursive: true });
    await cp(join(this.built, "../extension"), extension, { recursive: true });
    const { key } = JSON.parse(
      await readFile(join(extension, "manifest.json"), "utf8"),
    ) as { key: string };
    const origin = `chrome-extension://${idOf(key)}/`;
    await copyFile(
      join(this.built, "browserHost.js"),
      join(this.folder, "host.mjs"),
    );
    // A release's AppImage moves at each launch, but not the file itself.
    const node = process.env.APPIMAGE ?? process.execPath;
    const host = join(this.folder, "host");
    await writeFile(
      host,
      `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec ${quoted(node)} ${quoted(join(this.folder, "host.mjs"))} "$@"\n`,
    );
    await chmod(host, 0o700);
    await writeFile(
      join(this.folder, "host.json"),
      JSON.stringify({ origin }),
      {
        mode: 0o600,
      },
    );
    for (const hosts of this.hosts) {
      await mkdir(hosts, { recursive: true });
      await writeFile(
        join(hosts, `${browserHost}.json`),
        JSON.stringify({
          allowed_origins: [origin],
          description: "Multibots",
          name: browserHost,
          path: host,
          type: "stdio",
        }),
      );
    }
    this.onChange();
    return extension;
  }

  async start() {
    if (process.platform === "win32") return;
    if (this.state().setUp) await this.setUp();
    this.token = randomBytes(32).toString("hex");
    // Socket paths are short: under the system's temporary folder.
    this.temporary = await mkdtemp(join(tmpdir(), "multibots-browser-"));
    const path = join(this.temporary, "browser.sock");
    const server = createServer((socket) => this.accept(socket));
    this.server = server;
    await new Promise<void>((done, fail) => {
      server.once("error", fail);
      server.listen(path, done);
    });
    await mkdir(this.folder, { mode: 0o700, recursive: true });
    await writeFile(
      join(this.folder, "connection.json"),
      JSON.stringify({ socket: path, token: this.token }),
      { mode: 0o600 },
    );
  }

  private accept(socket: Socket) {
    socket.on("error", () => {});
    socket.setTimeout(5000, () => socket.destroy());
    socket.setEncoding("utf8");
    let authenticated = false;
    let buffer = "";
    const say = (message: object) =>
      socket.write(`${JSON.stringify(message)}\n`);
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      // Pictures of a long page may be large.
      if (buffer.length > (authenticated ? 256_000_000 : 4096))
        return socket.destroy();
      for (
        let end = buffer.indexOf("\n");
        end >= 0;
        end = buffer.indexOf("\n")
      ) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        let message: BrowserReply & { token?: string; hello?: number };
        try {
          message = JSON.parse(line);
        } catch {
          return socket.destroy();
        }
        if (!authenticated) {
          const token = Buffer.from(String(message.token ?? ""));
          if (
            token.length !== this.token.length ||
            !timingSafeEqual(token, Buffer.from(this.token))
          )
            return socket.destroy();
          authenticated = true;
        } else if (message.hello !== undefined) {
          // Chrome runs the extension it loaded until it reloads, once, from
          // the folder updated for this protocol.
          if (message.hello !== browserProtocol) {
            if (this.reloading)
              return socket.end(
                `${JSON.stringify({ error: "This extension does not match Multibots. Set Chrome up again in Multibots' settings." })}\n`,
              );
            this.reloading = true;
            say({ reload: true });
            continue;
          }
          this.reloading = false;
          if (this.connected && this.connected !== socket) {
            say({
              error:
                "Another Chrome profile is connected to Multibots. Turn the extension off there first.",
            });
            return socket.end();
          }
          this.connected = socket;
          socket.setTimeout(0);
          say({ ready: true });
          this.onChange();
        } else if (this.connected === socket) {
          const waiter = this.pending.get(message.id);
          this.pending.delete(message.id);
          if (message.error) waiter?.reject(new Error(message.error));
          else waiter?.resolve(message.result ?? null);
        }
      }
    });
    socket.on("close", () => {
      if (this.connected !== socket) return;
      this.connected = null;
      for (const waiter of this.pending.values()) waiter.reject(disconnected());
      this.pending.clear();
      this.onChange();
    });
  }

  readonly send = <K extends BrowserCommand["action"]>(
    command: Extract<BrowserCommand, { action: K }>,
    timeoutMs = 60_000,
  ) => {
    const socket = this.connected;
    if (!socket) return Promise.reject(disconnected());
    const id = ++this.next;
    return new Promise<BrowserResults[K]>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new Error(
            "Chrome did not answer in time. Look at the tab before doing it again.",
          ),
        );
      }, timeoutMs);
      this.pending.set(id, {
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value as BrowserResults[K]);
        },
      });
      socket.write(`${JSON.stringify({ ...command, id })}\n`);
    });
  };

  async close() {
    this.server?.close();
    this.connected?.destroy();
    if (this.temporary)
      await rm(this.temporary, { force: true, recursive: true });
  }
}
