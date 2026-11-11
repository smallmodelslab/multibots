import { createOpenAI, openai } from "@ai-sdk/openai";
import {
  wrapLanguageModel,
  type JSONSchema7,
  type LanguageModelMiddleware,
  type ToolSet,
} from "ai";

import type { ProviderOptions } from "@ai-sdk/provider-utils";

// The user's ChatGPT subscription as a bot's model: Codex's sign-in
// (OpenAI's device-code flow) and its Responses endpoint, which takes the
// system prompt as instructions and keeps nothing (store: false). Fetch only.

const clientId = "app_EMoamEEZ73f0CkXaXp7hrann";
const auth = "https://auth.openai.com";
export const codex = "https://chatgpt.com/backend-api/codex";
// The account's models are listed for Codex clients at least this new.
const clientVersion = "0.999.0";

export const verificationUri = `${auth}/codex/device`;
// A device code is good for this long.
export const loginMs = 15 * 60_000;

export type Tokens = {
  access: string;
  accountId: string;
  email: string | null;
  expiresAt: number;
  refresh: string;
};

const json = async (response: Response, what: string) => {
  if (!response.ok)
    throw new Error(
      `ChatGPT ${what} failed: ${response.status} ${(await response.text()).slice(0, 300)}`,
    );
  return (await response.json()) as Record<string, unknown>;
};

const claims = (jwt: string) => {
  const payload = jwt.split(".")[1] ?? "";
  const padded = payload.replaceAll("-", "+").replaceAll("_", "/");
  return JSON.parse(
    atob(padded + "=".repeat((4 - (padded.length % 4)) % 4)),
  ) as Record<string, unknown>;
};

// The access token says when it expires. A refresh that sends no new
// refresh token leaves the one it was given good.
const tokensOf = (body: Record<string, unknown>, refreshed = ""): Tokens => {
  const access = String(body.access_token ?? "");
  const refresh = String(body.refresh_token ?? refreshed);
  const payload = access ? claims(access) : {};
  if (!access || !refresh || typeof payload.exp !== "number")
    throw new Error("ChatGPT answered without tokens.");
  const account = payload["https://api.openai.com/auth"] as
    | { chatgpt_account_id?: string }
    | undefined;
  const profile = payload["https://api.openai.com/profile"] as
    | { email?: string }
    | undefined;
  if (!account?.chatgpt_account_id)
    throw new Error("That sign-in has no ChatGPT account.");
  return {
    access,
    accountId: account.chatgpt_account_id,
    email: profile?.email ?? null,
    expiresAt: payload.exp * 1_000,
    refresh,
  };
};

// Asks OpenAI for a code the user enters at verificationUri.
export const startLogin = async () => {
  const body = await json(
    await fetch(`${auth}/api/accounts/deviceauth/usercode`, {
      body: JSON.stringify({ client_id: clientId }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }),
    "sign-in",
  );
  const interval = Number(body.interval);
  if (!body.device_auth_id || !body.user_code || !Number.isFinite(interval))
    throw new Error("ChatGPT answered the sign-in oddly.");
  return {
    deviceAuthId: String(body.device_auth_id),
    intervalSeconds: interval,
    userCode: String(body.user_code),
  };
};

// Whether the user has entered the code: their tokens once they have, null
// while they have not.
export const pollLogin = async (login: {
  deviceAuthId: string;
  userCode: string;
}): Promise<Tokens | null> => {
  const response = await fetch(`${auth}/api/accounts/deviceauth/token`, {
    body: JSON.stringify({
      device_auth_id: login.deviceAuthId,
      user_code: login.userCode,
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  if (response.status === 403 || response.status === 404) return null;
  const body = await json(response, "sign-in").catch((error: Error) => {
    if (/authorization_pending|slow_down/.test(error.message)) return null;
    throw error;
  });
  if (!body) return null;
  return tokensOf(
    await json(
      await fetch(`${auth}/oauth/token`, {
        body: new URLSearchParams({
          client_id: clientId,
          code: String(body.authorization_code),
          code_verifier: String(body.code_verifier),
          grant_type: "authorization_code",
          redirect_uri: `${auth}/deviceauth/callback`,
        }),
        headers: { "content-type": "application/x-www-form-urlencoded" },
        method: "POST",
      }),
      "sign-in",
    ),
  );
};

// OpenAI turned the refresh token down for good (expired, revoked or
// already used, as Codex reads it): the user signs in again.
export class RefreshRefused extends Error {}

// A refresh gives up after this long, so that no one refreshes with the
// same token meanwhile.
export const refreshMs = 20_000;

// A refresh token works once: whoever refreshes must store what comes back.
export const refreshTokens = async (refresh: string) => {
  const response = await fetch(`${auth}/oauth/token`, {
    body: new URLSearchParams({
      client_id: clientId,
      grant_type: "refresh_token",
      refresh_token: refresh,
    }),
    headers: { "content-type": "application/x-www-form-urlencoded" },
    method: "POST",
    signal: AbortSignal.timeout(refreshMs),
  });
  if (!response.ok) {
    const text = await response.text();
    const failure = `ChatGPT refresh failed: ${response.status} ${text.slice(0, 300)}`;
    throw response.status === 401 ||
      /refresh_token_(expired|reused|invalidated)/.test(text) ||
      (response.status === 400 && /invalid_grant/.test(text))
      ? new RefreshRefused(failure)
      : new Error(failure);
  }
  return tokensOf((await response.json()) as Record<string, unknown>, refresh);
};

export const headers = (tokens: Pick<Tokens, "access" | "accountId">) => ({
  authorization: `Bearer ${tokens.access}`,
  "chatgpt-account-id": tokens.accountId,
  originator: "multibots",
});

export type ChatgptModel = {
  contextWindow: number;
  // When Codex compacts this model's context.
  compactAt: number | null;
  effort: string;
  id: string;
};

// The models the account offers, best first.
export const listModels = async (
  tokens: Pick<Tokens, "access" | "accountId">,
): Promise<ChatgptModel[]> => {
  const body = await json(
    await fetch(`${codex}/models?client_version=${clientVersion}`, {
      headers: headers(tokens),
    }),
    "models",
  );
  return ((body.models ?? []) as Record<string, unknown>[])
    .filter((model) => model.visibility === "list")
    .sort((a, b) => Number(a.priority) - Number(b.priority))
    .map((model) => ({
      compactAt:
        typeof model.auto_compact_token_limit === "number"
          ? model.auto_compact_token_limit
          : null,
      contextWindow: Number(model.context_window),
      effort: String(model.default_reasoning_level ?? "medium"),
      id: String(model.slug),
    }));
};

type Generated = Awaited<
  ReturnType<NonNullable<LanguageModelMiddleware["wrapGenerate"]>>
>;

// Codex's errors arrive in its stream as { type: "error", error } or a
// failed response, which the provider passes on only as raw chunks.
const codexError = (raw: unknown) => {
  const event = raw as {
    error?: { message?: string };
    response?: { error?: { message?: string } };
    type?: string;
  } | null;
  if (event?.type !== "error" && event?.type !== "response.failed") return null;
  const failure = event.type === "error" ? event.error : event.response?.error;
  return new Error(`ChatGPT: ${failure?.message ?? "the request failed."}`);
};

// OpenAI refuses patterns it cannot run (lookarounds, as in zod's email);
// each tool's own schema still checks every call.
const runnable = (schema: unknown): unknown =>
  Array.isArray(schema)
    ? schema.map(runnable)
    : schema && typeof schema === "object"
      ? Object.fromEntries(
          Object.entries(schema)
            .filter(
              ([key, value]) =>
                !(
                  key === "pattern" &&
                  typeof value === "string" &&
                  /\(\?<?[=!]/.test(value)
                ),
            )
            .map(([key, value]) => [key, runnable(value)]),
        )
      : schema;

// Codex only streams ("Stream must be set to true"): a call for one whole
// answer streams it and puts it together. Its raw chunks are read for its
// errors and not passed on. It takes the system prompt as instructions.
const codexStream: LanguageModelMiddleware = {
  transformParams: async ({ params }) => ({
    ...params,
    includeRawChunks: true,
    prompt: params.prompt.filter((message) => message.role !== "system"),
    providerOptions: {
      ...params.providerOptions,
      openai: {
        ...params.providerOptions?.openai,
        instructions: params.prompt
          .flatMap((message) =>
            message.role === "system" ? [message.content] : [],
          )
          .join("\n\n"),
      },
    },
    responseFormat:
      params.responseFormat?.type === "json"
        ? {
            ...params.responseFormat,
            schema: runnable(params.responseFormat.schema) as JSONSchema7,
          }
        : params.responseFormat,
    tools: params.tools?.map((tool) =>
      tool.type === "function"
        ? {
            ...tool,
            inputSchema: runnable(tool.inputSchema) as JSONSchema7,
          }
        : tool,
    ),
  }),
  wrapStream: async ({ doStream }) => {
    const { stream, ...rest } = await doStream();
    return {
      ...rest,
      stream: stream.pipeThrough(
        new TransformStream({
          transform: (part, controller) => {
            if (part.type !== "raw") controller.enqueue(part);
            else {
              const error = codexError(part.rawValue);
              if (error) controller.enqueue({ error, type: "error" });
            }
          },
        }),
      ),
    };
  },
  wrapGenerate: async ({ doStream }) => {
    const { stream, request, response } = await doStream();
    const content: Generated["content"] = [];
    const open = new Map<
      string,
      { providerMetadata?: unknown; text: string }
    >();
    const reader = stream.getReader();
    let warnings: Generated["warnings"] = [];
    let result: Pick<
      Generated,
      "finishReason" | "providerMetadata" | "usage"
    > | null = null;
    for (;;) {
      const { done, value: part } = await reader.read();
      if (done) break;
      switch (part.type) {
        case "text-start":
        case "reasoning-start": {
          const started = {
            providerMetadata: part.providerMetadata,
            text: "",
            type: part.type === "text-start" ? "text" : "reasoning",
          } as const;
          content.push(started);
          open.set(`${started.type}:${part.id}`, started);
          break;
        }
        case "text-delta":
        case "reasoning-delta": {
          const kind = part.type === "text-delta" ? "text" : "reasoning";
          const target = open.get(`${kind}:${part.id}`);
          if (target) target.text += part.delta;
          break;
        }
        case "text-end":
        case "reasoning-end": {
          const kind = part.type === "text-end" ? "text" : "reasoning";
          const target = open.get(`${kind}:${part.id}`);
          // The end carries what the provider needs back (the encrypted
          // reasoning).
          if (target && part.providerMetadata)
            target.providerMetadata = part.providerMetadata;
          open.delete(`${kind}:${part.id}`);
          break;
        }
        case "tool-call":
        case "tool-result":
        case "tool-approval-request":
        case "file":
        case "reasoning-file":
        case "source":
        case "custom":
          content.push(part);
          break;
        case "stream-start":
          warnings = part.warnings;
          break;
        case "finish":
          result = {
            finishReason: part.finishReason,
            providerMetadata: part.providerMetadata,
            usage: part.usage,
          };
          break;
        case "raw": {
          const error = codexError(part.rawValue);
          if (error) throw error;
          break;
        }
        case "error":
          throw part.error;
      }
    }
    if (!result) throw new Error("ChatGPT ended its answer early.");
    return { ...result, content, request, response, warnings };
  },
};

// A bot's model: what the bot is told it runs on, how many tokens it
// reads, and the tools its provider runs itself.
export type CallableModel = {
  about: string;
  contextWindow: number;
  model: ReturnType<typeof wrapLanguageModel>;
  providerOptions: ProviderOptions;
  tools: ToolSet;
};

// A model of the account's, for a bot: one prompt cache per bot.
export const chatgptModel = (
  tokens: Pick<Tokens, "access" | "accountId">,
  model: ChatgptModel,
  cacheKey: string,
): CallableModel => ({
  about: "the user's ChatGPT subscription",
  contextWindow: model.contextWindow,
  model: wrapLanguageModel({
    middleware: codexStream,
    model: createOpenAI({
      apiKey: tokens.access,
      baseURL: codex,
      headers: {
        ...headers(tokens),
        "OpenAI-Beta": "responses=experimental",
        "session-id": cacheKey,
      },
    }).responses(model.id),
  }),
  providerOptions: {
    openai: {
      include: ["reasoning.encrypted_content"],
      promptCacheKey: cacheKey,
      reasoningEffort: model.effort,
      reasoningSummary: "auto",
      store: false,
      textVerbosity: "low",
    },
  },
  tools: { web_search: openai.tools.webSearch({}) },
});
