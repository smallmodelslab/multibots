# Multibots for iPhone

The user's bots on their phone, in Messages' layout: the bots, each
conversation, and a bot's profile with the computer it runs on (its screen
live), its whiteboard, its files and its details, where its routines open
(a webhook routine's with its sender, URL and secret), and voice chat.

The phone is a client, as a computer with server mode off is: it keeps no
bots and runs none. It reaches the user's computers running Multibots over
their tailnet, as they reach each other, so the phone needs Tailscale on the
same account and the pairing code the computers share. The user adds one
computer by its Tailscale address and that code; the phone finds the others
through it (`GET /openbots/peers`) and keeps their addresses. It asks a server
what the desktop's window asks (`src/shared/types.ts`, `Commands`) and hears
what changes on each computer's events stream, with the window's cache
(`src/shared/store.ts`). The whiteboard is an image a server draws
(`whiteboard.image`).

It shares the desktop's protocol, schedules, voices, hearing and avatars from
`../src`; Metro reads them with this app's packages.

## Development

Use Node 24, Bun 1.4.4 and Xcode with an iOS 26 simulator.

```sh
cd multibots/mobile
bun install
bun run ios
```

`react-native-webrtc` (the live screen and ChatGPT voice) needs a development
build, not Expo Go.

To try it against a computer of one's own without one's other Multibots, run a
desktop client with its own `MULTIBOTS_HOME` and `MULTIBOTS_PORT` and a `tailscale`
first on its `PATH` that prints
`{"BackendState":"Running","Self":{"TailscaleIPs":["127.0.0.1"],"UserID":1}}`:
it then listens on 127.0.0.1, which the simulator reaches as `127.0.0.1:<port>`.

Checks: `bun run format:check`, `bun run lint` and `bun run typecheck`.

## Releases

The monorepo's `multibots-mobile-release.yml` releases the app through EAS
(`.eas/workflows/release.yml`). Nightly takes main and stable a nightly's tag.
When the native fingerprint matches the channel's build, the channel gets an
OTA update; otherwise a new build goes to TestFlight, and a stable one is then
submitted for App Store review with the listing in `app-store/`.
