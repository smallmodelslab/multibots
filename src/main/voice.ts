import { randomUUID } from "node:crypto";

import { codex, headers, type Tokens } from "./codex";
import { inOrder } from "./fallback";
import type { OwnVoice } from "./ownModels";
import { synthesize, transcribe } from "./ownServer";

// A voice chat with a bot: on ChatGPT, or on the user's own models.
//
// On ChatGPT, it is placed as Codex (0.166) places its voice mode on a
// ChatGPT account. The window's WebRTC offer makes a call at Codex's
// endpoint, which answers it and names the call. A socket joined to the call
// then hears what the user asks for, which the voice hands on to the bot
// ("delegation"), and takes what the bot says, for the voice to say. The
// audio itself goes between the window and OpenAI: the bot's computer only
// places the call and keeps the socket.
//
// The voice keeps the instructions ChatGPT gives it: a call ignores others
// and refuses to change them. What it should know of the bot goes in as a
// message ahead of the conversation instead.

const model = "gpt-live-1-codex";
// What the bot says goes to the call in pieces of at most this many bytes,
// as Codex sends it.
const pieceBytes = 500;

// Node's WebSocket takes headers, which the browser's does not.
const Socket = WebSocket as unknown as new (
  url: string,
  init: { headers: Record<string, string> },
) => WebSocket;

export type Clip = { audio: string; type: string };

export type VoiceCall = {
  id: string;
  // What the bot says goes to the call, said in the voice's own words on
  // ChatGPT and read out as it is on the user's own models.
  speak: (text: string) => void;
  close: () => void;
} & (
  | {
      kind: "chatgpt";
      // The call's answer to the offer.
      sdp: string;
    }
  | {
      kind: "own";
      // Something the user said, as WAV.
      hear: (wav: Buffer) => Promise<void>;
      // The next thing the bot says; null after a while without one.
      listen: () => Promise<Clip | null>;
    }
);

type Handlers = {
  // The user asked the bot something.
  onAsk: (text: string) => void;
  onError: (message: string) => void;
  onEnd: () => void;
};

const pieces = (text: string) => {
  const found = [""];
  let bytes = 0;
  for (const char of text) {
    const size = Buffer.byteLength(char);
    if (bytes + size > pieceBytes) {
      found.push("");
      bytes = 0;
    }
    found[found.length - 1] += char;
    bytes += size;
  }
  return found;
};

export const startVoiceCall = async (
  tokens: Tokens,
  options: Handlers & {
    sdp: string;
    // What the voice should know, ahead of the conversation.
    context: string;
    voice: string;
  },
): Promise<VoiceCall> => {
  const callHeaders = {
    ...headers(tokens),
    "openai-alpha": "quicksilver=v2",
    "x-session-id": randomUUID(),
  };
  const response = await fetch(
    `${codex}/realtime/calls?intent=quicksilver&architecture=avas`,
    {
      body: JSON.stringify({
        sdp: options.sdp,
        session: {
          audio: { output: { voice: options.voice } },
          delegation: { type: "client" },
          initial_items: [
            {
              content: [{ text: options.context, type: "input_text" }],
              role: "developer",
              type: "message",
            },
          ],
          model,
        },
      }),
      headers: { ...callHeaders, "content-type": "application/json" },
      method: "POST",
    },
  );
  const answer = await response.text();
  if (!response.ok)
    throw new Error(
      `ChatGPT voice chat failed: ${response.status} ${answer.slice(0, 300)}`,
    );
  const id = response.headers.get("location")?.split("?")[0]?.split("/").pop();
  if (!id) throw new Error("ChatGPT answered the voice chat without a call.");

  const socket = new Socket(`wss://api.openai.com/v1/live/${id}`, {
    headers: callHeaders,
  });
  await new Promise((done, fail) => {
    socket.onopen = done;
    socket.onerror = () =>
      fail(new Error("ChatGPT voice chat refused this computer's socket."));
  });
  socket.onerror = null;
  socket.onclose = options.onEnd;
  socket.onmessage = ({ data }) => {
    const event = JSON.parse(String(data)) as {
      type: string;
      item?: {
        type?: string;
        target?: string;
        content?: { type: string; text?: string }[];
      };
      error?: { message?: string };
      message?: string;
    };
    if (
      event.type === "delegation.created" &&
      event.item?.type === "delegation" &&
      event.item.target === "client"
    ) {
      const text = (event.item.content ?? [])
        .flatMap((part) => (part.type === "input_text" ? [part.text] : []))
        .join("")
        .trim();
      if (text) options.onAsk(text);
    } else if (event.type === "error")
      options.onError(
        event.error?.message ?? event.message ?? JSON.stringify(event),
      );
  };
  return {
    close: () => {
      if (socket.readyState === WebSocket.OPEN)
        socket.send(JSON.stringify({ type: "session.close" }));
      socket.close();
    },
    id,
    kind: "chatgpt",
    sdp: answer,
    speak: (text) => {
      if (socket.readyState !== WebSocket.OPEN) return;
      for (const piece of pieces(text))
        socket.send(
          JSON.stringify({
            channel: "speakable",
            content: [{ text: piece, type: "input_text" }],
            type: "session.context.append",
          }),
        );
    },
  };
};

// How long a listen waits for the bot to say something, and how long the
// window may go without listening before the call counts as hung up: it
// always listens while it is in the call.
const listenMs = 20_000;
const goneMs = 60_000;

// What a bot writes, as it is read aloud: no Markdown marks, and a link as
// its words.
const speakable = (text: string) =>
  text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`#>|~]/g, "")
    .trim();

// A voice chat on the user's own models: the window sends what the user
// says, which the first transcription model that answers writes down and
// hands to the bot, and listens for what the bot says, which the first
// speech model that answers reads out, in order, in the bot's voice where
// that model offers it. The call ends when the window hangs up or stops
// listening, or when no speech model answers, which it says.
export const startOwnVoiceCall = (
  models: OwnVoice,
  options: Handlers & { voice: string | null; slow: boolean },
): VoiceCall => {
  const clips: Clip[] = [];
  let waiting: ((clip: Clip | null) => void) | null = null;
  let closed = false;
  let saying = Promise.resolve();
  let gone: NodeJS.Timeout | undefined;
  const close = () => {
    if (closed) return;
    closed = true;
    clearTimeout(gone);
    waiting?.(null);
    options.onEnd();
  };
  const unheard = () => {
    clearTimeout(gone);
    gone = setTimeout(close, goneMs);
  };
  unheard();
  const nameOf = ({ model }: { model: string }) => model;
  return {
    close,
    hear: async (wav) => {
      const text = await inOrder(
        models.transcription,
        nameOf,
        (each) => transcribe(each, each.model, wav),
        () => closed,
      );
      if (text && !closed) options.onAsk(text);
    },
    id: randomUUID(),
    kind: "own",
    listen: () => {
      const next = clips.shift();
      if (closed || next) return Promise.resolve(next ?? null);
      waiting?.(null);
      clearTimeout(gone);
      return new Promise((done) => {
        const answer = (clip: Clip | null) => {
          clearTimeout(timer);
          if (waiting === answer) waiting = null;
          if (!closed) unheard();
          done(clip);
        };
        const timer = setTimeout(() => answer(null), listenMs);
        waiting = answer;
      });
    },
    speak: (text) => {
      const words = speakable(text);
      if (!words) return;
      saying = saying.then(async () => {
        if (closed) return;
        const spoken = await inOrder(
          models.speech,
          nameOf,
          (each) =>
            synthesize(each, {
              model: each.model,
              slow: options.slow,
              text: words,
              voice:
                options.voice && each.voices.includes(options.voice)
                  ? options.voice
                  : each.defaultVoice,
            }),
          () => closed,
        ).catch((error: unknown) => {
          // Hung up first, so that what it says is not spoken in turn.
          close();
          options.onError(
            error instanceof Error ? error.message : String(error),
          );
          return null;
        });
        if (!spoken || closed) return;
        const clip = {
          audio: spoken.audio.toString("base64"),
          type: spoken.type,
        };
        if (waiting) waiting(clip);
        else clips.push(clip);
      });
    },
  };
};
