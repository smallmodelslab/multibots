import { appearanceSchema, type Appearance } from "./appearance";
import { z } from "zod";
import { blinkAt, samplePose, motions, type Pose } from "./motion";

const stateSchema = z
  .object({
    appearance: appearanceSchema.readonly(),
    motion: z.enum(motions),
    gaze: z
      .object({ x: z.number().min(-1).max(1), y: z.number().min(-1).max(1) })
      .readonly()
      .nullable(),
    openness: z.number().min(0).max(1),
    talking: z.boolean(),
  })
  .strict()
  .readonly();
export type AvatarState = z.infer<typeof stateSchema>;
export type AvatarPatch = Partial<AvatarState>;
export function createAvatarController(appearance: Appearance, phase = 0) {
  if (!Number.isFinite(phase))
    throw new TypeError(`Avatar phase must be finite; received ${phase}.`);
  let state = stateSchema.parse({
    appearance,
    motion: "look-around",
    gaze: null,
    openness: 1,
    talking: false,
  });
  let blinkStarted = -Infinity,
    reactionStarted = -Infinity;
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const listener of listeners) listener();
  };
  return {
    getState: () => state,
    setState(patch: AvatarPatch) {
      const next = stateSchema.parse({ ...state, ...patch });
      state = next;
      emit();
    },
    lookAt(x: number, y = 0) {
      this.setState({ gaze: { x, y } });
    },
    releaseGaze() {
      this.setState({ gaze: null });
    },
    blink() {
      blinkStarted = performance.now();
      emit();
    },
    react() {
      reactionStarted = performance.now();
      emit();
    },
    pose(now: number, reduced = false): Pose {
      const pose = samplePose(
        reduced ? 0 : now + phase,
        state.motion,
        state.gaze,
      );
      if (reduced)
        return { ...pose, openness: state.openness, tilt: 0, lift: 0 };
      const elapsed = now - reactionStarted;
      const reaction =
        elapsed >= 0 && elapsed < 700 ? Math.sin((Math.PI * elapsed) / 700) : 0;
      return {
        ...pose,
        openness:
          pose.openness *
          state.openness *
          (1 - blinkAt(now - blinkStarted)) *
          (state.talking ? 0.9 + Math.sin(now / 110) * 0.1 : 1),
        tilt: pose.tilt + reaction * 5,
        scale: 1 + reaction * 0.05,
      };
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
export type AvatarController = ReturnType<typeof createAvatarController>;
