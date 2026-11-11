import { Composio } from "@composio/core";
import { VercelProvider } from "@composio/vercel";
import type { ToolSet } from "ai";
import { shell } from "electron";

import type { Bridge, Plugin, PluginsState } from "../shared/types";
import { readSealed, writeSealed } from "./sealed";

// The one user of the Composio project the key belongs to. The project is
// the user's own, so each of their computers given its key shares the apps
// connected on any of them.
// The provider identity owns existing OAuth connections across the rename.
const userId = "openbots";

// Bots have this computer's shell, so they need no Composio sandbox.
const sessionConfig = { sandbox: { enable: false } };

const clientOf = (apiKey: string) =>
  new Composio({
    allowTracking: false,
    apiKey,
    disableVersionCheck: true,
    provider: new VercelProvider(),
  });

type Saved = { key: string; sessionId: string };
type Session = Awaited<
  ReturnType<ReturnType<typeof clientOf>["sessions"]["create"]>
>;
type Toolkit = Awaited<ReturnType<Session["toolkits"]>>["items"][number];

// A sign-in started and never finished leaves an account that is not
// connected yet; one that stopped working needs signing in again.
const statusOf = (status: string | undefined): Plugin["status"] =>
  status === "ACTIVE"
    ? "connected"
    : !status || status === "INITIALIZING" || status === "INITIATED"
      ? "notConnected"
      : "needsReconnecting";

const pluginOf = (toolkit: Toolkit): Plugin => ({
  logo: toolkit.logo ?? null,
  name: toolkit.name,
  slug: toolkit.slug,
  status: statusOf(toolkit.connection?.connectedAccount?.status),
});

// What Composio said went wrong, without the response around it.
const failure = (error: unknown) => {
  const said = (error as { error?: { error?: { message?: unknown } } } | null)
    ?.error?.error?.message;
  return new Error(
    typeof said === "string"
      ? `Composio: ${said}`
      : error instanceof Error
        ? error.message
        : String(error),
  );
};

const asked = async <T>(work: () => Promise<T>) => {
  try {
    return await work();
  } catch (error) {
    throw failure(error);
  }
};

// The apps this computer's bots reach through Composio, on the user's own
// Composio key, sealed as this computer's other keys are. Bots take their
// tools from one Composio session, kept across launches, whose apps are
// the ones connected here.
export class Plugins {
  private saved: Saved | null = null;
  private session: Promise<Session> | null = null;
  // The sign-ins open in the browser, each its own, so every one that ends
  // changes what the window is told.
  private connecting = new Set<{ slug: string }>();

  constructor(
    private readonly file: string,
    private readonly onChange: () => void,
  ) {}

  async load() {
    this.saved =
      (await readSealed<{ composio: Saved | null }>(this.file))?.composio ??
      null;
  }

  state(): PluginsState {
    return {
      composio: Boolean(this.saved),
      connecting: [...this.connecting].map(({ slug }) => slug),
    };
  }

  // A key is kept once Composio makes a session with it.
  async setKey(key: string) {
    const apiKey = key.trim();
    const session = apiKey
      ? await asked(() =>
          clientOf(apiKey).sessions.create(userId, sessionConfig),
        )
      : null;
    await this.save(session && { key: apiKey, sessionId: session.sessionId });
    if (session) this.session = Promise.resolve(session);
  }

  private async save(saved: Saved | null) {
    if (saved?.key !== this.saved?.key) {
      this.session = null;
      this.connecting = new Set();
    }
    this.saved = saved;
    await writeSealed(this.file, { composio: saved });
    this.onChange();
  }

  private composio() {
    if (!this.saved) throw new Error("Add a Composio key first.");
    return { composio: clientOf(this.saved.key), saved: this.saved };
  }

  // The session kept, or a new one once Composio no longer has it. One that
  // could not be had, such as while offline, is asked for again next time.
  private current() {
    const { composio, saved } = this.composio();
    const session = (this.session ??= (async () => {
      const kept = await composio.sessions
        .use(saved.sessionId)
        .catch(() => null);
      if (kept) return kept;
      const made = await composio.sessions.create(userId, sessionConfig);
      if (this.saved === saved)
        await this.save({ ...saved, sessionId: made.sessionId });
      return made;
    })());
    session.catch(() => {
      if (this.session === session) this.session = null;
    });
    return session;
  }

  // Apps without a sign-in work for bots as they are, with nothing to
  // connect, so they are not listed. Those connected come all at once.
  plugins({ connected, cursor, search }: Parameters<Bridge["plugins"]>[0]) {
    return asked(async () => {
      const session = await this.current();
      const plugins: Plugin[] = [];
      let next = cursor ?? undefined;
      do {
        const page = await session.toolkits({
          limit: 40,
          ...(next && { cursor: next }),
          ...(search.trim() && { search: search.trim() }),
          ...(connected && { isConnected: true }),
        });
        plugins.push(
          ...page.items
            .filter((toolkit) => !toolkit.isNoAuth)
            .map(pluginOf)
            .filter((plugin) => !connected || plugin.status !== "notConnected"),
        );
        next = page.cursor;
      } while (connected && next);
      return { cursor: next ?? null, plugins };
    });
  }

  // Opens Composio's sign-in for the app in the browser, which connects it
  // once the user finishes there.
  async connect(slug: string) {
    const request = await asked(async () =>
      (await this.current()).authorize(slug),
    );
    if (!request.redirectUrl) return;
    const signIn = { slug };
    const { connecting } = this;
    connecting.add(signIn);
    this.onChange();
    await shell.openExternal(request.redirectUrl);
    void request
      .waitForConnection(10 * 60_000)
      .catch(() => {})
      .finally(() => {
        connecting.delete(signIn);
        this.onChange();
      });
  }

  // Every account the user has for the app goes, including those left by
  // sign-ins that were never finished, so it does not come back connected.
  disconnect(slug: string) {
    return asked(async () => {
      const { composio } = this.composio();
      const ids: string[] = [];
      let cursor: string | null | undefined;
      do {
        const page = await composio.connectedAccounts.list({
          cursor,
          toolkitSlugs: [slug],
          userIds: [userId],
        });
        ids.push(...page.items.map((account) => account.id));
        cursor = page.nextCursor;
      } while (cursor);
      await Promise.all(ids.map((id) => composio.connectedAccounts.delete(id)));
    });
  }

  // What a bot's run takes from its plugins: Composio's tools, which find
  // and run the tools of the apps connected, and what the bot is told. The
  // run waits for them a little while at most, and not once it is stopped.
  async forBots(
    signal: AbortSignal,
  ): Promise<{ tools: ToolSet; about: string }> {
    if (!this.saved) return { about: "", tools: {} };
    const stop = AbortSignal.any([signal, AbortSignal.timeout(20_000)]);
    try {
      const tools = await new Promise<ToolSet>((done, fail) => {
        stop.throwIfAborted();
        stop.addEventListener("abort", () => fail(stop.reason), { once: true });
        this.current()
          .then((session) => session.tools())
          .then((tools) => done(tools as ToolSet), fail);
      });
      return {
        about:
          "Plugins reach the user's apps, such as their email, calendar and chat, through Composio's tools: search them for what a task needs. When an app it needs is not connected, give the user Composio's link to connect it, or ask them to connect it in Plugins.",
        tools,
      };
    } catch (error) {
      this.session = null;
      return {
        about: `The user's plugins could not load: ${failure(error).message}`,
        tools: {},
      };
    }
  }
}
