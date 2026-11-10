import {
  useCallback,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/features/ui/tooltip";

// What a control does, shown when it is hovered or focused; with no label,
// the control alone. The control still needs a name of its own (its text,
// or an aria-label), as the hint is only seen.
export const Hint = ({
  children,
  label,
  shortcut,
  side,
}: {
  children: ReactElement;
  label: ReactNode;
  shortcut?: string;
  side?: "top" | "bottom" | "left" | "right";
}) =>
  label === null || label === undefined || label === "" ? (
    children
  ) : (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent side={side}>
        {label}
        {shortcut ? <span className="hint-shortcut">{shortcut}</span> : null}
      </TooltipContent>
    </Tooltip>
  );

// Text that, when cut short to fit (by `className`), shows the whole of
// itself on hover, and only then.
export const Overflowing = ({
  children,
  className,
}: {
  children: string;
  className: string;
}) => {
  const [cut, setCut] = useState(false);
  // Measured again as its box or its text changes.
  const measure = useCallback(
    (text: HTMLElement | null) => {
      if (!text || !children) return;
      const observer = new ResizeObserver(() =>
        setCut(text.scrollWidth > text.clientWidth),
      );
      observer.observe(text);
      return () => observer.disconnect();
    },
    [children],
  );
  return (
    <Tooltip>
      <TooltipTrigger
        disabled={!cut}
        ref={measure}
        render={<span className={className} />}
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{children}</TooltipContent>
    </Tooltip>
  );
};
