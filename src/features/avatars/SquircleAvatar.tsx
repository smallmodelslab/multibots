import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { renderAvatar } from "./artwork";
import { createAvatarController, type AvatarController } from "./controller";
import type { Appearance } from "./appearance";
import "./avatars.css";

export const useAvatar = (appearance: Appearance) =>
  useState(() => createAvatarController(appearance))[0];

// One 30fps clock for every visible avatar. Hidden/offscreen avatars consume no frames.
const moving = new Set<(now: number) => void>();
let raf = 0,
  previous = 0;
const tick = (now: number) => {
  if (now - previous >= 1000 / 30 - 1) {
    previous = now;
    for (const draw of moving) draw(now);
  }
  raf = moving.size ? requestAnimationFrame(tick) : 0;
};
const join = (draw: (now: number) => void) => {
  moving.add(draw);
  if (!raf) raf = requestAnimationFrame(tick);
};

export function SquircleAvatar({
  controller,
  size = 128,
  className,
  label = "Bot",
  style,
}: {
  controller: AvatarController;
  size?: number | string;
  className?: string;
  label?: string;
  style?: CSSProperties;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const node = ref.current!;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    let visible = false;
    const draw = (now: number) => {
      node.innerHTML = renderAvatar(
        controller.getState().appearance,
        controller.pose(now, reduced.matches),
      );
    };
    const update = () => {
      moving.delete(draw);
      draw(performance.now());
      if (visible && !document.hidden && !reduced.matches) join(draw);
    };
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry!.isIntersecting;
      update();
    });
    observer.observe(node);
    const unsubscribe = controller.subscribe(update);
    reduced.addEventListener("change", update);
    document.addEventListener("visibilitychange", update);
    update();
    return () => {
      moving.delete(draw);
      observer.disconnect();
      unsubscribe();
      reduced.removeEventListener("change", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, [controller]);
  return (
    <span
      ref={ref}
      role="img"
      aria-label={label}
      className={`squircle-avatar ${className ?? ""}`}
      style={{ height: size, width: size, ...style }}
    />
  );
}
