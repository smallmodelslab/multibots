import { appsText, screenText } from "@wrkrsh/computer-use";
import {
  toolDescriptions,
  whiteboardEditSchema,
  type WhiteboardEdit,
} from "@wrkrsh/whiteboard/scene";
import { tool } from "ai";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

import type { BrowserTab } from "../shared/browser";
import { nextRun, type Schedule } from "../shared/schedule";
import type { Routine } from "../shared/types";
import type { Browser } from "./browser";
import { remoteShell, type Repls } from "./computer";

// What a shell command's output keeps: its start and its end, each half
// of this, however much it prints.
const outputLimit = 16_000;

// The shell a bot's commands run in: the system's own, which models write
// for, rather than whatever the user chose.
const windows = process.platform === "win32";
const shell = windows
  ? {
      args: ["-NoProfile", "-Command"],
      name: "PowerShell",
      path: "powershell.exe",
    }
  : process.platform === "darwin"
    ? { args: ["-lc"], name: "zsh", path: "/bin/zsh" }
    : { args: ["-lc"], name: "bash", path: "/bin/bash" };

// A command as the user, from the bot's folder, or in another computer's
// shell through Multidesktop. It runs in a process group of its own, so
// stopping it, or its time running out, ends everything it started too:
// asked first, then made to. It is done once its shell exits: what it left
// running, as a server it started in the background, may hold its output
// open, which is read a moment longer and then no more.
const runShell = (
  run: { file: string; args: string[] },
  cwd: string,
  timeoutSeconds: number,
  signal: AbortSignal | undefined,
) =>
  new Promise<{ exitCode: number | null; output: string }>((done) => {
    const child = spawn(run.file, run.args, {
      cwd,
      detached: !windows,
      env: process.env,
    });
    let stopped: string | null = null;
    const stop = (why: string) => {
      if (stopped || !child.pid) return;
      stopped = why;
      if (windows) {
        spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"]);
        return;
      }
      const group = -child.pid;
      const kill = (sig: NodeJS.Signals) => {
        try {
          process.kill(group, sig);
        } catch {
          // Already gone.
        }
      };
      kill("SIGTERM");
      setTimeout(() => kill("SIGKILL"), 2000).unref();
    };
    const timer = setTimeout(() => stop("timed out"), timeoutSeconds * 1000);
    const abort = () => stop("stopped");
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();

    const half = outputLimit / 2;
    let head = "";
    let tail = "";
    let total = 0;
    let settled = false;
    const take = (chunk: Buffer) => {
      if (settled) return;
      let text = chunk.toString();
      total += text.length;
      const room = half - head.length;
      if (room > 0) {
        head += text.slice(0, room);
        text = text.slice(room);
      }
      tail = (tail + text).slice(-half);
    };
    child.stdout.on("data", take);
    child.stderr.on("data", take);
    const settle = (exitCode: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      const left = total - head.length - tail.length;
      done({
        exitCode,
        output:
          (left > 0
            ? `${head}\n… ${left} characters left out …\n${tail}`
            : head + tail) + (stopped ? `\n(${stopped})` : ""),
      });
    };
    child.on("error", (error) => {
      take(Buffer.from(`\n${error.message}`));
      // It never started.
      if (!child.pid) settle(null);
    });
    child.on("exit", (exitCode) => {
      const end = () => settle(exitCode);
      child.once("close", end);
      setTimeout(end, 250);
    });
  });

const days = z
  .array(
    z.enum([
      "sunday",
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
      "friday",
      "saturday",
    ]),
  )
  .min(1);
const time = z
  .string()
  .regex(/^([01]\d|2[0-4]):[0-5]\d$/)
  .describe("24-hour time, HH:MM");

const scheduleInput = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("once"),
    at: z.string().describe("ISO 8601 date-time with its offset"),
  }),
  z.object({ kind: z.literal("weekly"), days, time }),
  z.object({
    kind: z.literal("every"),
    minutes: z.number().int().min(15).max(1440),
    days,
    from: time,
    until: time,
  }),
  z
    .object({ kind: z.literal("webhook") })
    .describe(
      "Whenever something POSTs to the routine's webhook, with what it sent",
    ),
]);

const minutesOf = (value: string) => {
  const [hours, minutes] = value.split(":").map(Number);
  return hours! * 60 + minutes!;
};

const dayNumbers = (names: z.infer<typeof days>) =>
  [...new Set(names)]
    .map((name) => days.element.options.indexOf(name))
    .sort((a, b) => a - b);

const scheduleOf = (input: z.infer<typeof scheduleInput>): Schedule => {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (input.kind === "webhook") return input;
  if (input.kind === "once") {
    const at = Date.parse(input.at);
    if (Number.isNaN(at)) throw new Error("schedule.at is not a date-time.");
    if (at <= Date.now()) throw new Error("schedule.at has passed.");
    return { at, kind: "once" };
  }
  if (input.kind === "weekly") {
    const minutes = minutesOf(input.time);
    return {
      days: dayNumbers(input.days),
      hour: Math.floor(minutes / 60) % 24,
      kind: "weekly",
      minute: minutes % 60,
      timeZone,
    };
  }
  const from = minutesOf(input.from);
  const until = minutesOf(input.until);
  if (until <= from)
    throw new Error("schedule.until must be later in the day than from.");
  return {
    days: dayNumbers(input.days),
    from,
    kind: "every",
    minutes: input.minutes,
    timeZone,
    until,
  };
};

// A tool's input, with the computer it acts on among the user's others
// when there are any: one of them, or this server when left out unless
// `required`.
const onComputer = <T extends z.ZodRawShape>(
  shape: T,
  others: string[],
  what: string,
  required = false,
) => {
  const named = z
    .enum(others as [string, ...string[]])
    .describe(
      required
        ? `Which of the user's computers to ${what}`
        : `Another of the user's computers to ${what}; leave it out for this server`,
    );
  return z.object(
    others.length
      ? { ...shape, computer: required ? named : named.optional() }
      : shape,
  ) as unknown as z.ZodType<
    z.output<z.ZodObject<T>> & { computer?: string },
    z.input<z.ZodObject<T>> & { computer?: string }
  >;
};

const browserActions = [
  "tabs",
  "open",
  "navigate",
  "back",
  "close",
  "snapshot",
  "click",
  "type",
  "press",
  "screenshot",
  "scroll_capture",
] as const;

const tabLine = ({ tab, title, url }: BrowserTab) =>
  `Tab ${tab}: ${title || "(untitled)"} — ${url}`;

// How much of a long page's text a result shows; all of it is in the
// bot's folder.
const capturedTextLimit = 40_000;

// The tabs a bot uses in the user's Chrome, through the OpenBots extension.
type BotBrowser = {
  bot: string;
  name: string;
  send: Browser["send"];
  onUse: () => void;
};

const browserTool = (
  { bot, name, onUse, send }: BotBrowser,
  folder: string,
  here: string,
) =>
  tool({
    description: `Use tabs of your own in the user's Chrome on ${here}, signed in to the sites the user is signed in to; the user's own tabs stay out of reach. Actions:
tabs lists yours. open {url} opens one. navigate {tab, url}, back {tab}, close {tab}.
snapshot {tab, ref?} returns the page as an outline of its elements, each with its [ref], or only the part under ref.
click {tab, ref, or x and y}. type {tab, ref?, text, submit?} types in place of what the field held, or where the focus is without ref; submit presses Enter after. press {tab, key} such as "Enter", "Escape" or "Control+A".
screenshot {tab} attaches the tab's viewport; its points are what click takes as x and y.
scroll_capture {tab, ref or x and y?, maxSteps?} reads a long page, or the list that scrolls at ref or at x and y, whole: it scrolls from the top to the end, or maxSteps steps (100 by default), waits for what loads at each, and returns each line of text once, how far it scrolled and whether it reached the end, with pictures of it kept in your folder. Use it rather than scrolling and reading yourself.`,
    inputSchema: z.object({
      action: z.enum(browserActions),
      tab: z.number().int().optional(),
      url: z.string().optional(),
      ref: z
        .number()
        .int()
        .optional()
        .describe("An element's ref from the tab's snapshot"),
      x: z.number().optional(),
      y: z.number().optional(),
      text: z.string().optional(),
      submit: z.boolean().optional(),
      key: z.string().optional(),
      maxSteps: z.number().int().min(2).max(300).optional(),
    }),
    execute: async (input): Promise<{ text: string; images: string[] }> => {
      const { action, key, maxSteps, ref, submit, text, url, x, y } = input;
      onUse();
      const need = <T>(value: T | undefined, what: string) => {
        if (value === undefined) throw new Error(`${action} needs ${what}.`);
        return value;
      };
      const said = (text: string, images: string[] = []) => ({ images, text });
      if (action === "tabs") {
        const tabs = await send({ action, bot });
        return said(tabs.map(tabLine).join("\n") || "You have no tabs open.");
      }
      if (action === "open")
        return said(
          tabLine(await send({ action, bot, name, url: need(url, "url") })),
        );
      const tab = need(input.tab, "tab");
      switch (action) {
        case "navigate":
          return said(
            tabLine(await send({ action, bot, tab, url: need(url, "url") })),
          );
        case "back":
          return said(tabLine(await send({ action, bot, tab })));
        case "close":
          await send({ action, bot, tab });
          return said(`Closed tab ${tab}.`);
        case "screenshot": {
          const shot = await send({ action, bot, tab });
          return said(`${tabLine(shot)}\n${shot.width}×${shot.height}`, [
            shot.image,
          ]);
        }
        case "snapshot": {
          const page = await send({ action, bot, ref, tab });
          return said(`${tabLine(page)}\n${page.outline}`);
        }
        case "click":
          return said(tabLine(await send({ action, bot, ref, tab, x, y })));
        case "type":
          return said(
            tabLine(
              await send({
                action,
                bot,
                ref,
                submit,
                tab,
                text: need(text, "text"),
              }),
            ),
          );
        case "press":
          return said(
            tabLine(await send({ action, bot, key: need(key, "key"), tab })),
          );
        case "scroll_capture": {
          const read = await send(
            { action, bot, maxSteps, ref, tab, x, y },
            600_000,
          );
          const stamp = new Date().toISOString().replace(/[:.]/g, "-");
          const captures = join(folder, "captures");
          await mkdir(captures, { recursive: true });
          const names = read.images.map((_, index) =>
            read.images.length === 1
              ? `captures/${stamp}.png`
              : `captures/${stamp}-${index + 1}.png`,
          );
          await Promise.all([
            ...read.images.map((image, index) =>
              writeFile(
                join(folder, names[index]!),
                Buffer.from(image, "base64"),
              ),
            ),
            writeFile(join(captures, `${stamp}.txt`), read.text.join("\n")),
          ]);
          const all = read.text.join("\n");
          return said(
            [
              tabLine(read),
              `Scrolled ${read.scrolled} of ${read.total} pixels in ${read.steps} steps; ${read.reachedEnd ? "reached the end" : "did not reach the end"}. ${read.text.length} lines of text, each once:`,
              all.length > capturedTextLimit
                ? `${all.slice(0, capturedTextLimit)}\n… the rest is in captures/${stamp}.txt`
                : all,
              `Pictures: ${names.join(", ")}`,
            ].join("\n"),
            read.images.slice(0, 2),
          );
        }
      }
    },
    toModelOutput: ({ output }) => ({
      type: "content",
      value: [
        { text: output.text, type: "text" as const },
        ...output.images.map((data) => ({
          data: { data, type: "data" as const },
          mediaType: "image/png",
          type: "file" as const,
        })),
      ],
    }),
  });

// What a bot does with its server and the user's other computers: their
// shells, their screens when it can use them, the user's Chrome when it is
// connected, its routines, and the whiteboard it shares with the user.
export const botTools = ({
  browser,
  folder,
  here,
  onCommand,
  onRoutines,
  others,
  repls,
  routines,
  screen,
  whiteboard,
}: {
  // This server's Chrome, for the bot (by id, and its name for the user),
  // when it is connected.
  browser: BotBrowser | null;
  folder: string;
  // This server's name, and the user's other computers', which Multidesktop
  // reaches.
  here: string;
  others: string[];
  // Whether this server's screen can be used.
  screen: boolean;
  onCommand: (command: string) => void;
  onRoutines: (routines: Routine[]) => Promise<void>;
  // Its REPLs, started at the computer tool's first use.
  repls: () => Repls;
  routines: () => Routine[];
  whiteboard: {
    view: (
      signal?: AbortSignal,
    ) => Promise<{ image: string | null; text: string }>;
    edit: (edit: WhiteboardEdit) => Promise<{ added: string[]; text: string }>;
  };
}) => {
  const change = async (next: Routine[]) => {
    await onRoutines(next);
    return next.map(({ id, title }) => ({ id, title }));
  };
  return {
    shell: tool({
      description: `Run a ${shell.name} command on this server, ${here}, starting in your folder${others.length ? `, or a command in the shell of another of the user's computers: ${others.join(", ")}` : ""}. Returns its exit code and output.`,
      inputSchema: onComputer(
        {
          command: z.string(),
          timeoutSeconds: z.number().int().min(1).max(3600).default(120),
        },
        others,
        "run it on",
      ),
      execute: async (
        { command, computer, timeoutSeconds },
        { abortSignal },
      ) => {
        onCommand(computer ? `${computer}: ${command}` : command);
        return runShell(
          computer
            ? remoteShell(computer, command)
            : { args: [...shell.args, command], file: shell.path },
          folder,
          timeoutSeconds,
          abortSignal,
        );
      },
    }),
    ...((screen || others.length > 0) && {
      computer: tool({
        description: `Run JavaScript that sees and uses a computer's screen: \`computer\` is the main display of ${screen ? `this server, ${here}` : "the computer you name"}${screen && others.length ? ", or of the computer you name" : ""}, with these methods. Await each.
${screenText}
${appsText}
Top-level await; variables last until your run ends. console.log(value) adds text to the result. The user may be using the screen.`,
        inputSchema: onComputer(
          {
            code: z.string().min(1),
            timeoutSeconds: z.number().int().min(1).max(120).default(30),
          },
          others,
          "use the screen of",
          !screen,
        ),
        execute: ({ code, computer, timeoutSeconds }, { abortSignal }) =>
          repls().run(
            computer ?? null,
            code,
            timeoutSeconds * 1000,
            abortSignal,
          ),
        toModelOutput: ({ output }) => ({
          type: "content",
          value: output.content.map((part) =>
            part.type === "image"
              ? {
                  data: { data: part.data, type: "data" },
                  mediaType: part.mimeType,
                  type: "file",
                }
              : { text: part.text, type: "text" },
          ),
        }),
      }),
    }),
    ...(browser && { browser: browserTool(browser, folder, here) }),
    set_routine: tool({
      description:
        "Create a routine that wakes you on a schedule, or when its webhook is called, with its instructions, or replace one by its id.",
      inputSchema: z.object({
        id: z
          .string()
          .optional()
          .describe(
            "Only to replace one of your routines; leave it out to create one",
          ),
        title: z.string().min(1).max(100),
        instructions: z.string().min(1).max(2000),
        schedule: scheduleInput,
        enabled: z
          .boolean()
          .optional()
          .describe(
            "false to leave it paused, for the user to turn on among your details",
          ),
      }),
      execute: async ({
        enabled = true,
        id,
        instructions,
        schedule,
        title,
      }) => {
        const parsed = scheduleOf(schedule);
        const routine: Routine = {
          enabled,
          id: id ?? randomUUID(),
          instructions,
          nextRunAt: nextRun(parsed, Date.now()),
          schedule: parsed,
          title,
        };
        const current = routines();
        if (id && !current.some((each) => each.id === id))
          throw new Error(`No routine has the id ${id}.`);
        if (!id && current.length >= 20)
          throw new Error("A bot has at most 20 routines.");
        return change(
          id
            ? current.map((each) => (each.id === id ? routine : each))
            : [...current, routine],
        );
      },
    }),
    delete_routine: tool({
      description: "Delete one of your routines by its id.",
      inputSchema: z.object({ id: z.string() }),
      execute: async ({ id }) =>
        change(routines().filter((routine) => routine.id !== id)),
    }),
    view_whiteboard: tool({
      description: toolDescriptions.view,
      inputSchema: z.object({}),
      execute: (_input, { abortSignal }) => whiteboard.view(abortSignal),
      toModelOutput: ({ output }) => ({
        type: "content",
        value: [
          { text: output.text, type: "text" },
          ...(output.image
            ? [
                {
                  data: { data: output.image, type: "data" as const },
                  mediaType: "image/png",
                  type: "file" as const,
                },
              ]
            : []),
        ],
      }),
    }),
    edit_whiteboard: tool({
      description: toolDescriptions.edit,
      inputSchema: z.fromJSONSchema(
        whiteboardEditSchema as Parameters<typeof z.fromJSONSchema>[0],
      ) as z.ZodType<WhiteboardEdit>,
      execute: (edit) => whiteboard.edit(edit),
    }),
  };
};
