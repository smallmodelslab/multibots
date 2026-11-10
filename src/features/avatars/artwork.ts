import { appearanceSchema, avatarColor, type Appearance } from "./appearance";
import type { Pose } from "./motion";

// The approved closed face, with generous headroom for hats and motion.
const head =
  "M64 27C31 27 16 39 16 69C16 100 29 112 64 112C99 112 112 100 112 69C112 39 97 27 64 27Z";
const ink = "#18212b";
const hats = (color: string): Record<Appearance["hat"], string> => ({
  none: "",
  beanie: `<path d="M35 31Q35 9 64 9Q93 9 93 31Z" fill="${color}"/><path d="M32 28Q64 21 96 28L96 37Q64 30 32 37Z" fill="${color}"/><circle cx="64" cy="7" r="5" fill="${color}"/>`,
  cap: `<path d="M35 31Q38 10 67 13Q87 15 90 32Z" fill="${color}"/><path d="M61 31Q91 26 107 34Q98 41 64 37Z" fill="${color}"/><path d="M66 14L65 29" fill="none"/>`,
  "top-hat": `<path d="M43 31L40 6Q64 1 88 6L85 31Z" fill="${color}"/><path d="M42 24L86 24L85 31L43 31Z" fill="#fff"/><ellipse cx="64" cy="32" rx="36" ry="6" fill="${color}"/>`,
  party: `<path d="M39 32L62 3L86 32Z" fill="${color}"/><path d="M49 19L76 19M44 27L82 27" stroke="#fff"/><circle cx="62" cy="4" r="3" fill="#f3c55b"/>`,
});
const specs: Record<Appearance["glasses"], string> = {
  none: "",
  round: `<circle cx="46" cy="68" r="15"/><circle cx="82" cy="68" r="15"/><path d="M61 67Q64 64 67 67M31 65L22 61M97 65L106 61"/>`,
  square: `<rect x="30" y="55" width="31" height="25" rx="6"/><rect x="67" y="55" width="31" height="25" rx="6"/><path d="M61 64H67M30 61L22 58M98 61L106 58"/>`,
  sunglasses: `<path d="M29 56H61L58 77Q44 84 33 75ZM67 56H99L95 75Q83 84 70 77Z" fill="${ink}"/><path d="M60 62H68M29 59L21 56M99 59L107 56"/><path d="M37 61L44 61M76 61L83 61" stroke="#fff"/>`,
};

export function renderAvatar(appearance: Appearance, pose: Pose): string {
  appearanceSchema.parse(appearance);
  const color = avatarColor(appearance.hue),
    accent = avatarColor(appearance.hue + 150);
  const x = Math.max(-1, Math.min(1, pose.gaze.x)) * 9;
  const y = Math.max(-1, Math.min(1, pose.gaze.y)) * 5;
  const eyeHeight = Math.max(1.4, 23 * pose.openness);
  const body = `<g transform="translate(0 ${pose.lift.toFixed(3)}) rotate(${pose.tilt.toFixed(3)} 64 74) translate(64 74) scale(${pose.scale.toFixed(3)}) translate(-64 -74)">
<path d="${head}" fill="${color}" stroke="${ink}" stroke-width="5"/>
<g transform="translate(${x.toFixed(3)} ${y.toFixed(3)})" fill="${ink}"><rect x="41" y="${(68 - eyeHeight / 2).toFixed(3)}" width="10" height="${eyeHeight.toFixed(3)}" rx="5"/><rect x="77" y="${(68 - eyeHeight / 2).toFixed(3)}" width="10" height="${eyeHeight.toFixed(3)}" rx="5"/></g>
<g transform="translate(${(x * 0.2).toFixed(3)} ${(y * 0.2).toFixed(3)})" fill="none" stroke="${ink}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">${specs[appearance.glasses]}</g>
<g stroke="${ink}" stroke-width="2.5" stroke-linejoin="round">${hats(accent)[appearance.hat]}</g></g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">${body}</svg>`;
}
