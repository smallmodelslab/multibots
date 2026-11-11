# Multibots

Bots that run on your own computers, on your ChatGPT subscription or models
you host. An open alternative to Grok Bot: each bot has a conversation, routines that wake it on
a schedule or when their webhook is called, a library of the files it keeps, and the computer it runs on.

Nothing runs on the internet for it. Any of the user's computers running
Multibots can be a server, which keeps a copy of every bot and runs them with
its own ChatGPT sign-in or the models it connects; Settings turns server mode
off on the rest, which then only show the bots, as the phone does. Computers
find each other over Tailscale and talk directly, so a laptop chats with the
bots its always-on desktops run, and they run their routines while it sleeps.
Bots outlive any server: a run goes on from its last step on another one.

## Moving from OpenBots

Multibots replaces OpenBots. On macOS, quit OpenBots on every server computer,
install Multibots once from [multibots.ca](https://multibots.ca/docs/), and remove
only the old application bundle. Keep offline servers stopped until updated.
The new bundle ID is `com.multibots`; macOS's updater cannot cross bundle
IDs. Future Multibots releases update normally. Linux's existing update feed
redirects to Multibots.

The profile stays at `~/Library/Application Support/OpenBots` on macOS and
`$XDG_CONFIG_HOME/OpenBots` (normally `~/.config/OpenBots`) on Linux. Its bots,
computer ID, credentials, pairing, analytics preference, update channel,
Chromium session and extension folder remain in place. Electron keeps the
`OpenBots` encryption identity before ready and switches to the Multibots name
once ready. The Chrome extension retains its key and native host ID; protocol
3 reloads its existing unpacked installation with the new name. The peer HTTP
protocol and webhook relay namespace remain unchanged for existing peers and
queued requests. These are persistent identities, not public branding.

## Download and install

Multibots runs on Apple silicon Macs and x86-64 Linux. There is no Windows or
Intel Mac version yet.

- [macOS, Apple silicon](https://wrkrsh.com/download/multibots/mac): open the
  disk image and drag Multibots to Applications.
- [Linux, x86-64](https://wrkrsh.com/download/multibots/linux): make the
  AppImage executable and run it.

  ```sh
  chmod +x multibots-*-linux-x86_64.AppImage
  ./multibots-*-linux-x86_64.AppImage
  ```

The links always give the newest release. Each installer's SHA-256 is in the
[release catalog](https://downloads.wrkrsh.com/multibots/channels/stable.json).

Then, as the [install guide](https://multibots.ca/docs/) covers in more
detail:

1. In Settings, sign in to ChatGPT, add models you host, or both.
2. To use bots from more than one computer, install
   [Tailscale](https://tailscale.com/download) on each, signed in as the same
   Tailscale user, and copy the pairing code from one computer's Settings
   into the others.
3. On macOS, allow what Multibots asks for: Local Network, to reach Multibots
   on your other computers (until it is allowed, they cannot connect);
   the microphone, when you start a voice chat; and, for bots to see and use
   the screen, Screen Recording and Accessibility for Multidesktop Bridge,
   which Settings installs and the Computer tab asks for.

## How it works

- **Bots** live in each server's data folder, one folder each under
  `bots/<id>`: `bot.json`, the visible `messages.json`, the model's
  `context.json`, with its older turns, which no model is sent again, in
  `history/`, `routines.json`, its webhooks, its whiteboard, and `files/`,
  the bot's folder. Its shell starts there and what it keeps there is its
  library. Files sent with a message land in `files/attachments/`; the model
  sees the newest four images and reaches the rest by path.
- **Servers** (`src/main/replica.ts`) each keep every bot's folder. One server
  writes a bot at a time and sends each file it changes to the others at
  once, with its version: when it was written, and by which server. The one
  holding a bot while it runs or is in a voice chat writes it; an idle bot is
  written by the server its id picks among those online, and a bot woken
  then goes to the server holding the fewest (`src/main/bots.ts`). Each
  time a server is given a bot, its run state's term goes up, and outranks
  the time a copy was written, so a server that held the bot before cannot
  write over the one holding it now. Every
  command for a bot goes to its writer, and a window asks any server. A
  server that goes away leaves its bots to the others, which go on from each
  run's last saved step. Two servers that meet, as when one comes back,
  each take what the other wrote meanwhile, and one that comes back takes
  it before it runs anything; one that comes back while none
  of them is online cannot know what they did, and may run a step again.
  Servers that cannot reach each other both run a bot until they meet, and
  its conversation then keeps what each said. Packages in `node_modules`
  and files over 200 MB stay on the server that has them. Turning server
  mode off hands every bot to the servers online first, and the last server
  cannot be turned off.
- **The agent** (`src/main/bots.ts`) runs in a server's main process with the AI SDK
  on Codex's Responses endpoint (`src/main/codex.ts`), on GPT-6.1 Terra where
  the ChatGPT account offers it and else its best model (`src/main/chatgpt.ts`),
  and the user's own models, in the fallback order Settings sets: each model
  call goes to the first that answers (`src/main/fallback.ts`), so a run that loses ChatGPT
  midway carries on with the next. A model further down is had only when a
  call reaches it, and gets as much of the conversation as fits its own
  window. It has a shell on its server, and through Multidesktop on the
  user's other computers, web search on ChatGPT, and tools to set and delete
  its routines (`src/main/tools.ts`). A run sends the
  newest turns that fit, at most about half the first model's window, and
  leaves out its oldest tools' results once its own steps would not;
  messages that arrive during a run wait for the next one. A shell command
  is done when its shell exits, so what it starts in the background goes
  on. A run saves each
  step as it finishes, with its inbox and its reply, so if the app quits or
  crashes, or its server goes, it goes on from its last finished step: nothing
  is lost or said twice, but a tool call in flight at that moment may run
  again.
- **Webhooks** wake routines from elsewhere, such as admin.wrkrsh.com's
  alerts. With nothing of its own on the internet, Multibots takes them at a
  relay, a Cloudflare Worker and Durable Object at hooks.wrkrsh.com
  ([`relay`](relay/src/index.ts)), which holds each request until the server
  writing the bot takes it over a WebSocket, so none is lost while no server
  listens. Opening the routine from the bot's details, the user copies its
  URL and picks its sender: any that shows a Bearer key, or GitHub, Stripe,
  Slack or a sender of Standard Webhooks, which sign each request
  ([`packages/webhooks`](packages/webhooks/src/senders.ts)). The secret is
  made here, for the user to copy, or pasted from the sender. Every server
  keeps it with the bot, and the secret its writer listens with, sealed like
  the ChatGPT sign-in (`src/main/webhooks.ts`), and the bot never sees either. The relay keeps
  the sender's secret to check each request and to answer the sender's own
  checks while the computer sleeps. A request wakes the bot with its body as
  data, once it is saved with the bot's context in one write, so a request
  is never taken twice.
- **The whiteboard** each bot shares with the user is Multiwork's, on the
  shared [`packages/whiteboard`](packages/whiteboard): Excalidraw's
  elements in `whiteboard.json`, its images' files in `whiteboard/`. Windows
  draw on it through the bot's server, which merges what each changed
  element by element. The bot looks with `view_whiteboard`, its elements as
  text and an image its server renders in a hidden window
  (`src/renderer/whiteboard.html`), and draws with `edit_whiteboard`.
- **The screen** of a bot's server is its own to see and use, as Grok
  Bot's bots have theirs (`src/main/computer.ts`), through the server's own
  [Multidesktop](https://wrkrsh.com/multidesktop), so one copy of its bridge holds
  the screen's permissions. When Multidesktop runs as the user's service,
  Multibots uses that desktop through its local socket; otherwise it runs the
  installed release itself, without a cloud (`multidesktop --local`). Settings
  installs it with Multidesktop's own installer when it is missing or older
  than 0.4.7, and moves an older service onto it with `multidesktop up`. A
  bot's computer tool runs
  JavaScript in m11's computer-use REPL, the API every wrkrsh product shares,
  for the rest of its run; the model sees the newest three screenshots, and
  none are kept after. Once Settings signs m11 in to Multidesktop's cloud,
  the bot also reaches the user's other computers there: its shell and
  computer tools name the one they act on, and run on its server otherwise.
  On macOS, Multidesktop Bridge needs Screen Recording and Accessibility,
  which the Computer tab asks for. A window on another of the user's
  computers watches the server's screen live there, over WebRTC, its offer
  handed to the desktop by that server's Multibots. A bot on this computer
  uses the screen the user sees, so nothing streams.
- **ChatGPT** (`src/main/chatgpt.ts`) signs in with Codex's device code. The
  tokens stay on this computer, sealed by the system keychain, or on Linux
  without a keyring in a file only the user can read, as Codex keeps them.
  Each server signs in for itself, since a refresh token works once.
- **Own models** (`src/main/ownModels.ts`, `src/main/ownServer.ts`) are
  servers behind an OpenAI-style API, such as vLLM, SGLang, Ollama, LM
  Studio, mlx-audio or OpenAI's own: each an address, a model and an
  optional key, kept on each server and sealed like the ChatGPT sign-in.
  Settings adds any number of bots' models, which run on chat completions
  (a tool's screenshots go to it in a message after the tool's result, and
  ChatGPT's web searches are left out of what it said), and any number of
  a voice's transcription and speech models, as open speech models such as
  Ming's are served. Each list has its own fallback order with ChatGPT in
  it. Connecting checks the server's `/models` and suggests them, and has a
  speech model say a word: a bot that picks none of the voices its
  `/audio/voices` lists speaks in the server's own when it takes a call
  without one, as Ming's does, else in the first it lists or OpenAI's.
- **Plugins** (`src/main/plugins.ts`) are the apps bots reach through
  [Composio](https://composio.dev), on the user's own Composio API key,
  kept on each server and sealed like the ChatGPT sign-in. The Plugins
  page lists Composio's apps, those connected first, and connects one with
  Composio's sign-in in the browser. Bots take Composio's tools from one
  session, kept across launches: they search for the tools a task needs, run
  them, and hand the user a link to connect an app that is not connected
  yet. Every computer given the same key shares its connections, since its
  Composio project has the one user `openbots`.
- **Grok Bot's bots** come over in the new-bot wizard (`src/main/grokBot.ts`):
  one of those Grok Bot's app keeps on this computer, with its name,
  instructions and colour, or one from a Grok Bot template recipe, a JSON
  file the user asks their Grok bot for. A recipe's skills and the log of its
  work become files in the bot's folder, listed in its instructions with the
  rest of what it remembers; on its first run the bot sets up its routines,
  whose schedules Grok Bot gives in words, paused until the user turns them
  on, and links the apps it used.
- **Peers** (`src/main/peers.ts`) come from `tailscale status`: the online
  devices of the same Tailscale user, not tagged devices such as shared
  servers. Each client listens on its own tailnet
  address (port 47100, or `MULTIBOTS_PORT`) and answers only those devices'
  addresses, and of those only the clients holding its pairing code
  (`src/shared/peer.ts`). Settings shows the code; the user copies one
  computer's into the others and into the phone. Every request is signed
  with the code, for the address it is sent to, and the computer answering
  proves it holds the code too, so the code never crosses the tailnet. A
  client asks a server about the bots (`src/shared/types.ts`, `Commands`),
  which hands each bot's command to its writer, and hears what changes on
  each computer's event stream, which also tells the servers what the bots
  each one writes are doing. A client that finds another says hello, so the
  other connects back, and asks it for the computers it reaches.
- **Voice chat** is Codex's voice mode on the ChatGPT sign-in of the bot's
  server (`src/main/voice.ts`), or its own transcription and speech
  models, whichever comes first in the voice's fallback order once it can
  be had (one of each kind for its own); a call ChatGPT can't place falls
  back to the user's models. The window offers a WebRTC call with its
  microphone (`src/features/bots/voiceChat.ts`); the bot's server places it
  at Codex's endpoint and joins the call's socket, which hands what the user
  asks to the bot as a message and gives the voice what the bot says. The
  call takes only a voice, so the bot's language and pace go to the voice in
  words. On the user's own models, the window hears the user itself: it
  sends what they say between pauses as WAV (`voice.hear`), which the first
  transcription model that answers writes down for the bot, and plays the
  first speech model's reading of what the bot says (`voice.listen`), not
  hearing meanwhile. The bot then writes its replies to be read aloud. The
  call ends when no speech model answers.
- **The phone** ([`mobile`](mobile/README.md)) is a client of the user's
  servers: an Expo app in Messages' layout that reaches the user's computers
  over the tailnet as they reach each other. Given one computer's address, it
  finds the rest through it (`GET /openbots/peers`).
- **The window** (`src/renderer`, `src/features`) is Multiwork's desktop GUI in
  Grok Bot's layout, without a bar along the top: pinned bots in a grid over
  the rest of the user's bots, the conversation, and the bot's details beside
  it.

## Security

A bot acts as you on its servers, and on the computers it reaches through
Multidesktop. Its shell runs any command with your
permissions, unsandboxed and without asking, and it reads web search results
and the apps you connect through Composio. Anything it reads, such as a web
page, an email, a webhook's request or a file, can try to steer it into running commands or
sending your data elsewhere (prompt injection). Give a bot only the apps you
would let it act in, and make servers only of computers you would let it
use.

Your bots answer only your computers and phone that hold your pairing code;
other users of a computer, and other devices on your tailnet, cannot reach
them, and the data folder is yours alone to read. Anything that runs as you
can, as it could run the commands itself. A new code in Settings cuts off
every computer and phone until they are given it.

## Development

Bots use colored squircle avatars with saved hats and glasses. The new-bot
wizard (on the shared `@wrkrsh/wizard`) dresses a bot as it is made; Details →
Appearance changes its outfit later and downloads a looking-around, working or
waiting GIF.
The live avatars and exports share one SVG/motion engine in
[`src/features/avatars`](src/features/avatars/README.md). Generate a GIF from the
command line with `bun run avatar:gif --hue 215 --hat cap --glasses round --out bot.gif`.

Use Node 24 and Bun 1.4.4.

`packages/` holds copies of the wrkrsh packages Multibots shares with other
apps: client-log, composer, computer-use, electron-update, flags, glow, pencil,
webhooks, whiteboard and wizard. They are kept as they are there, so formatting and lint leave them
alone; types still check them.

```sh
cd multibots
bun install
bun run dev
```

`MULTIBOTS_HOME` points a client at another data folder and `MULTIBOTS_PORT` at
another port, so more clients, servers or not, run beside the first on one
computer. Each finds the first on this computer's tailnet address, and the
rest through it.

`MULTIBOTS_RELAY` points a client's webhooks at another relay, such as
`wrangler dev`'s at `http://127.0.0.1:8787` (`bun run dev` in `relay/`).

`MULTIBOTS_MULTIDESKTOP` points at a Multidesktop build of one's own, such as
a `cargo build` directory after `./bundle-macos.sh` on macOS, which Multibots
then runs in place of the installed one or the service.

On macOS the app needs Local Network access to reach other clients; until it
is allowed, requests to and from it hang.

Checks: `bun run format:check`, `bun run lint`, `bun run typecheck`, `bun run test`
and `bun run build`; in `relay/` and `site/`, the same but `test`.

[multibots.ca](https://multibots.ca) is [`site`](site/index.html), its own
package beside the app: the bot from `src/features/avatars` wakes up, greets
the visitor and says what it does as they scroll. `bun run dev` there serves
it. Its download buttons are wrkrsh.com's links to the current installers
(`wrkrsh.com/download/multibots/<platform>`), and a Cloudflare Worker
(`site/worker.ts`) serves the build and proxies PostHog, for the site and for
the app. The monorepo's CI deploys it on every merge.

Released builds tell PostHog which features are used, whether they worked,
and what failed (`src/main/analytics.ts`), unless the user turns it off under
Privacy in Settings. Features in progress ship behind flags
(`src/features/flags.ts`), set under Flags in Settings; every analytics event
and log record names the flags on.

`bun run package` builds an unsigned installer for this computer into `dist/`.
Signed installers and JavaScript updates are released from the wrkrsh
monorepo's GitHub Actions. Installed apps update through
[`packages/electron-update`](packages/electron-update/README.md).

## License

Multibots is free software under the [GNU Affero General Public License
v3.0](LICENSE).
