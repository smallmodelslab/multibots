# Electron updates

Installer and JavaScript updates for the Electron apps (Multiwork, Turbotex,
Tutor, OpenBots, Yeecell). The signed installer owns `out/bootstrap`, Electron,
installed npm dependencies and native code. A JavaScript release is the rest of `out`, an
ASAR under the user's application data, outside the signed application.
Nothing rewrites the installed `app.asar`.

## In an app

`updates.json` beside the app's `package.json` names the product, its public
key, its native contract and any top-level CLI commands. The app's
`package.json` points `main` at `out/bootstrap/index.js`, its JavaScript build
ends with `electron-update launcher`, and its main process uses `updates()`:

- `start(hooks)` once the app can show windows: `onChange` pushes the
  `UpdateState` to windows and the menu, `prepareToRestart` runs the app's save
  and shutdown path (false cancels), `reload` loads every window again from
  `renderer()`.
- `renderer("index.html")` is the window code of the release running. Load
  pages through it, never through `__dirname`, so a reload shows the new release.
- `ready()` once the window works. A release that never gets there rolls back.
- `menuItem()`, `check()`, `install()` for the app's update controls.
- `channel()` and `setChannel(channel)` for an app with stable and nightly
  releases. An install follows the channel picked in the app, else its
  version's. A switch takes effect at once, even when the other channel's
  newest build is older: it drops an update downloaded from the channel left
  behind and checks the new one. JavaScript releases are kept per channel, so
  the new channel's arrive after the next launch. Until the channel picked has
  a release, installer or JavaScript, the install reads its version's feed in
  its place and keeps running its version channel's JavaScript release, so
  picking nightly before its first release changes nothing.
- `release`, `commit` and `session` for log records. The commit comes from the
  signed release, so builds of unchanged main code stay byte-identical.

## How a release installs

The launcher checks after 15 seconds and every four hours; an installer takes
priority. A JavaScript release whose files outside `out/renderer` match the code
running installs by **Update**: the windows reload into it, nothing stops and
nothing is confirmed. Any other release, and every installer, installs by
**Restart to Update…**, confirmed once, through the app's save and shutdown
path; the state is `restarting` from the confirmation until the app stops, so
windows can say it is updating. Staging never activates anything on an
ordinary quit.

A new release becomes the working one only when the app calls `ready()`. A
startup failure, a 60-second timeout or an unfinished first launch reverts to
the last working release or the installer's code; a reloaded window that is not
ready within 60 seconds reloads the previous one. A release that already worked
is abandoned only after a startup failure or three unfinished launches in a
row. Failed releases are not retried; publish a newer one. Failures go to the
app's log (`<product>.jsonl`), never to dialogs.

Bare imports from a release resolve to the installed dependencies through
Node's synchronous module hooks; native modules never come from a release.
Installer builds record their workflow run ID, and the launcher ignores
releases from earlier runs, whose code is older than the installer's. CLI
invocations run the last working release and never change boot state.

## Trust and the native contract

The launcher verifies an Ed25519 signature and the whole bundle hash before
every launch. The public key is in `updates.json`; the private key exists only
as the app's `<PRODUCT>_JS_UPDATE_SIGNING_KEY` Actions secret. Rotate it with
an installer release.

The native contract is a fingerprint of the tracked files `updates.json` lists,
plus `updates.json` and this package. Dependency changes conservatively need a
new installer, even JavaScript-only ones. Installer releases publish it as
`javascript-runtime.json`; releases for it live under
`<product>/javascript/<runtime>/` in the shared R2 bucket. An install reads
the feed of the channel it follows there, named as electron-builder names
installer feeds: stable reads `updates/latest.json` and nightly
`updates/nightly.json`.

## Release

After merging a change, run the app's JavaScript workflow (see
[RELEASING.md](../../RELEASING.md)). It builds without native code, packaging,
signing or notarization, and `electron-update release [channel]` refuses to
sign unless that channel's installer (stable by default) has the same native
contract; otherwise release the installer first. The run ID is the release sequence; reruns cannot replace
released bytes.

## Verification

```sh
pnpm install && pnpm run check && pnpm test
env -u ELECTRON_RUN_AS_NODE node --import tsx smoke.mjs
```

The smoke runs real Electron against ESM and CommonJS apps with a temporary key,
user data and feed. On Linux run it under `xvfb-run -a`.
