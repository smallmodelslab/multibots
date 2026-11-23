import { randomUUID } from "node:crypto";

import type {
  ModelList,
  OwnModelInput,
  OwnModelKind,
  OwnModelsState,
} from "../shared/types";
import {
  baseUrlOf,
  listServedModels,
  ownChatModel,
  speechVoices,
  type OwnServer,
} from "./ownServer";
import { readSealed, writeSealed } from "./sealed";

type Saved = OwnServer & {
  id: string;
  model: string;
  // The context window the user gave a chat model, in tokens, null for the
  // one its server says; and the one it said last.
  window: number | null;
  contextWindow: number | null;
};
export type SpeechModel = Saved & { kind: "speech" } & Awaited<
    ReturnType<typeof speechVoices>
  >;
export type OwnModel =
  | (Saved & { kind: "bots" | "transcription" })
  | SpeechModel;
type Entry = OwnModel | "chatgpt";
// In the order they are tried; "chatgpt" is ChatGPT's place.
type Lists = Record<ModelList, Entry[]>;

const serverOf = (input: Pick<OwnModelInput, "address" | "key">) => ({
  baseUrl: baseUrlOf(input.address),
  key: input.key.trim() || null,
});

// The context window typed for a chat model, or null for the server's.
const windowOf = (typed: string) => {
  const text = typed.replaceAll(/[\s,_]/g, "");
  if (!text) return null;
  const tokens = Number(text);
  if (!Number.isInteger(tokens) || tokens < 1024)
    throw new Error(
      "The context window is a number of tokens, such as 32768, or left empty for the server's.",
    );
  return tokens;
};

const idOf = (entry: Entry) => (entry === "chatgpt" ? entry : entry.id);

const listOf = (kind: OwnModelKind): ModelList =>
  kind === "bots" ? "bots" : "voice";

// The models this computer's user hosts, in the order they are tried with
// ChatGPT among them: the bots', and the voice's. They stay on this
// computer, their keys sealed as the ChatGPT sign-in is; another computer
// connects its own.
export class OwnModels {
  private lists: Lists = { bots: ["chatgpt"], voice: ["chatgpt"] };
  // What stops each connection being checked, by the window's attempt, and
  // the models kept but not yet past their cancellation, which no run
  // takes.
  private readonly connecting = new Map<string, AbortController>();
  private readonly unsettled = new Set<string>();

  constructor(
    private readonly file: string,
    private readonly onChange: () => void,
  ) {}

  async load() {
    const saved = await readSealed<{ models?: Lists }>(this.file);
    if (saved?.models) this.lists = saved.models;
  }

  state(): OwnModelsState {
    const of = (entry: Entry) =>
      entry === "chatgpt"
        ? entry
        : {
            address: entry.baseUrl,
            id: entry.id,
            kind: entry.kind,
            model: entry.model,
          };
    return {
      bots: this.lists.bots.map(of),
      voice: this.lists.voice.map(of),
    };
  }

  async served(address: string, key: string) {
    return listServedModels(serverOf({ address, key }));
  }

  // Keeps a server once it answers, and a speech server once it speaks,
  // with the model asked for, else its first, at the end of its list,
  // unless the window cancels its attempt first. Settles with the kept
  // model's id, for a window that cancelled too late to remove it.
  async connect(kind: OwnModelKind, input: OwnModelInput, attempt: string) {
    const stop = new AbortController();
    this.connecting.set(attempt, stop);
    try {
      const server = serverOf(input);
      const window = kind === "bots" ? windowOf(input.window) : null;
      const served = await listServedModels(server, stop.signal);
      const id = input.model.trim() || served[0]?.id;
      if (!id)
        throw new Error(`${new URL(server.baseUrl).host} serves no models.`);
      const saved = {
        ...server,
        contextWindow:
          served.find((each) => each.id === id)?.contextWindow ?? null,
        id: randomUUID(),
        model: id,
        window,
      };
      const model: OwnModel =
        kind === "speech"
          ? { ...saved, kind, ...(await speechVoices(server, id, stop.signal)) }
          : { ...saved, kind };
      stop.signal.throwIfAborted();
      const list = listOf(kind);
      this.unsettled.add(model.id);
      try {
        await this.save({
          ...this.lists,
          [list]: [...this.lists[list], model],
        });
        stop.signal.throwIfAborted();
      } catch (error) {
        // Cancelled while it was saved, or not saved: let go again.
        await this.disconnect(model.id).catch(() => {});
        throw error;
      } finally {
        // What runs on it, and what other computers hear, now counts it.
        this.unsettled.delete(model.id);
        this.onChange();
      }
      return model.id;
    } finally {
      this.connecting.delete(attempt);
    }
  }

  cancelConnect(attempt: string) {
    this.connecting.get(attempt)?.abort(new Error("Cancelled."));
  }

  async disconnect(id: string) {
    const keep = (entry: Entry) => entry === "chatgpt" || entry.id !== id;
    await this.save({
      bots: this.lists.bots.filter(keep),
      voice: this.lists.voice.filter(keep),
    });
  }

  // A list in the order given; any it leaves out keep theirs, after it.
  async order(list: ModelList, ids: string[]) {
    const rank = (entry: Entry) => {
      const at = ids.indexOf(idOf(entry));
      return at === -1 ? ids.length : at;
    };
    await this.save({
      ...this.lists,
      [list]: this.lists[list].toSorted((a, b) => rank(a) - rank(b)),
    });
  }

  private async save(lists: Lists) {
    this.lists = lists;
    await writeSealed(this.file, { models: lists });
    this.onChange();
  }

  // The bots' models, in the order they try them.
  bots() {
    return this.lists.bots.filter(this.settled);
  }

  private readonly settled = (entry: Entry) =>
    entry === "chatgpt" || !this.unsettled.has(entry.id);

  // A chat model of the user's for a run: with the context window they
  // gave it, else the one its server says now, saved when it changes for
  // a time the server doesn't answer, a restart between included.
  async chatModel(model: OwnModel, signal?: AbortSignal) {
    // Models saved before a window could be given have none.
    if (model.window) return ownChatModel(model);
    const said = (await listServedModels(model, signal).catch(() => [])).find(
      ({ id }) => id === model.model,
    )?.contextWindow;
    if (!said || said === model.contextWindow) return ownChatModel(model);
    const current = { ...model, contextWindow: said };
    const update = (entry: Entry) =>
      entry !== "chatgpt" && entry.id === model.id ? current : entry;
    // Not saved, it still counts for this run.
    await this.save({
      bots: this.lists.bots.map(update),
      voice: this.lists.voice.map(update),
    }).catch(() => {});
    return ownChatModel(current);
  }

  // What voice chats run on, in the user's order: ChatGPT's voice while
  // signed in, and the user's models once there is one of each kind.
  voice(signedIn: boolean) {
    const voice = this.lists.voice.filter(this.settled);
    const transcription = voice.filter(
      (entry): entry is OwnModel =>
        entry !== "chatgpt" && entry.kind === "transcription",
    );
    const speech = voice.filter(
      (entry): entry is SpeechModel =>
        entry !== "chatgpt" && entry.kind === "speech",
    );
    const own =
      transcription.length && speech.length
        ? [{ kind: "own" as const, speech, transcription }]
        : [];
    const chatgpt = signedIn ? [{ kind: "chatgpt" as const }] : [];
    return voice[0] === "chatgpt" ? [...chatgpt, ...own] : [...own, ...chatgpt];
  }
}

export type OwnVoice = Extract<
  ReturnType<OwnModels["voice"]>[number],
  { kind: "own" }
>;
