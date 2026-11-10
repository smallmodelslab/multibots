import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { wrapLanguageModel, type LanguageModelMiddleware } from "ai";

import type { CallableModel } from "./codex";

// A model the user hosts behind an OpenAI-style API (vLLM, SGLang, Ollama,
// LM Studio, llama.cpp, LiteLLM, or a provider such as OpenRouter or
// OpenAI's own): its address, the model's id and, when the server takes one,
// a key. Bots run on its chat completions; voice chats hear the user with
// its transcriptions and speak with its speech, as open speech models such
// as Ming's are served. This computer calls it itself. Fetch only.

export type OwnServer = { baseUrl: string; key: string | null };

export type ServedModel = { contextWindow: number | null; id: string };

// Assumed when the server does not say.
export const defaultContextWindow = 128_000;

const timeoutMs = 15_000;
// What a speech server says at most at once, as OpenAI's takes.
const speechChars = 4_000;

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

// A call to the server, its failures said in a person's words.
const request = async (
  server: OwnServer,
  path: string,
  init: RequestInit = {},
  timeout = timeoutMs,
) => {
  const host = new URL(server.baseUrl).host;
  let response: Response;
  try {
    response = await fetch(`${server.baseUrl}${path}`, {
      ...init,
      headers: { ...authorization(server.key), ...init.headers },
      signal: AbortSignal.timeout(timeout),
    });
  } catch (error) {
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
): Promise<ServedModel[]> => {
  const body = (await (
    await request(server, "/models")
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
const listVoices = async (server: OwnServer, model: string) => {
  const body = (await request(
    server,
    `/audio/voices?model=${encodeURIComponent(model)}`,
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
export const speechVoices = async (server: OwnServer, model: string) => {
  const listed = await listVoices(server, model);
  const says = (voice: string | null) =>
    synthesize(server, { model, slow: false, text: "Hello.", voice });
  if (
    await says(null).then(
      () => true,
      () => false,
    )
  )
    return { defaultVoice: null as string | null, voices: listed };
  const voices = listed.length ? listed : openaiVoices;
  await says(voices[0]!);
  return { defaultVoice: voices[0]! as string | null, voices };
};

type Prompt = Parameters<
  NonNullable<LanguageModelMiddleware["transformParams"]>
>[0]["params"]["prompt"];
type UserContent = Extract<Prompt[number], { role: "user" }>["content"];

// Chat completions take only text in a tool's result, and none of the
// tools a provider runs itself: the screenshots the computer tool returns go
// to the model in a message of the user's after it, and ChatGPT's web
// searches, from a run that fell back from it or an earlier one, are left
// out of what it said.
const chatCompletions: LanguageModelMiddleware = {
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
};

// The bots' model: the server's chat completions.
export const ownChatModel = (
  server: OwnServer,
  model: ServedModel,
): CallableModel => ({
  about: `${model.id}, a model the user hosts`,
  contextWindow: model.contextWindow ?? defaultContextWindow,
  model: wrapLanguageModel({
    middleware: chatCompletions,
    model: createOpenAICompatible({
      apiKey: server.key ?? undefined,
      baseURL: server.baseUrl,
      includeUsage: true,
      name: "own",
    }).chatModel(model.id),
  }),
  providerOptions: {},
  tools: {},
});

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

// What the bot says, spoken: the server's speech, as WAV unless it gives
// another kind.
export const synthesize = async (
  server: OwnServer,
  options: {
    model: string;
    text: string;
    // Null for the server's own.
    voice: string | null;
    slow: boolean;
  },
) => {
  const response = await request(
    server,
    "/audio/speech",
    {
      body: JSON.stringify({
        input: options.text.slice(0, speechChars),
        model: options.model,
        response_format: "wav",
        ...(options.voice ? { voice: options.voice } : {}),
        ...(options.slow ? { speed: 0.85 } : {}),
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
    60_000,
  );
  return {
    audio: Buffer.from(await response.arrayBuffer()),
    type: response.headers.get("content-type") ?? "audio/wav",
  };
};
