// What every face is drawn from, free of the schemas so the landing page
// (site/bot.ts) draws the same bot as the app: the approved closed face,
// with generous headroom for hats and motion, its ink, outfits and colours.
export const head =
  "M64 27C31 27 16 39 16 69C16 100 29 112 64 112C99 112 112 100 112 69C112 39 97 27 64 27Z";
export const ink = "#18212b";
export const hatArt = (color: string) => ({
  none: "",
  beanie: `<path d="M35 31Q35 9 64 9Q93 9 93 31Z" fill="${color}"/><path d="M32 28Q64 21 96 28L96 37Q64 30 32 37Z" fill="${color}"/><circle cx="64" cy="7" r="5" fill="${color}"/>`,
  cap: `<path d="M35 31Q38 10 67 13Q87 15 90 32Z" fill="${color}"/><path d="M61 31Q91 26 107 34Q98 41 64 37Z" fill="${color}"/><path d="M66 14L65 29" fill="none"/>`,
  "top-hat": `<path d="M43 31L40 6Q64 1 88 6L85 31Z" fill="${color}"/><path d="M42 24L86 24L85 31L43 31Z" fill="#fff"/><ellipse cx="64" cy="32" rx="36" ry="6" fill="${color}"/>`,
  party: `<path d="M39 32L62 3L86 32Z" fill="${color}"/><path d="M49 19L76 19M44 27L82 27" stroke="#fff"/><circle cx="62" cy="4" r="3" fill="#f3c55b"/>`,
});
export const glassesArt = {
  none: "",
  round: `<circle cx="46" cy="68" r="15"/><circle cx="82" cy="68" r="15"/><path d="M61 67Q64 64 67 67M31 65L22 61M97 65L106 61"/>`,
  square: `<rect x="30" y="55" width="31" height="25" rx="6"/><rect x="67" y="55" width="31" height="25" rx="6"/><path d="M61 64H67M30 61L22 58M98 61L106 58"/>`,
  sunglasses: `<path d="M29 56H61L58 77Q44 84 33 75ZM67 56H99L95 75Q83 84 70 77Z" fill="${ink}"/><path d="M60 62H68M29 59L21 56M99 59L107 56"/><path d="M37 61L44 61M76 61L83 61" stroke="#fff"/>`,
};

export const avatarColor = (hue: number) => {
  if (!Number.isFinite(hue))
    throw new TypeError(`Avatar hue must be finite; received ${hue}.`);
  const channel = (offset: number) => {
    const k = (offset + (((hue % 360) + 360) % 360) / 30) % 12;
    return Math.round(
      (0.73 - 0.22 * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255,
    )
      .toString(16)
      .padStart(2, "0");
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
};
