import { encodeAvatarGif, type GifOptions } from "./gif";
import type { Appearance } from "./appearance";

export async function downloadAvatarGif(
  appearance: Appearance,
  name: string,
  options?: GifOptions,
) {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context)
    throw new Error(
      "Could not create a Canvas 2D context for avatar GIF export.",
    );
  const bytes = await encodeAvatarGif(
    appearance,
    async (svg, size) => {
      const url = URL.createObjectURL(
        new Blob([svg], { type: "image/svg+xml" }),
      );
      try {
        const image = new Image();
        image.src = url;
        await image.decode();
        canvas.width = canvas.height = size;
        context.clearRect(0, 0, size, size);
        context.drawImage(image, 0, 0, size, size);
        const rgba = context.getImageData(0, 0, size, size).data;
        // Yield between frames so an export never freezes the rest of the app.
        await new Promise((resolve) => setTimeout(resolve, 0));
        return rgba;
      } finally {
        URL.revokeObjectURL(url);
      }
    },
    options,
  );
  const url = URL.createObjectURL(
    new Blob([new Uint8Array(bytes)], { type: "image/gif" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `${name.replace(/[^a-z0-9_-]/gi, "-") || "bot"}.gif`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
