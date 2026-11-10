import type { Channel, UpdateState } from "@wrkrsh/electron-update/state";
import type { Sender } from "@wrkrsh/webhooks";
import type { BoardElement, BoardFile } from "@wrkrsh/whiteboard/scene";

import type { GrokRecipe } from "./grokBot";
import type { Schedule } from "./schedule";
import type { VoiceSettings } from "./voice";
import type { Accessories } from "../features/avatars/appearance";

// Whether a host's bots can see and use its screen, through the Multidesktop
// OpenBots carries: they can, or the system has yet to allow it, or the host
// has no screen for them.
export type Screen = "ready" | "blocked" | null;

// An OpenBots client: this computer, or another of the user's on their
// tailnet. A server keeps a copy of every bot and runs them; a computer with
// server mode off only shows them, as the phone does.
export type Host = {
  id: string;
  name: string;
  os: string;
  self: boolean;
  online: boolean;
  server: boolean;
  // How many bots it holds now, running or in a voice chat: a bot's next
  // run goes to the server holding the fewest.
  running: number;
  // What its bots run on first: ChatGPT, or the id of a model the user
  // hosts; null while it has neither, and its bots cannot answer.
  model: string | null;
  // What its voice chats run on: ChatGPT's voice mode, or the user's own
  // transcription and speech models with the voices the first speech
  // server offers; null while it has neither.
  voice: { kind: "chatgpt" } | { kind: "own"; voices: string[] } | null;
  screen: Screen;
};

// What a bot is doing, as the server writing it says: what it works on
// while it runs, and the voice chat it is in, by its call's id.
export type BotStatus = { working: string | null; call: string | null };

// A file sent with a message, kept in the bot's folder.
export type Attachment = {
  name: string;
  // In the bot's folder.
  path: string;
  size: number;
  type: string;
};

export type Message = {
  id: string;
  role: "user" | "bot" | "error";
  text: string;
  at: number;
  attachments?: Attachment[];
  // The message it replies to, as that said when it was quoted.
  replyTo?: Quote;
  // Another conversation's message it passes on.
  forwarded?: Forwarded;
  // The emoji the user reacted to it with, in the order they picked them.
  reactions?: string[];
  // The user changed what it says since sending it.
  edited?: boolean;
};

export type Quote = { messageId: string; role: Message["role"]; text: string };
export type Forwarded = { author: string; text: string };

// The reactions a message offers.
export const quickReactions = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

// A message's reactions with `emoji` added, or taken back if it was there.
export const toggleReaction = (reactions: string[] = [], emoji: string) => {
  const next = reactions.includes(emoji)
    ? reactions.filter((each) => each !== emoji)
    : [...reactions, emoji];
  return next.length ? next : undefined;
};

// A file on its way to a bot, its bytes in base64.
export type Upload = { name: string; type: string; data: string };

// How many files a message carries, and how large each may be.
export const uploadLimits = { count: 10, bytes: 25 * 1024 * 1024 };

export type Bot = {
  id: string;
  // The server running it now, or that would run it.
  server: string;
  name: string;
  hue: number;
  accessories?: Accessories;
  instructions: string;
  createdAt: number;
  // Pinned to the top of every client's sidebar, and when.
  pinnedAt: number | null;
  voice: VoiceSettings;
  // The voice chat it is in, by its call's id.
  call: string | null;
  // What it is doing while it runs.
  working: string | null;
  last: Message | null;
};

export type Routine = {
  id: string;
  title: string;
  instructions: string;
  schedule: Schedule;
  enabled: boolean;
  nextRunAt: number | null;
};

export type BotFile = { path: string; size: number; modifiedAt: number };

// A webhook routine's webhook as the user sees it: where it is called, who
// calls it, the secret that sender proves itself with (null until the user
// pastes the sender's own), and whether the relay has it as it is.
export type Webhook = {
  url: string;
  sender: Sender;
  secret: string | null;
  registered: boolean;
};

export type BotDetail = {
  bot: Bot;
  messages: Message[];
  routines: Routine[];
  // Its webhook routines' webhooks, by routine, for the user to copy: never
  // in what the bot sees.
  webhooks: Record<string, Webhook>;
  // What is in its folder.
  files: BotFile[];
  // The shell commands it ran most recently, newest last.
  commands: string[];
};

// What a client asks the servers, its own or another's over the tailnet:
// a bot's go to the server that writes it.
export type Commands = {
  "bots.list": { args: Record<never, never>; result: Bot[] };
  "bot.get": { args: { botId: string }; result: BotDetail | null };
  "bot.create": {
    args: {
      name: string;
      hue: number;
      instructions: string;
      accessories?: Accessories;
    };
    result: Bot;
  };
  // A bot brought over from Grok Bot: it sets up what its recipe holds
  // beyond its name and instructions on its first run.
  "bot.import": {
    args: { recipe: GrokRecipe; hue: number; accessories?: Accessories };
    result: Bot;
  };
  "bot.update": {
    args: {
      botId: string;
      name?: string;
      hue?: number;
      accessories?: Accessories;
      instructions?: string;
      pinned?: boolean;
      voice?: VoiceSettings;
    };
    result: null;
  };
  "bot.delete": { args: { botId: string }; result: null };
  "bot.send": {
    args: {
      botId: string;
      text: string;
      uploads: Upload[];
      // The id of the message of this conversation it replies to.
      replyTo?: string;
      forwarded?: Forwarded;
    };
    result: Message;
  };
  "bot.stop": { args: { botId: string }; result: null };
  "message.react": {
    args: { botId: string; messageId: string; emoji: string };
    result: null;
  };
  // Only the user's own messages are edited and deleted.
  "message.edit": {
    args: { botId: string; messageId: string; text: string };
    result: null;
  };
  "message.delete": {
    args: { botId: string; messageId: string };
    result: null;
  };
  // A voice chat: on ChatGPT, the bot's host places the call for the
  // window's WebRTC offer and answers with the call's. On the user's own
  // models there is no offer: the window sends what the user says with
  // voice.hear and plays what voice.listen brings.
  "voice.start": {
    args: { botId: string; sdp: string | null };
    result: { callId: string; sdp: string | null };
  };
  "voice.stop": { args: { botId: string; callId: string }; result: null };
  // Something the user said, as WAV in base64.
  "voice.hear": {
    args: { botId: string; callId: string; audio: string };
    result: null;
  };
  // The next thing the bot says, as audio in base64; none when it says
  // nothing for a while, and ended once the call is over.
  "voice.listen": {
    args: { botId: string; callId: string };
    result: { clip: { audio: string; type: string } | null; ended: boolean };
  };
  // Watching a server's screen: it answers the window's WebRTC offer.
  "screen.view": {
    args: { hostId: string; sdp: string };
    result: { session: string; sdp: string };
  };
  "screen.close": { args: { hostId: string; session: string }; result: null };
  "routine.enable": {
    args: { botId: string; routineId: string; enabled: boolean };
    result: null;
  };
  // Who calls a webhook routine, or the secret of a sender that makes its
  // own, which the user pastes.
  "routine.webhook": {
    args: { botId: string; routineId: string; sender: Sender; secret?: string };
    result: null;
  };
  // A file of the bot's, base64.
  "file.read": { args: { botId: string; path: string }; result: string };
  // The whiteboard the bot and the user draw on: its elements, and the ids
  // of its images' files, each read once by `whiteboard.file`.
  "whiteboard.get": {
    args: { botId: string };
    result: { elements: BoardElement[]; files: string[] };
  };
  // The board as the bot sees it, a PNG in base64, for a window that does
  // not draw it itself, such as the phone's; null while nothing is drawn.
  "whiteboard.image": { args: { botId: string }; result: string | null };
  // The elements a window changed, merged into the board.
  "whiteboard.save": {
    args: { botId: string; elements: BoardElement[] };
    result: null;
  };
  "whiteboard.file": { args: { botId: string; id: string }; result: BoardFile };
  // An image's file a window added, as Excalidraw gives it.
  "whiteboard.addFile": {
    args: {
      botId: string;
      file: { id: string; mimeType: string; dataURL: string };
    };
    result: null;
  };
};

export type CommandName = keyof Commands;
export type Command = {
  [K in CommandName]: { type: K } & Commands[K]["args"];
}[CommandName];
export type ResultOf<K extends CommandName> = Commands[K]["result"];

// Something about the bots changed: one of them, only its whiteboard, or
// which there are.
export type Change = {
  botId: string | null;
  whiteboard?: true;
};

export type ChatgptState = {
  signedIn: boolean;
  email: string | null;
  // A sign-in waiting for its code to be entered.
  pending: { code: string; url: string } | null;
};

// The models this computer's user hosts, each a server behind an
// OpenAI-style API, in two lists with ChatGPT's place ("chatgpt") among them:
// the bots' models, which bots try in order, and the voice's transcription
// and speech models. A voice chat runs on ChatGPT's voice when it comes
// first, else on the user's models once there is one of each kind, which
// hearing and speaking each try in order.
export type ModelList = "bots" | "voice";
export type OwnModelKind = "bots" | "transcription" | "speech";
export type OwnModel = {
  id: string;
  kind: OwnModelKind;
  model: string;
  address: string;
};
export type OwnModelsState = Record<ModelList, (OwnModel | "chatgpt")[]>;
// What connecting a model takes: the server's address, the model's id
// (the server's first when blank) and its key, when it takes one.
export type OwnModelInput = { address: string; model: string; key: string };

// This server's Multidesktop, through which its bots use its screen: the
// version installed, none without one, and whether bots can use that
// version; and the user's other computers they reach through Multidesktop's
// cloud, null until m11 is signed in to it.
export type MultidesktopState = {
  version: string | null;
  current: boolean;
  installing: boolean;
  computers: string[] | null;
  signingIn: boolean;
};

// An app this computer's bots reach through Composio, by Composio's slug:
// connected, never connected, or connected once and needing a new sign-in.
export type Plugin = {
  slug: string;
  name: string;
  logo: string | null;
  status: "connected" | "notConnected" | "needsReconnecting";
};

export type PluginsState = {
  // Whether this computer has a Composio key.
  composio: boolean;
  // The apps whose sign-ins are open in the browser, by their slugs.
  connecting: string[];
};

export type PairingState = {
  // This computer's pairing code, in groups.
  code: string;
  // The user's computers whose OpenBots holds another code, by their names
  // on the tailnet.
  unpaired: string[];
};

export type AppState = {
  // This computer's user, by name.
  user: string;
  // This computer first.
  hosts: Host[];
  chatgpt: ChatgptState;
  ownModels: OwnModelsState;
  plugins: PluginsState;
  pairing: PairingState;
  tailscale: "running" | "stopped" | "missing";
  multidesktop: MultidesktopState;
  update: UpdateState;
  // The channel updates follow.
  channel: Channel;
};

export type Bridge = {
  // Node's name for the window's system, such as "darwin".
  platform: string;
  state: () => Promise<AppState>;
  call: <K extends CommandName>(
    command: { type: K } & Commands[K]["args"],
  ) => Promise<ResultOf<K>>;
  // Makes this computer a server, or only a client once another server has
  // every bot.
  setServer: (on: boolean) => Promise<void>;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  // Takes another computer's pairing code, or makes a new one (null).
  pair: (code: string | null) => Promise<void>;
  // The models a server serves, for the model field to suggest.
  servedModels: (address: string, key: string) => Promise<string[]>;
  // Checks the server answers before keeping it.
  connectModel: (kind: OwnModelKind, input: OwnModelInput) => Promise<void>;
  disconnectModel: (id: string) => Promise<void>;
  // A list of models in a new order, by id ("chatgpt" for ChatGPT).
  orderModels: (list: ModelList, order: string[]) => Promise<void>;
  // Checks a Composio key works before keeping it; an empty one removes it.
  setComposioKey: (key: string) => Promise<void>;
  // A page of the apps Composio offers, or only those connected.
  plugins: (query: {
    search: string;
    cursor: string | null;
    connected: boolean;
  }) => Promise<{ plugins: Plugin[]; cursor: string | null }>;
  // Opens the app's sign-in in the browser.
  connectPlugin: (slug: string) => Promise<void>;
  disconnectPlugin: (slug: string) => Promise<void>;
  // Asks the system to let bots see and use this computer's screen.
  allowScreen: () => Promise<void>;
  installMultidesktop: () => Promise<void>;
  // Signs m11 in to Multidesktop's cloud, so bots reach the user's other
  // computers.
  signInMultidesktop: () => Promise<void>;
  // The bots of Grok Bot's app on this computer, to bring over.
  grokBots: () => Promise<GrokRecipe[]>;
  checkForUpdate: () => Promise<UpdateState>;
  installUpdate: () => Promise<void>;
  // Follows the channel from now on and checks it.
  setChannel: (channel: Channel) => Promise<UpdateState>;
  openFile: (botId: string, path: string) => Promise<void>;
  openFolder: (botId: string) => Promise<void>;
  onState: (listener: (state: AppState) => void) => () => void;
  onChange: (listener: (change: Change) => void) => () => void;
  // The window has drawn the app: the JavaScript running works.
  ready: () => void;
};
