import { useEffect, useState } from "react";

const widthKey = "openbots.sidebarWidth";
const defaultWidth = 280;
const clampWidth = (width: number) =>
  Math.round(Math.min(420, Math.max(200, width)));

// How wide the sidebar is and whether it shows, kept across launches, and
// whether the user is dragging its edge, when it follows without easing.
export const useSidebarLayout = () => {
  const [width, setWidth] = useState(() =>
    clampWidth(Number(window.localStorage.getItem(widthKey)) || defaultWidth),
  );
  const [resizing, setResizing] = useState(false);
  useEffect(() => {
    window.localStorage.setItem(widthKey, String(width));
  }, [width]);
  return {
    resize: (next: number) => setWidth(clampWidth(next)),
    resizing,
    setResizing,
    width,
  };
};

// The sidebar's right edge. It starts at the window's left, so the pointer's
// x is the width.
export const SidebarResizer = ({
  onResize,
  onResizing,
}: {
  onResize: (width: number) => void;
  onResizing: (resizing: boolean) => void;
}) => (
  <div
    aria-label="Resize sidebar"
    aria-orientation="vertical"
    className="sidebar-resizer"
    onLostPointerCapture={() => onResizing(false)}
    onPointerDown={(event) => {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      onResizing(true);
    }}
    onPointerMove={(event) => {
      if (event.currentTarget.hasPointerCapture(event.pointerId))
        onResize(event.clientX);
    }}
    role="separator"
  />
);
