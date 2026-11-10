import { GIFEncoder, quantize, applyPalette, type Palette } from "gifenc";
import type { Appearance } from "./appearance";
import { renderAvatar } from "./artwork";
import { cycleMs, samplePose, type Motion } from "./motion";

export type GifOptions = { size?: number; fps?: number; motion?: Motion };
export type Rasterize = (
  svg: string,
  size: number,
) => Promise<Uint8Array | Uint8ClampedArray>;

// Rasterization is the only environment-specific interface: Canvas in the app,
// Resvg in the CLI. Timing, drawing, palette and GIF encoding are shared.
export async function encodeAvatarGif(
  appearance: Appearance,
  rasterize: Rasterize,
  { size = 256, fps = 20, motion = "look-around" }: GifOptions = {},
) {
  if (!Number.isInteger(size) || size < 32 || size > 1024)
    throw new RangeError(
      `GIF size must be an integer from 32 to 1024; received ${size}.`,
    );
  if (!Number.isInteger(fps) || fps < 1 || fps > 50)
    throw new RangeError(
      `GIF fps must be an integer from 1 to 50; received ${fps}.`,
    );
  const gif = GIFEncoder(),
    count = (cycleMs / 1000) * fps;
  let palette: Palette | undefined;
  let transparentIndex = -1;
  for (let frame = 0; frame < count; frame++) {
    const rgba = await rasterize(
      renderAvatar(appearance, samplePose((frame * cycleMs) / count, motion)),
      size,
    );
    if (rgba.length !== size * size * 4)
      throw new Error(
        `Avatar rasterizer returned ${rgba.length} bytes; expected ${size * size * 4} RGBA bytes.`,
      );
    // Colors do not change during a pose loop. One global palette avoids
    // color shimmer and repeating expensive quantization on every frame.
    if (!palette) {
      palette = quantize(rgba, 256, { format: "rgba4444", oneBitAlpha: true });
      transparentIndex = palette.findIndex((color) => color[3] === 0);
      if (transparentIndex > 0) {
        [palette[0], palette[transparentIndex]] = [
          palette[transparentIndex]!,
          palette[0]!,
        ];
        transparentIndex = 0;
      }
    }
    gif.writeFrame(applyPalette(rgba, palette, "rgba4444"), size, size, {
      palette: frame === 0 ? palette : undefined,
      delay:
        (Math.round(((frame + 1) * 100) / fps) -
          Math.round((frame * 100) / fps)) *
        10,
      repeat: 0,
      transparent: transparentIndex !== -1,
      transparentIndex: Math.max(0, transparentIndex),
      dispose: 2,
    });
  }
  gif.finish();
  return gif.bytes();
}
