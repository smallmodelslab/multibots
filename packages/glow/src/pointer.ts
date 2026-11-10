// What lights up from the pointer: whatever is marked `glow` or `spot`,
// and Multiwork's icon buttons.
const litOf = (target: EventTarget | null) =>
  target instanceof Element ? target.closest<HTMLElement>(".glow, .spot, .icon-button") : null;

// Tells whatever lights up from the pointer where the pointer is over it,
// through `--pointer-x` and `--pointer-y` from its top-left corner; returns
// how to stop. They stay once the pointer leaves, so a light fades out
// where it was rather than jumping back to the middle.
export const followPointerLight = (root: Document) => {
  const move = (event: PointerEvent) => {
    const lit = litOf(event.target);
    if (!lit) return;
    const box = lit.getBoundingClientRect();
    lit.style.setProperty("--pointer-x", `${(event.clientX - box.left).toFixed(1)}px`);
    lit.style.setProperty("--pointer-y", `${(event.clientY - box.top).toFixed(1)}px`);
  };
  root.addEventListener("pointermove", move);
  return () => root.removeEventListener("pointermove", move);
};
