# Squircle avatars

All OpenBots faces use the approved closed squircle, the bot's color, and its
saved hat/glasses. Existing bots get a stable outfit from their ID. Choose the
color, hat and glasses when making a bot, where the face reacts to each change,
or later in its Details → Appearance section, which also downloads a GIF of
Look around, Working or Waiting.

`appearance.ts` defines identity and validated accessory choices. `motion.ts`
samples deterministic six-second loops. `parts.ts` holds the face, outfits and
colours, which the landing page (`site/`) draws from too; `artwork.ts` renders
a pose as SVG from them.
`controller.ts` adds live gaze, blinking and reactions; `SquircleAvatar.tsx`
shares one 30fps clock and stops drawing hidden/offscreen/reduced-motion faces.
`gif.ts` uses the same poses and SVG renderer, with a single global palette and
transparent disposal. Rasterization is injected: Canvas in the app, Resvg in
the CLI. GIF delays are rounded cumulatively to GIF's centiseconds, preserving
the total six-second duration even at 30fps.

```ts
import { createAvatarController } from "./controller";
const avatar = createAvatarController({
  hue: 215,
  hat: "cap",
  glasses: "round",
});
avatar.lookAt(-0.8, 0.2);
avatar.blink();
avatar.react();
avatar.releaseGaze(); // resumes the autonomous look-around loop
```

Generate a GIF without running Electron, from the `openbots` directory:

```sh
bun run avatar:gif --hue 215 --hat cap --glasses round --out blue-bot.gif
bun run avatar:gif --hue 330 --hat party --motion asking --size 512 --fps 30 --out pink-bot.gif
```

Hats: `none`, `beanie`, `cap`, `top-hat`, `party`.
Glasses: `none`, `round`, `square`, `sunglasses`.
Motions: `look-around`, `working`, `asking`.
Default exports are transparent 256×256 GIFs at 20fps, looping forever.

Run `bun test ./src/features/avatars` for rendering, GIF generation, identity,
pose-loop and save/reload checks. No credentials or running agents are needed.
