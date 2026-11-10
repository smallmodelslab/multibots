const turn = 450;
const rotation = [
  { transform: "rotate(0deg)" },
  { transform: "rotate(360deg)" },
];

// Each curve's slope where it meets the steady spin equals its length in
// turns, so the speed carries over without a kick. Speeding up only softens
// the first moment; slowing down is a long cubic glide to rest.
const speedUp = {
  duration: 1.1 * turn,
  easing: "cubic-bezier(0.15, 0.03, 0.25, 0.175)",
};
const slowDown = {
  duration: 3 * turn,
  easing: "cubic-bezier(0.333, 1, 0.667, 1)",
};

export type Spin = {
  cancel: () => void;
  start: () => void;
  /** Resolves once the element is at rest. */
  stop: () => Promise<void>;
};

/** Spins an element in whole turns: it eases up to speed, keeps going while
    wanted, then finishes its turn and eases to rest upright. */
export const spin = (element: Element): Spin => {
  let wanted = false;
  let running = false;
  let steady: Animation | null = null;
  let settle = () => {};
  let rest = Promise.resolve();

  const once = (timing: KeyframeAnimationOptions) =>
    element.animate(rotation, timing).finished;

  const run = async () => {
    running = true;
    await once(speedUp);
    if (wanted) {
      steady = element.animate(rotation, {
        duration: turn,
        iterations: Infinity,
      });
      await steady.finished;
      steady = null;
    }
    await once(slowDown);
    running = false;
    if (wanted) void run().catch(() => {});
    else settle();
  };

  return {
    cancel: () => {
      wanted = false;
      for (const animation of element.getAnimations()) animation.cancel();
      settle();
    },
    start: () => {
      wanted = true;
      steady?.effect?.updateTiming({ iterations: Infinity });
      if (running) return;
      rest = new Promise((resolve) => (settle = resolve));
      void run().catch(() => {
        running = false;
        settle();
      });
    },
    stop: () => {
      wanted = false;
      const elapsed = Number(steady?.currentTime ?? 0);
      steady?.effect?.updateTiming({
        iterations: Math.floor(elapsed / turn) + 1,
      });
      return running ? rest : Promise.resolve();
    },
  };
};
