import {
  execFile,
  spawn,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

import { linuxAccessibility, windowsHelper } from "./native";

// The native helpers as a Node process starts them: the macOS helper (or an
// app answering the same, as Multiwork Computer Use does), the Windows
// helper, and the Linux script.

// A request that outlives this has hung the helper, which is then restarted.
const requestTimeoutMs = 120_000;

type Pending = {
  resolve(reply: Record<string, unknown>): void;
  reject(error: Error): void;
};

export type HelperLog = (message: string, fields: Record<string, unknown>) => void;

// A helper process asked one JSON object per line on stdin, answering each
// with a line on stdout with the same id: {"id", "ok": true, ...} or {"id",
// "ok": false, "error"}. Started on first use, and again on the next request
// whenever it stops; closing its stdin lets it finish what it was asked and
// quit.
export class Helper {
  private running: {
    child: ChildProcessWithoutNullStreams;
    pending: Map<number, Pending>;
  } | null = null;
  private nextId = 1;
  private closed = false;

  constructor(
    private readonly name: string,
    private readonly command: () => { args: string[]; file: string },
    private readonly log: HelperLog = () => undefined,
  ) {}

  private start() {
    if (this.closed) throw new Error(`${this.name} has closed.`);
    if (this.running) return this.running;
    const { args, file } = this.command();
    const child = spawn(file, args, { stdio: "pipe", windowsHide: true });
    const pending = new Map<number, Pending>();
    const running = { child, pending };
    this.running = running;
    const stop = (reason: string) => {
      if (this.running === running) this.running = null;
      for (const request of pending.values())
        request.reject(new Error(`${this.name} ${reason}.`));
      pending.clear();
    };
    createInterface({ input: child.stdout }).on("line", (line) => {
      let reply: { id?: number; ok?: boolean; error?: string };
      try {
        reply = JSON.parse(line) as typeof reply;
      } catch {
        this.log("unreadable helper reply", { helper: this.name, line });
        return;
      }
      const request = reply.id === undefined ? null : pending.get(reply.id);
      if (!request) return;
      pending.delete(reply.id!);
      if (reply.ok) request.resolve(reply as Record<string, unknown>);
      else request.reject(new Error(reply.error ?? `${this.name} failed.`));
    });
    createInterface({ input: child.stderr }).on("line", (line) => {
      this.log("helper", { helper: this.name, line });
    });
    child.stdin.on("error", () => undefined);
    child.on("error", (error) => {
      this.log("helper did not start", {
        error: error.message,
        helper: this.name,
      });
      stop(`did not start: ${error.message}`);
    });
    child.on("exit", (code, signal) => {
      this.log("helper stopped", { code, helper: this.name, signal });
      stop("stopped");
    });
    return running;
  }

  request(type: string, fields: Record<string, unknown> = {}) {
    const { child, pending } = this.start();
    const id = this.nextId++;
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        child.kill();
        reject(new Error(`${this.name} stopped answering.`));
      }, requestTimeoutMs);
      pending.set(id, {
        resolve: (reply) => {
          clearTimeout(timer);
          resolve(reply);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      child.stdin.write(`${JSON.stringify({ ...fields, id, type })}\n`);
    });
  }

  // For good: the helper finishes what it was asked and quits.
  close() {
    this.closed = true;
    this.running?.child.stdin.end();
    this.running = null;
  }
}

// A script written once to the temporary directory, named by its content.
const scriptFile = (extension: string, script: string, bom = "") => {
  const hash = createHash("sha256").update(script).digest("hex").slice(0, 12);
  const file = join(tmpdir(), `computer-use-${hash}.${extension}`);
  if (!existsSync(file)) writeFileSync(file, `${bom}${script}`, "utf8");
  return file;
};

// The Windows helper, run by PowerShell from a file with the BOM that tells
// it the file is UTF-8.
export const windowsHelperCommand = () => ({
  args: [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    scriptFile("ps1", windowsHelper, "\uFEFF"),
  ],
  file: "powershell.exe",
});

// Asks the Linux accessibility script on this machine.
export const askLinux = <T = Record<string, unknown>>(
  request: Record<string, unknown>,
) =>
  new Promise<T>((resolve, reject) => {
    execFile(
      "python3",
      [scriptFile("py", linuxAccessibility), JSON.stringify(request)],
      { maxBuffer: 64 * 1024 * 1024, timeout: requestTimeoutMs },
      (error, stdout) => {
        let reply: { ok?: boolean; error?: string } | undefined;
        try {
          reply = JSON.parse(stdout) as typeof reply;
        } catch {
          reply = undefined;
        }
        if (reply?.ok) resolve(reply as T);
        else
          reject(
            new Error(
              reply?.error ??
                `The accessibility script failed: ${error?.message ?? "no answer"}`,
            ),
          );
      },
    );
  });
