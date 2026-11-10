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
  speechVoices,
  type OwnServer,
} from "./ownServer";
import { readSealed, writeSealed } from "./sealed";

type Saved = OwnServer & {
  id: string;
  model: string;
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

const idOf = (entry: Entry) => (entry === "chatgpt" ? entry : entry.id);

const listOf = (kind: OwnModelKind): ModelList =>
  kind === "bots" ? "bots" : "voice";

// The models this computer's user hosts, in the order they are tried with
// ChatGPT among them: the bots', and the voice's. They stay on this
// computer, their keys sealed as the ChatGPT sign-in is; another computer
// connects its own.
export class OwnModels {
  private lists: Lists = { bots: ["chatgpt"], voice: ["chatgpt"] };

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
    return (await listServedModels(serverOf({ address, key }))).map(
      (model) => model.id,
    );
  }

  // Keeps a server once it answers, and a speech server once it speaks,
  // with the model asked for, else its first, at the end of its list.
  async connect(kind: OwnModelKind, input: OwnModelInput) {
    const server = serverOf(input);
    const served = await listServedModels(server);
    const id = input.model.trim() || served[0]?.id;
    if (!id)
      throw new Error(`${new URL(server.baseUrl).host} serves no models.`);
    const saved = {
      ...server,
      contextWindow:
        served.find((each) => each.id === id)?.contextWindow ?? null,
      id: randomUUID(),
      model: id,
    };
    const model: OwnModel =
      kind === "speech"
        ? { ...saved, kind, ...(await speechVoices(server, id)) }
        : { ...saved, kind };
    const list = listOf(kind);
    await this.save({ ...this.lists, [list]: [...this.lists[list], model] });
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
    return this.lists.bots;
  }

  // What voice chats run on, in the user's order: ChatGPT's voice while
  // signed in, and the user's models once there is one of each kind.
  voice(signedIn: boolean) {
    const { voice } = this.lists;
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
