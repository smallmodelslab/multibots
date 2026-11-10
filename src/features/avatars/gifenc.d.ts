declare module "gifenc" {
  export type Palette = number[][];
  export function quantize(
    rgba: Uint8Array | Uint8ClampedArray,
    colors: number,
    options?: { format?: "rgba4444"; oneBitAlpha?: boolean },
  ): Palette;
  export function applyPalette(
    rgba: Uint8Array | Uint8ClampedArray,
    palette: Palette,
    format?: "rgba4444",
  ): Uint8Array;
  export function GIFEncoder(): {
    writeFrame(
      index: Uint8Array,
      width: number,
      height: number,
      options: {
        palette?: Palette;
        delay: number;
        repeat: number;
        transparent: boolean;
        transparentIndex: number;
        dispose: number;
      },
    ): void;
    finish(): void;
    bytes(): Uint8Array;
  };
}
