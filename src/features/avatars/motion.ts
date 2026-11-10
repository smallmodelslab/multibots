export const motions = ["look-around", "working", "asking"] as const;
export type Motion = (typeof motions)[number];
export type Gaze = { x: number; y: number };
export type Pose = {
  gaze: Gaze;
  openness: number;
  tilt: number;
  lift: number;
  scale: number;
};
export const cycleMs = 6000;
const ease = (t: number) => t * t * (3 - 2 * t);
const clamp = (n: number) => Math.max(0, Math.min(1, n));
const waypoints = [
  [0, 0, 0],
  [0.12, 0, 0],
  [0.22, -1, -0.15],
  [0.38, -1, -0.15],
  [0.49, 0.9, 0.1],
  [0.64, 0.9, 0.1],
  [0.74, 0.15, 0.8],
  [0.84, 0.15, 0.8],
  [0.96, 0, 0],
  [1, 0, 0],
] as const;

export const blinkAt = (elapsed: number) =>
  elapsed < 0 || elapsed > 220 ? 0 : Math.sin((Math.PI * elapsed) / 220) ** 2;

// A periodic, deterministic pose. The same samples drive SVG, live avatars and GIFs.
export function samplePose(
  timeMs: number,
  motion: Motion = "look-around",
  gaze?: Gaze | null,
): Pose {
  if (!Number.isFinite(timeMs) || !motions.includes(motion))
    throw new TypeError(
      `Invalid avatar timeline: ${timeMs}ms, motion ${motion}.`,
    );
  const t = (((timeMs % cycleMs) + cycleMs) % cycleMs) / cycleMs;
  let point: Gaze = { x: 0, y: 0 };
  for (let i = 1; i < waypoints.length; i++) {
    const a = waypoints[i - 1]!,
      b = waypoints[i]!;
    if (t <= b[0]) {
      const f = ease(clamp((t - a[0]) / (b[0] - a[0])));
      point = { x: a[1] + (b[1] - a[1]) * f, y: a[2] + (b[2] - a[2]) * f };
      break;
    }
  }
  const beat = Math.sin(t * Math.PI * 2);
  return {
    gaze: gaze ?? (motion === "working" ? { x: point.x * 0.6, y: 0.4 } : point),
    openness:
      (1 - Math.max(blinkAt(t * cycleMs - 950), blinkAt(t * cycleMs - 4040))) *
      (motion === "working" ? 0.8 : 1),
    tilt: motion === "asking" ? beat * 4 : point.x * 1.4,
    lift: motion === "working" ? (1 - Math.cos(t * Math.PI * 4)) * -1.5 : 0,
    scale: 1,
  };
}
