import { execFile, spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { connect, type Socket } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

import type { MultidesktopState, Screen } from "../shared/types";

// This server's screen, for the bots it runs and the windows that watch
// them, through the computer's own Multidesktop, so its bridge is the one
// copy macOS allows to record the screen and control it. When Multidesktop
// runs as the user's service, OpenBots signals through that desktop's local
// socket. Otherwise OpenBots runs the installed release itself, without a
// cloud (`multidesktop --local`), until the app quits. Settings installs it
// with Multidesktop's own installer when it is missing or too old. Bots use
// the screen through m11's computer-use REPL, the one every wrkrsh product
// shares, and a window on another of the user's computers watches it over
// WebRTC, its offer handed to the desktop here. Once m11 is signed in to
// Multidesktop's cloud, bots also reach the user's other computers there,
// their screens and their shells, naming each in their tools.

const mac = process.platform === "darwin";
// Where Multidesktop's installer puts `multidesktop` and `m11`.
// OPENBOTS_MULTIDESKTOP names a build of one's own instead, for development:
// OpenBots then neither installs Multidesktop nor uses the service.
const override = process.env.OPENBOTS_MULTIDESKTOP;
const bin = override ?? join(homedir(), ".local", "bin");
const m11 = join(bin, "m11");
const cloud = "https://multidesktop.cloud";
// The desktop `multidesktop up` set up as the user's service.
const serviceConfig = join(
  mac
    ? join(homedir(), "Library", "Application Support")
    : (process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config")),
  "multidesktop",
  "client.toml",
);
// Multidesktop's installer, from its cloud: the newest release, checked and
// put where Multidesktop keeps its releases. Without arguments it joins no
// cloud and sets nothing else up.
const installer = "curl -fsSL https://multidesktop.cloud/install.sh | sh";

// Whether a release is the one given or later; development builds are
// 0.0.0, and every later.
const atLeast = (version: string, since: number[]) => {
  const parts = version.split(".").map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return false;
  if (parts.every((part) => part === 0)) return true;
  const first = parts.findIndex((part, index) => part !== since[index]);
  return first === -1 || parts[first]! > since[first]!;
};
// The first release whose local socket signals.
const signals = (version: string) => atLeast(version, [0, 4, 7]);

// What a program says when it fails, or null when it does not.
const failureOf = (file: string, args: string[]) =>
  new Promise<string | null>((done) =>
    execFile(file, args, (error, _stdout, stderr) =>
      done(error ? stderr.trim().split("\n").at(-1) || error.message : null),
    ),
  );

// The installed release's version, or null with none.
const installedVersion = () =>
  new Promise<string | null>((done) =>
    execFile(join(bin, "multidesktop"), ["--version"], (error, stdout) =>
      done(error ? null : stdout.trim().split(" ").at(-1)!),
    ),
  );

type Status = { version: string; starting: boolean; missing: string[] };

// What m11 answers for a cell: text and PNG screenshots.
export type ReplPart =
  | { type: "text"; text: string }
  | { type: "image"; mimeType: string; data: string };
export type ReplResult = { content: ReplPart[]; isError: boolean };

// Reads one line at a time, null once the stream ends.
const lines = (input: NodeJS.ReadableStream) => {
  const queue: string[] = [];
  const waiting: ((line: string | null) => void)[] = [];
  let ended = false;
  const reader = createInterface({ input });
  reader.on("line", (line) => {
    const next = waiting.shift();
    if (next) next(line);
    else queue.push(line);
  });
  reader.on("close", () => {
    ended = true;
    for (const next of waiting.splice(0)) next(null);
  });
  return () =>
    new Promise<string | null>((done) => {
      const line = queue.shift();
      if (line !== undefined) done(line);
      else if (ended) done(null);
      else waiting.push(done);
    });
};

// An m11 REPL, whose sessions, and the light along a screen's edges they
// keep on, end with it.
class Repl {
  private child: ChildProcess | null = null;
  private next: (() => Promise<string | null>) | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly args: string[]) {}

  run(code: string, timeoutMs: number, signal?: AbortSignal) {
    const result = this.queue.then(() => this.cell(code, timeoutMs, signal));
    this.queue = result.catch(() => {});
    return result;
  }

  private async cell(code: string, timeoutMs: number, signal?: AbortSignal) {
    signal?.throwIfAborted();
    if (!this.child) {
      const child = spawn(m11, this.args, {
        stdio: ["pipe", "pipe", "ignore"],
      });
      // One that fails to start ends its cell like one that exits.
      child.on("error", () => {});
      child.stdin!.on("error", () => {});
      child.on("close", () => {
        if (this.child === child) this.child = null;
      });
      this.child = child;
      this.next = lines(child.stdout!);
    }
    const { child, next } = this;
    // Stopping the run ends what the cell was doing.
    const stop = () => child.kill();
    signal?.addEventListener("abort", stop, { once: true });
    try {
      child.stdin!.write(`${JSON.stringify({ code, timeoutMs })}\n`);
      const line = await next!();
      if (line === null) throw new Error("The computer's REPL ended.");
      return JSON.parse(line) as ReplResult;
    } finally {
      signal?.removeEventListener("abort", stop);
    }
  }

  close() {
    this.child?.kill();
    this.child = null;
  }
}

// A bot's REPLs for one run, which end with it: one on this server's own
// screen, and one through Multidesktop's cloud for the user's other
// computers, each started at its first use. Every cell first binds the
// screen it names as `computer`, again after a cell that timed out cleared
// the REPL.
export class Repls {
  private here: Repl | null = null;
  private others: Repl | null = null;

  constructor(private readonly config: string | null) {}

  // On this server's screen, or the named computer's.
  run(
    computer: string | null,
    code: string,
    timeoutMs: number,
    signal?: AbortSignal,
  ) {
    if (computer === null) {
      if (!this.config) throw new Error("This server's screen can't be used.");
      this.here ??= new Repl([`--local=${this.config}`, "repl"]);
      return this.here.run(
        `globalThis.computer ??= await md.getMachine("local");\n${code}`,
        timeoutMs,
        signal,
      );
    }
    this.others ??= new Repl(["repl"]);
    return this.others.run(
      `globalThis.machines ??= {};\nglobalThis.computer = machines[${JSON.stringify(computer)}] ??= await md.getMachine(${JSON.stringify(computer)});\n${code}`,
      timeoutMs,
      signal,
    );
  }

  close() {
    this.here?.close();
    this.others?.close();
  }
}

// How a command runs in another computer's shell, through Multidesktop.
export const remoteShell = (computer: string, command: string) => ({
  args: ["ssh", computer, command],
  file: m11,
});

// The desktops m11 reaches through Multidesktop's cloud, by name, null when
// it is not signed in there.
const cloudDesktops = () =>
  new Promise<string[] | null>((done) =>
    execFile(m11, ["ls"], { timeout: 20_000 }, (error, stdout) => {
      if (error) return done(null);
      done(
        stdout
          .split("\n")
          .filter(Boolean)
          .map((line) => (JSON.parse(line) as { name: string }).name),
      );
    }),
  );

export class Computer {
  // The config of the desktop in use: the service's, or OpenBots' own.
  private config: string | null = null;
  private readonly own: string;
  private desktop: ChildProcess | null = null;
  private started = 0;
  // The version bots use: the service's when it runs, else the installed one.
  private version: string | null = null;
  private service = false;
  private installing = false;
  private timer: NodeJS.Timeout | null = null;
  private state: Screen = null;
  private readonly views = new Map<string, Socket>();
  private closed = false;
  // The user's other computers on Multidesktop's cloud.
  private computers: string[] | null = null;
  private signingIn = false;
  private cloudTimer: NodeJS.Timeout | null = null;

  constructor(
    home: string,
    private readonly name: string,
    private readonly onChange: () => void,
    // Opens the cloud's sign-in in the browser.
    private readonly openUrl: (url: string) => void,
  ) {
    this.own = join(home, "multidesktop.toml");
  }

  screen() {
    return this.state;
  }

  multidesktop(): MultidesktopState {
    const { computers, installing, signingIn, version } = this;
    return {
      computers,
      current: signals(version ?? ""),
      installing,
      signingIn,
      version,
    };
  }

  // Whether the Multidesktop bots use reads the screen's text and reads a
  // long list or page whole, as 0.4.8 began to.
  reads() {
    return atLeast(this.version ?? "", [0, 4, 8]);
  }

  // The user's other computers bots reach, by name.
  others() {
    return this.computers ?? [];
  }

  repls() {
    return new Repls(this.state === "ready" ? this.config : null);
  }

  // Which of the user's computers m11 reaches through the cloud, this one
  // left out, looked at every few minutes.
  private async lookAround() {
    if (this.closed) return;
    const found = await cloudDesktops();
    const others = found && found.filter((name) => name !== this.name);
    if (JSON.stringify(others) !== JSON.stringify(this.computers)) {
      this.computers = others;
      this.onChange();
    }
    if (this.cloudTimer) clearTimeout(this.cloudTimer);
    this.cloudTimer = setTimeout(() => void this.lookAround(), 180_000);
  }

  // Signs m11 in to Multidesktop's cloud in the browser.
  async signIn() {
    if (this.signingIn) return;
    this.signingIn = true;
    this.onChange();
    try {
      await new Promise<void>((done, fail) => {
        const child = spawn(m11, ["login", "--cloud", cloud], {
          stdio: ["ignore", "ignore", "pipe"],
        });
        let said = "";
        child.stderr!.on("data", (chunk: Buffer) => {
          said += chunk.toString();
          const link = /Open (\S+) and confirm/.exec(said)?.[1];
          if (link) {
            this.openUrl(link);
            said = "";
          }
        });
        child.on("error", fail);
        child.on("close", (code) =>
          code === 0
            ? done()
            : fail(
                new Error(said.trim().split("\n").at(-1) || "Sign-in failed."),
              ),
        );
      });
    } finally {
      this.signingIn = false;
      await this.lookAround();
    }
  }

  async start() {
    if (!mac && process.platform !== "linux") return;
    // Bots have a shell of their own.
    await writeFile(
      this.own,
      `name = ${JSON.stringify(this.name)}\nshell = false\n`,
    );
    void this.poll();
    void this.lookAround();
  }

  private set(state: Screen) {
    if (state === this.state) return;
    this.state = state;
    this.onChange();
  }

  // Which desktop bots use, and whether it can see and use the screen,
  // asked often until it can: macOS asks a person to allow it.
  private async poll() {
    if (this.closed) return;
    this.set(await this.check().catch(() => null));
    // One loop, also when Settings looked again in the meantime.
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(
      () => void this.poll(),
      this.state === "ready" ? 60_000 : 5_000,
    );
  }

  private async check(): Promise<Screen> {
    const service = override
      ? null
      : await this.ask<Status>(serviceConfig, { type: "status" }).catch(
          () => null,
        );
    const version = service?.version ?? (await installedVersion());
    this.service = Boolean(service);
    if (version !== this.version) {
      this.version = version;
      this.onChange();
    }
    if (!signals(version ?? "")) return null;
    if (service) {
      this.stop();
      this.config = serviceConfig;
      return screenOf(service);
    }
    this.config = this.own;
    if (!this.desktop && Date.now() - this.started > 30_000) this.run();
    return screenOf(await this.ask<Status>(this.own, { type: "status" }));
  }

  // Installs the newest release, as the user asks in Settings, and looks
  // again at once. A service runs the release it was moved to, so `up`, from
  // the one just installed, moves it there with its sign-in.
  async install() {
    if (this.installing || override) return;
    this.installing = true;
    this.onChange();
    let failure = await failureOf("/bin/sh", ["-c", installer]);
    if (!failure && this.service && !signals(this.version ?? ""))
      failure = await failureOf(join(bin, "multidesktop"), [
        "up",
        "--wait",
        "0s",
      ]);
    this.installing = false;
    this.onChange();
    await this.poll();
    if (failure || !this.multidesktop().current)
      throw new Error(failure ?? "Multidesktop could not be installed.");
  }

  private run() {
    this.started = Date.now();
    const desktop = spawn(
      join(bin, "multidesktop"),
      ["--config", this.own, "--local"],
      { stdio: ["pipe", "ignore", "ignore"] },
    );
    this.desktop = desktop;
    desktop.on("error", () => {});
    desktop.stdin!.on("error", () => {});
    desktop.on("close", () => {
      if (this.desktop === desktop) this.desktop = null;
    });
  }

  // Ends OpenBots' own desktop, which closing its stdin does.
  private stop() {
    this.desktop?.stdin?.end();
    this.desktop = null;
  }

  private socket(config: string) {
    return new Promise<Socket>((done, fail) => {
      const socket = connect(config.replace(/\.toml$/, ".sock"));
      socket.once("connect", () => done(socket));
      socket.once("error", fail);
    });
  }

  private async ask<T>(config: string, question: object) {
    const socket = await this.socket(config);
    socket.end(`${JSON.stringify(question)}\n`);
    const answer = await lines(socket)();
    socket.destroy();
    if (!answer) throw new Error("Multidesktop did not answer.");
    return JSON.parse(answer) as T;
  }

  // Asks System Settings to let the bridge record the screen and control it.
  allow() {
    if (!this.config) return;
    spawn(join(bin, "multidesktop"), ["--config", this.config, "permissions"], {
      stdio: "ignore",
    })
      .on("error", () => {})
      .unref();
  }

  // Answers a window's WebRTC offer with a session of the desktop's, which
  // lasts until the window closes it or the desktop ends it. The desktop's
  // own addresses are in its answer; the window's, it learns from its checks.
  async view(sdp: string) {
    if (this.state !== "ready" || !this.config)
      throw new Error("This screen can't be shown.");
    const socket = await this.socket(this.config);
    socket.write('{"type":"signal"}\n');
    const next = lines(socket);
    const session = randomUUID();
    socket.write(
      `${JSON.stringify({ desktop: "local", sdp, session, type: "offer" })}\n`,
    );
    for (;;) {
      const line = await next();
      if (line === null) throw new Error("Multidesktop closed the session.");
      const signal = JSON.parse(line) as {
        type: string;
        session?: string;
        sdp?: string;
        reason?: string;
      };
      if (signal.session !== session) continue;
      if (signal.type === "close") {
        socket.destroy();
        throw new Error(signal.reason);
      }
      if (signal.type === "answer") {
        this.views.set(session, socket);
        socket.on("close", () => this.views.delete(session));
        // The connection is the session's: it goes once the session ends.
        void (async () => {
          for (let line = await next(); line !== null; line = await next())
            if ((JSON.parse(line) as { type: string }).type === "close") break;
          socket.destroy();
        })();
        return { session, sdp: signal.sdp! };
      }
    }
  }

  stopView(session: string) {
    this.views.get(session)?.destroy();
  }

  close() {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.cloudTimer) clearTimeout(this.cloudTimer);
    for (const socket of this.views.values()) socket.destroy();
    this.stop();
  }
}

// What a desktop's status says of its screen.
const screenOf = ({ missing, starting }: Status): Screen =>
  starting ? null : missing.length ? "blocked" : "ready";
