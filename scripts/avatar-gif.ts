import { parseArgs } from "node:util";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Resvg } from "@resvg/resvg-js";
import { encodeAvatarGif } from "../src/features/avatars/gif";
import { accessoriesSchema } from "../src/features/avatars/appearance";
import { motions, type Motion } from "../src/features/avatars/motion";

const { values } = parseArgs({
  options: {
    hue: { type: "string", default: "215" },
    hat: { type: "string", default: "none" },
    glasses: { type: "string", default: "none" },
    motion: { type: "string", default: "look-around" },
    size: { type: "string", default: "256" },
    fps: { type: "string", default: "20" },
    out: { type: "string", default: "bot.gif" },
  },
});
try {
  if (!motions.includes(values.motion as Motion))
    throw new Error(
      `Unknown motion ${values.motion}; choose ${motions.join(", ")}.`,
    );
  const appearance = {
    hue: Number(values.hue),
    ...accessoriesSchema.parse({ hat: values.hat, glasses: values.glasses }),
  };
  const bytes = await encodeAvatarGif(
    appearance,
    async (svg, size) =>
      new Resvg(svg, {
        fitTo: { mode: "width", value: size },
        font: { loadSystemFonts: false },
      }).render().pixels,
    {
      size: Number(values.size),
      fps: Number(values.fps),
      motion: values.motion as Motion,
    },
  );
  const path = resolve(values.out!);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
  console.log(`Saved ${path} (${bytes.length} bytes, six-second loop).`);
} catch (error) {
  console.error("Avatar GIF generation failed:", error);
  process.exitCode = 1;
}
