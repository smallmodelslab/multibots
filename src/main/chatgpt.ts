import { rm } from "node:fs/promises";

import type { ChatgptState } from "../shared/types";
import {
  chatgptModel,
  listModels,
  loginMs,
  pollLogin,
  RefreshRefused,
  refreshTokens,
  startLogin,
  verificationUri,
  type ChatgptModel,
  type Tokens,
} from "./codex";
import { readSealed, writeSealed } from "./sealed";
import { startVoiceCall } from "./voice";

// This computer's ChatGPT sign-in, which its bots run on. It stays on this
// computer: another computer signs in for itself, since a refresh token
// works once and two holders would sign each other out. What a sign-in or
// refresh brings back counts only if the user has not since signed out or
// in again (`session`).
export class Chatgpt {
  private tokens: Tokens | null = null;
  private session = 0;
  private pending: { code: string; url: string; cancel: () => void } | null =
    null;
  private refreshing: Promise<Tokens> | null = null;
  private models: ChatgptModel[] | null = null;

  constructor(
    private readonly file: string,
    private readonly onChange: () => void,
  ) {}

  async load() {
    this.tokens = await readSealed<Tokens>(this.file);
  }

  state(): ChatgptState {
    return {
      email: this.tokens?.email ?? null,
      signedIn: Boolean(this.tokens),
      pending: this.pending
        ? { code: this.pending.code, url: this.pending.url }
        : null,
    };
  }

  private async save(tokens: Tokens) {
    this.tokens = tokens;
    await writeSealed(this.file, tokens);
  }

  // Shows a code to enter at OpenAI and waits until it is entered, it
  // expires, or the user signs out.
  async signIn() {
    this.pending?.cancel();
    const login = await startLogin();
    let cancelled = false;
    this.pending = {
      code: login.userCode,
      url: verificationUri,
      cancel: () => {
        cancelled = true;
      },
    };
    this.onChange();
    const until = Date.now() + loginMs;
    try {
      while (!cancelled && Date.now() < until) {
        await new Promise((done) =>
          setTimeout(done, login.intervalSeconds * 1000),
        );
        if (cancelled) return;
        const tokens = await pollLogin(login);
        if (cancelled) return;
        if (!tokens) continue;
        this.session += 1;
        this.refreshing = null;
        this.models = null;
        await this.save(tokens);
        return;
      }
      if (!cancelled) throw new Error("The ChatGPT code expired.");
    } finally {
      if (!cancelled) this.pending = null;
      this.onChange();
    }
  }

  async signOut() {
    this.pending?.cancel();
    this.pending = null;
    this.session += 1;
    this.tokens = null;
    this.refreshing = null;
    this.models = null;
    await rm(this.file, { force: true });
    this.onChange();
  }

  private async fresh(): Promise<Tokens> {
    const tokens = this.tokens;
    if (!tokens) throw new Error("Sign in to ChatGPT in Settings.");
    if (tokens.expiresAt - Date.now() > 5 * 60_000) return tokens;
    if (this.refreshing) return this.refreshing;
    const session = this.session;
    const signedOut = new Error("Sign in to ChatGPT in Settings.");
    const refresh: Promise<Tokens> = refreshTokens(tokens.refresh)
      .then(async (next) => {
        if (session !== this.session) throw signedOut;
        await this.save(next);
        return next;
      })
      .catch(async (error: unknown) => {
        if (!(error instanceof RefreshRefused)) throw error;
        if (session !== this.session) throw signedOut;
        await this.signOut();
        throw new Error("ChatGPT signed this computer out. Sign in again.");
      })
      .finally(() => {
        if (this.refreshing === refresh) this.refreshing = null;
      });
    this.refreshing = refresh;
    return refresh;
  }

  // The account's best model, with one prompt cache per bot.
  async model(cacheKey: string) {
    const tokens = await this.fresh();
    this.models ??= await listModels(tokens);
    const best = this.models[0];
    if (!best) throw new Error("This ChatGPT account offers no models.");
    return chatgptModel(tokens, best, cacheKey);
  }

  // A voice chat with one of this computer's bots.
  async voiceCall(options: Parameters<typeof startVoiceCall>[1]) {
    return startVoiceCall(await this.fresh(), options);
  }
}
