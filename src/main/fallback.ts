import type { UserContent } from "ai";

import type { CallableModel } from "./codex";

type Options = Parameters<CallableModel["model"]["doGenerate"]>[0];

// A model of the user's order: its name, and how it is had, which can fail,
// as ChatGPT's does while signed out.
export type Fallback = {
  name: string;
  model: () => CallableModel | Promise<CallableModel>;
};

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

// What `call` gives for the first of `models` it works with, in order.
// When none does, why each failed, by name; a lone model's error as it is.
// A call that was called off (`stopped`) goes no further.
export const inOrder = async <M, T>(
  models: M[],
  nameOf: (model: M) => string,
  call: (model: M) => PromiseLike<T>,
  stopped: () => boolean = () => false,
): Promise<T> => {
  const failures: string[] = [];
  for (const model of models)
    try {
      return await call(model);
    } catch (error) {
      if (stopped() || models.length === 1) throw error;
      failures.push(`${nameOf(model)}: ${messageOf(error)}`);
    }
  throw new Error(failures.join("\n"));
};

// How much of a conversation goes to a model, in characters of its JSON:
// the newest turns that fit, from a message of the user's. At most this, and
// at most about half the model's window, at some four characters a token.
// A file's bytes, an image's included, count for nothing.
const contextBudget = 400_000;

const sizeOf = (message: unknown) =>
  JSON.stringify(message, function (this: { type?: unknown }, key, value) {
    return key === "data" && (this.type === "data" || this.type === "Buffer")
      ? ""
      : (value as unknown);
  }).length;

// Where the newest turns that fit `budget` begin. The newest message of the
// user's goes even when it alone is too long, for the model to answer or
// turn down.
const newest = (context: { role: string }[], budget: number) => {
  let size = 0;
  let start = context.length;
  for (let index = context.length - 1; index >= 0; index -= 1) {
    size += sizeOf(context[index]);
    if (size > budget) break;
    if (context[index]!.role === "user") start = index;
  }
  return start < context.length
    ? start
    : Math.max(
        0,
        context.findLastIndex((message) => message.role === "user"),
      );
};

const leftOut = {
  type: "text",
  value: "[Left out to fit the model's window.]",
} as const;

// The newest turns that fit the model, a window it does not say counting
// as the largest. When what came since the user's newest message is too
// long on its own, as a long run's tool calls, its oldest tools' results
// are left out until it fits.
// What a model of `contextWindow` tokens is sent, in characters.
const budgetOf = (contextWindow: number) =>
  Math.min(contextBudget, contextWindow * 2 || contextBudget);

export const fits = <M extends { role: string }>(
  context: M[],
  contextWindow: number,
) => {
  const budget = budgetOf(contextWindow);
  const fitted = context.slice(newest(context, budget));
  let over = sizeOf(fitted) - budget;
  if (over <= 0) return fitted;
  return fitted.map((message) => {
    const { content } = message as { content?: unknown };
    if (over <= 0 || message.role !== "tool" || !Array.isArray(content))
      return message;
    return {
      ...message,
      content: content.map((part: { type: string; output?: unknown }) => {
        if (over <= 0 || part.type !== "tool-result") return part;
        const shortened = { ...part, output: leftOut };
        over -= sizeOf(part) - sizeOf(shortened);
        return shortened;
      }),
    };
  });
};

// What one run reads of what waits for a bot, as one message's content: as
// many of the oldest as fit a model's window together (the largest, without
// one), one at least, and how many that is. Each is sized as the parts it
// becomes, which errs large.
export const batchOf = (waiting: UserContent[], contextWindow = 0) => {
  const budget = budgetOf(contextWindow);
  const parts = (content: UserContent) =>
    typeof content === "string"
      ? [{ text: content, type: "text" as const }]
      : content;
  let size = sizeOf({ content: [], role: "user" });
  let count = 0;
  for (const each of waiting) {
    size += sizeOf(parts(each));
    if (count && size > budget) break;
    count += 1;
  }
  const read = waiting.slice(0, count);
  return {
    content: read.length === 1 ? read[0]! : read.flatMap(parts),
    count,
  };
};

// How many of a bot's oldest turns no model is sent again: none until it
// holds twice what fits the largest window, then all before what does.
export const unsent = (context: { role: string }[]) =>
  sizeOf(context) > 2 * contextBudget ? newest(context, contextBudget) : 0;

// The bots' models in the user's order, as one: each call goes to the first
// that answers, with its own options and as much of the conversation as fits
// it. The first that can be had leads: the run is told about it, fits its
// context to it and offers the tools its provider runs. The rest are had
// only once a call reaches them, so one that can't be, or is slow to, holds
// up nothing before it. A run stopped (`signal`) stops waiting for one.
export const fallback = async (
  models: Fallback[],
  signal: AbortSignal,
): Promise<CallableModel> => {
  const stopped = new Promise<never>((_, fail) => {
    const stop = () => fail(signal.reason);
    if (signal.aborted) stop();
    else signal.addEventListener("abort", stop, { once: true });
  });
  stopped.catch(() => {});
  const had = models.map(({ model, name }) => {
    let once: Promise<CallableModel> | undefined;
    return {
      get: () =>
        (once ??= Promise.race([Promise.resolve().then(model), stopped])),
      name,
    };
  });
  let lead: CallableModel | undefined;
  let missing: unknown;
  while (!lead && had.length)
    try {
      lead = await had[0]!.get();
    } catch (error) {
      if (signal.aborted) throw error;
      missing ??= error;
      had.shift();
    }
  if (!lead) throw missing;
  if (had.length === 1) return lead;
  const { contextWindow } = lead;
  const each = <T>(
    options: Options,
    call: (model: CallableModel, options: Options) => PromiseLike<T>,
  ) =>
    inOrder(
      had,
      ({ name }) => name,
      async ({ get }) => {
        const model = await get();
        return call(model, {
          ...options,
          prompt:
            model.contextWindow < contextWindow
              ? [
                  ...options.prompt.filter(({ role }) => role === "system"),
                  ...fits(
                    options.prompt.filter(({ role }) => role !== "system"),
                    model.contextWindow,
                  ),
                ]
              : options.prompt,
          providerOptions: model.providerOptions,
        });
      },
      () => Boolean(options.abortSignal?.aborted),
    );
  return {
    ...lead,
    model: {
      doGenerate: (options) =>
        each(options, ({ model }, own) => model.doGenerate(own)),
      doStream: (options) =>
        each(options, ({ model }, own) => model.doStream(own)),
      modelId: had.map(({ name }) => name).join(", "),
      provider: "multibots",
      specificationVersion: "v4",
      supportedUrls: {},
    },
    providerOptions: {},
  };
};
