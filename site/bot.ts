import {
  avatarColor,
  glassesArt,
  hatArt,
  head,
  ink,
} from "../src/features/avatars/parts";
import { blinkAt, samplePose } from "../src/features/avatars/motion";

// The app's face (src/features/avatars), with the expressions a page needs:
// eyes that close into arcs (curve -1 asleep, 1 happy), squash and stretch
// from its base, and drawn marks around it. Scripts tween the pose; layers
// add breathing, blinks, talking and a gaze that follows the pointer.
export type Pose = {
  gx: number;
  gy: number;
  open: number;
  curve: number;
  tilt: number;
  lift: number;
  sx: number;
  sy: number;
  color: number;
};
export type Outfit = {
  hue: number;
  hat: keyof ReturnType<typeof hatArt>;
  glasses: keyof typeof glassesArt;
};
export type Mark = "alert" | "joy" | "zzz" | "waves";
type Tween = {
  from: number;
  to: number;
  start: number;
  ms: number;
  ease: Ease;
};
type Ease = (t: number) => number;

export const ease = {
  inOut: (t: number) => t * t * (3 - 2 * t),
  out: (t: number) => 1 - (1 - t) ** 3,
  in: (t: number) => t ** 3,
  back: (t: number) => 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2,
};
const clamp = (n: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, n));
const smooth = (a: number, b: number, n: number) =>
  ease.inOut(clamp((n - a) / (b - a)));

export const rest: Partial<Pose> = { tilt: 0, lift: 0, sx: 1, sy: 1 };
const asleep: Pose = {
  gx: 0,
  gy: 0,
  open: 0,
  curve: -1,
  tilt: 0,
  lift: 0,
  sx: 1,
  sy: 1,
  color: 0,
};
export const plain: Outfit = { hue: 215, hat: "none", glasses: "none" };

const svg = (tag: string, attrs: Record<string, string> = {}) => {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [key, value] of Object.entries(attrs))
    node.setAttribute(key, value);
  return node;
};
const marks: Record<Mark, string> = {
  alert: '<path d="M64 -30V-12"/><path d="M64 -3V-1"/>',
  joy: '<path d="M-5.5 46L-20.5 40.5"/><path d="M14.5 18L4 6"/><path d="M113.5 18L124 6"/><path d="M133.5 46L148.5 40.5"/>',
  zzz: '<path d="M102 6h8l-8 8h8"/><path d="M116 -10h11l-11 11h11"/><path d="M133 -30h14l-14 14h14"/>',
  waves:
    '<path d="M124 52q9 18 0 36"/><path d="M137 42q14 28 0 56"/><path d="M4 52q-9 18 0 36"/><path d="M-9 42q-14 28 0 56"/>',
};

export function createBot(host: HTMLElement, reduced: boolean) {
  const root = svg("svg", { viewBox: "-48 -60 224 224", class: "face" });
  const body = svg("g");
  const shape = svg("path", { d: head, class: "head" });
  const eyes = svg("g");
  const pills = [41, 77].map((x) =>
    svg("rect", { x: String(x), width: "10", rx: "5", class: "pupil" }),
  );
  const lids = svg("path", { class: "lid" });
  const glasses = svg("g", { class: "glasses" });
  const hat = svg("g", { class: "hat" });
  eyes.append(...pills, lids);
  body.append(shape, eyes, glasses, hat);
  const drawn = svg("g", { class: "marks pencil-mark" });
  const markGroups = Object.fromEntries(
    Object.entries(marks).map(([name, paths]) => {
      const group = svg("g", { class: `mark ${name}` });
      group.innerHTML = paths;
      for (const path of group.children) path.setAttribute("pathLength", "1");
      drawn.append(group);
      return [name, group];
    }),
  ) as Record<Mark, SVGGElement>;
  root.append(drawn, body);
  host.append(root);

  const pose: Pose = { ...asleep };
  const tweens = new Map<keyof Pose, Tween>();
  let outfit = plain;
  let held = true;
  let blinkStarted = -Infinity;
  let nextBlink = 0;
  let talkUntil = 0;
  let pointer: { x: number; y: number; at: number } | null = null;
  let frame = 0;
  let last = performance.now();

  const dress = (next: Outfit) => {
    outfit = next;
    hat.innerHTML = hatArt(avatarColor(next.hue + 150))[next.hat];
    glasses.innerHTML = glassesArt[next.glasses];
    paint();
  };
  const paint = () => {
    const c = `${(pose.color * 100).toFixed(1)}%`;
    root.style.setProperty(
      "--fill",
      `color-mix(in oklab, var(--paper), ${avatarColor(outfit.hue)} ${c})`,
    );
    root.style.setProperty(
      "--line",
      `color-mix(in oklab, var(--ink), ${ink} ${c})`,
    );
  };

  const draw = (now: number) => {
    const dt = Math.min(64, now - last);
    last = now;
    const recolor = tweens.has("color");
    for (const [key, tween] of tweens) {
      const t = tween.ms ? clamp((now - tween.start) / tween.ms) : 1;
      pose[key] = tween.from + (tween.to - tween.from) * tween.ease(t);
      if (t === 1) tweens.delete(key);
    }
    if (recolor) paint();
    // Free eyes follow the pointer while it moves, else look around.
    if (!held && !reduced && !tweens.has("gx")) {
      const box = host.getBoundingClientRect();
      const target =
        pointer && now - pointer.at < 4000
          ? {
              x: clamp(
                (pointer.x - box.x - box.width / 2) / (innerWidth * 0.4),
                -1,
                1,
              ),
              y: clamp(
                (pointer.y - box.y - box.height / 2) / (innerHeight * 0.4),
                -1,
                1,
              ),
            }
          : samplePose(now, "look-around").gaze;
      const k = 1 - Math.exp(-dt / 140);
      pose.gx += (target.x - pose.gx) * k;
      pose.gy += (target.y - pose.gy) * k;
    }
    if (!held && !reduced && pose.open > 0.8 && now > nextBlink) blink(now);

    const awake = smooth(0, 0.5, pose.open);
    const breath = reduced ? 0 : Math.sin(now / 560) * (0.022 - awake * 0.014);
    const chatter = now < talkUntil ? Math.abs(Math.sin(now / 95)) : 0;
    const open = Math.max(
      0,
      pose.open * (1 - blinkAt(now - blinkStarted)) * (1 - chatter * 0.18),
    );
    const lift = pose.lift - chatter * 1.6;
    const [sx, sy] = [pose.sx - breath / 2, pose.sy + breath];

    body.setAttribute(
      "transform",
      `translate(0 ${lift.toFixed(2)}) rotate(${pose.tilt.toFixed(2)} 64 112) translate(64 112) scale(${sx.toFixed(4)} ${sy.toFixed(4)}) translate(-64 -112)`,
    );
    const [x, y] = [clamp(pose.gx, -1, 1) * 9, clamp(pose.gy, -1, 1) * 5];
    eyes.setAttribute(
      "transform",
      `translate(${x.toFixed(2)} ${y.toFixed(2)})`,
    );
    glasses.setAttribute(
      "transform",
      `translate(${(x * 0.2).toFixed(2)} ${(y * 0.2).toFixed(2)})`,
    );
    const h = 23 * open;
    for (const pill of pills) {
      pill.setAttribute("y", (68 - h / 2).toFixed(2));
      pill.setAttribute("height", h.toFixed(2));
      pill.style.opacity = String(smooth(0.03, 0.14, open));
    }
    const c = clamp(pose.curve, -1, 1);
    lids.setAttribute(
      "d",
      [46, 82]
        .map(
          (cx) =>
            `M${cx - 7} ${68 + c * 3}Q${cx} ${68 - c * 9} ${cx + 7} ${68 + c * 3}`,
        )
        .join(""),
    );
    lids.style.opacity = String(1 - smooth(0.05, 0.18, open));

    frame = !reduced && !document.hidden ? requestAnimationFrame(draw) : 0;
  };
  const wake = () => {
    if (!frame) frame = requestAnimationFrame(draw);
  };
  const blink = (now = performance.now()) => {
    blinkStarted = now;
    nextBlink = now + 2400 + Math.random() * 2800;
  };

  const to = (patch: Partial<Pose>, ms: number, curve: Ease = ease.inOut) => {
    const now = performance.now();
    for (const [key, value] of Object.entries(patch) as [keyof Pose, number][])
      tweens.set(key, {
        from: pose[key],
        to: value,
        start: now,
        ms: reduced ? 0 : ms,
        ease: curve,
      });
    if ("gx" in patch || "gy" in patch) held = true;
    if (reduced) draw(now);
    else wake();
    return wait(ms);
  };
  const talk = (ms: number) => {
    talkUntil = performance.now() + (reduced ? 0 : ms);
    wake();
  };
  const wait = (ms: number) =>
    new Promise<void>((done) => setTimeout(done, reduced ? 0 : ms));
  const mark = (name: Mark, ms: number) => {
    if (reduced) return;
    const group = markGroups[name];
    group.classList.add("on");
    setTimeout(() => group.classList.remove("on"), ms);
  };

  // A script runs until it ends or the next one starts; its waits then stop
  // it, so only one script moves the bot at a time.
  let current = 0;
  const stopped = Symbol("stopped");
  const play = (script: (bot: Director) => Promise<void>) => {
    const id = ++current;
    const live =
      <A extends unknown[]>(step: (...args: A) => Promise<void>) =>
      async (...args: A) => {
        if (id !== current) throw stopped;
        await step(...args);
        if (id !== current) throw stopped;
      };
    for (const group of Object.values(markGroups)) group.classList.remove("on");
    const director: Director = {
      to: live(to),
      wait: live(wait),
      mark,
      blink: () => blink(),
      talk,
      dress,
    };
    return script(director)
      .then(() => {
        if (id === current) held = false;
      })
      .catch((error) => {
        if (error !== stopped) throw error;
      });
  };

  addEventListener("pointermove", (event) => {
    if (event.pointerType === "mouse")
      pointer = { x: event.clientX, y: event.clientY, at: performance.now() };
  });
  document.addEventListener("visibilitychange", wake);
  dress(plain);
  if (reduced) {
    Object.assign(pose, { open: 1 });
    held = false;
  }
  draw(performance.now());
  return { play, talk };
}

export type Director = {
  to: (patch: Partial<Pose>, ms: number, curve?: Ease) => Promise<void>;
  wait: (ms: number) => Promise<void>;
  mark: (name: Mark, ms: number) => void;
  blink: () => void;
  talk: (ms: number) => void;
  dress: (outfit: Outfit) => void;
};
