import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
  APICallError,
  wrapLanguageModel,
  type LanguageModelMiddleware,
} from "ai";

import { defaultContextWindow } from "../shared/types";
import type { CallableModel } from "./codex";

// A model the user hosts behind an OpenAI-style API (vLLM, SGLang, Ollama,
// LM Studio, llama.cpp, LiteLLM, or a provider such as OpenRouter or
// OpenAI's own): its address, the model's id and, when the server takes one,
// a key. Bots run on its chat completions; voice chats hear the user with
// its transcriptions and speak with its speech, as open speech models such
// as Ming's are served. This computer calls it itself. Fetch only.

export type OwnServer = { baseUrl: string; key: string | null };

export type ServedModel = { contextWindow: number | null; id: string };

const timeoutMs = 15_000;
// What a speech server says at most at once, as OpenAI's takes.
export const speechChars = 4_000;

// The voices of OpenAI's speech, which servers that list none and need one
// mostly take too.
const openaiVoices = [
  "alloy",
  "ash",
  "ballad",
  "cedar",
  "coral",
  "echo",
  "fable",
  "marin",
  "nova",
  "onyx",
  "sage",
  "shimmer",
  "verse",
];

// The address as the API's base: no query, fragment or credentials (the key
// has its own field), and no trailing slash.
export const baseUrlOf = (address: string) => {
  let url: URL;
  try {
    url = new URL(address.trim());
  } catch {
    throw new Error(
      "That isn't an address. It looks like http://localhost:8000/v1.",
    );
  }
  if (url.protocol !== "https:" && url.protocol !== "http:")
    throw new Error("The address must start with https:// or http://.");
  if (url.username || url.password)
    throw new Error("Put the key in its own field, not in the address.");
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
};

const authorization = (key: string | null): Record<string, string> =>
  key ? { authorization: `Bearer ${key}` } : {};

// A call to the server, its failures said in a person's words, given up
// once `signal` stops it.
const request = async (
  server: OwnServer,
  path: string,
  init: RequestInit = {},
  timeout = timeoutMs,
  signal?: AbortSignal,
) => {
  const host = new URL(server.baseUrl).host;
  let response: Response;
  try {
    response = await fetch(`${server.baseUrl}${path}`, {
      ...init,
      headers: { ...authorization(server.key), ...init.headers },
      signal: AbortSignal.any([
        AbortSignal.timeout(timeout),
        ...(signal ? [signal] : []),
      ]),
    });
  } catch (error) {
    if (signal?.aborted) throw signal.reason;
    throw new Error(
      error instanceof DOMException && error.name === "TimeoutError"
        ? `${host} didn't answer in ${timeout / 1_000} seconds.`
        : `${host} didn't answer: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!response.ok)
    throw new Error(
      response.status === 401 || response.status === 403
        ? `${host} turned the key down (${response.status}).`
        : `${host} answered ${response.status}: ${(await response.text()).slice(0, 200)}`,
    );
  return response;
};

// Where servers say how long a model's context is: vLLM's max_model_len,
// OpenRouter's and LM Studio's context_length.
const windowOf = (model: Record<string, unknown>) => {
  for (const field of [
    "max_model_len",
    "context_length",
    "context_window",
    "max_context_length",
  ]) {
    const value = model[field];
    if (typeof value === "number" && value > 0) return value;
  }
  return null;
};

// The models the server serves (its /models).
export const listServedModels = async (
  server: OwnServer,
  signal?: AbortSignal,
): Promise<ServedModel[]> => {
  const body = (await (
    await request(server, "/models", {}, timeoutMs, signal)
  )
    .json()
    .catch(() => null)) as { data?: unknown } | null;
  if (!Array.isArray(body?.data))
    throw new Error(
      `${new URL(server.baseUrl).host} isn't an OpenAI-style API: ${server.baseUrl}/models has no list of models.`,
    );
  return (body.data as Record<string, unknown>[]).flatMap((model) =>
    typeof model?.id === "string"
      ? [{ contextWindow: windowOf(model), id: model.id }]
      : [],
  );
};

// The voices a speech server offers for the model, as vLLM-Omni, Kokoro
// and mlx-audio list them.
const listVoices = async (
  server: OwnServer,
  model: string,
  signal?: AbortSignal,
) => {
  const body = (await request(
    server,
    `/audio/voices?model=${encodeURIComponent(model)}`,
    {},
    timeoutMs,
    signal,
  )
    .then((response) => response.json())
    .catch(() => null)) as {
    data?: unknown;
    voices?: unknown;
  } | null;
  return (
    Array.isArray(body?.voices)
      ? body.voices
      : Array.isArray(body?.data)
        ? body.data
        : []
  ).flatMap((voice: unknown) => {
    const name =
      typeof voice === "string"
        ? voice
        : ((voice as { id?: unknown; name?: unknown } | null)?.id ??
          (voice as { name?: unknown } | null)?.name);
    return typeof name === "string" ? [name] : [];
  });
};

// The voices bots may pick on a speech model, and the one a bot that picks
// none speaks in: none, so the server's own, when it speaks without one as
// Ming's does; else the first it offers, or OpenAI's. Saying a word checks
// that it speaks at all.
export const speechVoices = async (
  server: OwnServer,
  model: string,
  signal?: AbortSignal,
) => {
  const listed = await listVoices(server, model, signal);
  const says = (voice: string | null) =>
    synthesize(server, { model, slow: false, text: "Hello.", voice }, signal);
  if (
    await says(null).then(
      () => true,
      () => false,
    )
  )
    return { defaultVoice: null as string | null, voices: listed };
  signal?.throwIfAborted();
  const voices = listed.length ? listed : openaiVoices;
  await says(voices[0]!);
  return { defaultVoice: voices[0]! as string | null, voices };
};

type Prompt = Parameters<
  NonNullable<LanguageModelMiddleware["transformParams"]>
>[0]["params"]["prompt"];
type UserContent = Extract<Prompt[number], { role: "user" }>["content"];

const hasImages = (prompt: Prompt) =>
  prompt.some(
    (message) =>
      message.role === "user" &&
      message.content.some(
        (part) => part.type === "file" && part.mediaType.startsWith("image/"),
      ),
  );

const withoutImages = (prompt: Prompt): Prompt =>
  prompt.map((message) =>
    message.role === "user"
      ? {
          ...message,
          content: message.content.map((part) =>
            part.type === "file" && part.mediaType.startsWith("image/")
              ? { text: "[An image this model can't see]", type: "text" }
              : part,
          ),
        }
      : message,
  );

// The models connected, by their ids in Settings, that turned down a
// request for its images and took it without them: their requests carry a
// note for each image.
const textOnly = new Set<string>();

// Chat completions take only text in a tool's result, and none of the
// tools a provider runs itself: the screenshots the computer tool returns go
// to the model in a message of the user's after it, and ChatGPT's web
// searches, from a run that fell back from it or an earlier one, are left
// out of what it said. A model that takes no images, as many served ones
// don't, gets a note in each one's place once it turns them down.
const chatCompletions = (id: string): LanguageModelMiddleware => ({
  transformParams: async ({ params }) => ({
    ...params,
    prompt: params.prompt.flatMap((message): Prompt => {
      if (message.role === "assistant") {
        const content = message.content.filter(
          (part) =>
            part.type !== "tool-result" &&
            !(part.type === "tool-call" && part.providerExecuted),
        );
        return content.length ? [{ ...message, content }] : [];
      }
      if (message.role !== "tool") return [message];
      const images: UserContent = [];
      const content = message.content.map((part) => {
        if (part.type !== "tool-result" || part.output.type !== "content")
          return part;
        const text: string[] = [];
        for (const piece of part.output.value)
          if (piece.type === "text") text.push(piece.text);
          else if (piece.type === "file") images.push(piece);
        return {
          ...part,
          output: { type: "text" as const, value: text.join("\n") },
        };
      });
      return [
        { ...message, content },
        ...(images.length ? [{ content: images, role: "user" as const }] : []),
      ];
    }),
  }),
  wrapGenerate: async ({ doGenerate, model, params }) => {
    const blind = { ...params, prompt: withoutImages(params.prompt) };
    if (textOnly.has(id)) return model.doGenerate(blind);
    try {
      return await doGenerate();
    } catch (error) {
      if (
        !hasImages(params.prompt) ||
        !APICallError.isInstance(error) ||
        [401, 403, 429].includes(error.statusCode ?? 0)
      )
        throw error;
      const answered = await Promise.resolve(model.doGenerate(blind)).catch(
        () => {
          throw error;
        },
      );
      textOnly.add(id);
      return answered;
    }
  },
});

// The context windows the models connected last said, by their ids in
// Settings, for when their servers don't answer.
const reported = new Map<string, number>();

// The bots' model: the server's chat completions, with the context window
// the user gave the model, else the one the server says it has now, else
// the one it said last.
export const ownChatModel = async (
  saved: OwnServer & {
    id: string;
    model: string;
    window: number | null;
    contextWindow: number | null;
  },
  signal?: AbortSignal,
): Promise<CallableModel> => {
  const said = saved.window
    ? null
    : (await listServedModels(saved, signal).catch(() => [])).find(
        ({ id }) => id === saved.model,
      )?.contextWindow;
  if (said) reported.set(saved.id, said);
  const contextWindow =
    saved.window ??
    reported.get(saved.id) ??
    saved.contextWindow ??
    defaultContextWindow;
  return {
    about: `${saved.model}, a model the user hosts`,
    contextWindow,
    model: wrapLanguageModel({
      middleware: chatCompletions(saved.id),
      model: createOpenAICompatible({
        apiKey: saved.key ?? undefined,
        baseURL: saved.baseUrl,
        includeUsage: true,
        name: "own",
      }).chatModel(saved.model),
    }),
    providerOptions: {},
    tools: {},
  };
};

// What the user said, in words: the server's transcriptions of a WAV.
export const transcribe = async (
  server: OwnServer,
  model: string,
  wav: Buffer,
) => {
  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array(wav)], { type: "audio/wav" }),
    "speech.wav",
  );
  form.append("model", model);
  form.append("response_format", "json");
  const body = (await (
    await request(
      server,
      "/audio/transcriptions",
      { body: form, method: "POST" },
      60_000,
    )
  ).json()) as { text?: unknown };
  return typeof body.text === "string" ? body.text.trim() : "";
};

// What the bot says, spoken: the server's speech of at most speechChars, as
// WAV unless it gives another kind.
export const synthesize = async (
  server: OwnServer,
  options: {
    model: string;
    text: string;
    // Null for the server's own.
    voice: string | null;
    slow: boolean;
  },
  signal?: AbortSignal,
) => {
  const response = await request(
    server,
    "/audio/speech",
    {
      body: JSON.stringify({
        input: options.text,
        model: options.model,
        response_format: "wav",
        ...(options.voice ? { voice: options.voice } : {}),
        ...(options.slow ? { speed: 0.85 } : {}),
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
    60_000,
    signal,
  );
  return {
    audio: Buffer.from(await response.arrayBuffer()),
    type: response.headers.get("content-type") ?? "audio/wav",
  };
};
