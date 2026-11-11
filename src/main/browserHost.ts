// The native messaging host Chrome starts for the Multibots extension, which
// Multibots runs as Node from the folder it set Chrome up with
// (src/main/browser.ts). It only passes messages between the extension's
// stdio, which Chrome frames with their length, and Multibots' private
// socket, a line each, after the socket's token. It imports nothing but
// Node's own modules, as it runs alone from that folder.
import { readFileSync } from "node:fs";
import { connect } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const folder = dirname(fileURLToPath(import.meta.url));

const frame = (line: string) => {
  const body = Buffer.from(line);
  const head = Buffer.alloc(4);
  head.writeUInt32LE(body.length);
  process.stdout.write(Buffer.concat([head, body]));
};

// Tells the extension why, then ends.
const fail = (error: string): never => {
  frame(JSON.stringify({ error }));
  process.stdout.end(() => process.exit(1));
  throw new Error(error);
};

const read = <T>(name: string, missing: string): T => {
  try {
    return JSON.parse(readFileSync(join(folder, name), "utf8")) as T;
  } catch {
    return fail(missing);
  }
};

// Chrome names the extension that started it first.
const { origin } = read<{ origin: string }>(
  "host.json",
  "Set up Chrome in Multibots' settings.",
);
if (process.argv[2] !== origin)
  fail("This extension is not the one Multibots set up.");
const { socket: path, token } = read<{ socket: string; token: string }>(
  "connection.json",
  "Open Multibots on this computer.",
);

const socket = connect(path);
socket.on("error", () => fail("Open Multibots on this computer."));
socket.on("close", () => process.exit(0));
socket.write(`${JSON.stringify({ token })}\n`);

let lines = "";
socket.setEncoding("utf8");
socket.on("data", (chunk: string) => {
  lines += chunk;
  for (let end = lines.indexOf("\n"); end >= 0; end = lines.indexOf("\n")) {
    frame(lines.slice(0, end));
    lines = lines.slice(end + 1);
  }
});

let input = Buffer.alloc(0);
process.stdin.on("data", (chunk: Buffer) => {
  input = Buffer.concat([input, chunk]);
  while (input.length >= 4) {
    const length = input.readUInt32LE(0);
    if (input.length < 4 + length) break;
    const message = input.subarray(4, 4 + length).toString();
    input = input.subarray(4 + length);
    // One line on the socket however the extension spaced it.
    socket.write(`${JSON.stringify(JSON.parse(message))}\n`);
  }
});
process.stdin.on("end", () => process.exit(0));
