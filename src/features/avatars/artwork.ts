import { appearanceSchema, type Appearance } from "./appearance";
import type { Pose } from "./motion";
import { avatarColor, glassesArt, hatArt, head, ink } from "./parts";

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
<g transform="translate(${(x * 0.2).toFixed(3)} ${(y * 0.2).toFixed(3)})" fill="none" stroke="${ink}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">${glassesArt[appearance.glasses]}</g>
<g stroke="${ink}" stroke-width="2.5" stroke-linejoin="round">${hatArt(accent)[appearance.hat]}</g></g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">${body}</svg>`;
}
