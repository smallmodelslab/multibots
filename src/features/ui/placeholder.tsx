import type { CSSProperties } from "react";

/** A shape standing in for something still loading, breathing (`.placeholder-bar`);
    `row` staggers it with its neighbours, `round` makes it a circle (an avatar)
    and `bubble` a message. Its classes are joined by hand rather than through
    cn(), whose merge takes placeholder-* for one utility and keeps only the last. */
export const PlaceholderBar = ({
  bubble = false,
  className,
  height,
  round = false,
  row,
  style,
  width,
}: {
  bubble?: boolean;
  className?: string;
  height?: CSSProperties["height"];
  round?: boolean;
  row?: number;
  style?: CSSProperties;
  width?: CSSProperties["width"];
}) => (
  <span
    aria-hidden="true"
    className={[
      "placeholder-bar",
      round && "placeholder-round",
      bubble && "placeholder-bubble",
      className,
    ]
      .filter(Boolean)
      .join(" ")}
    style={{ "--row": row, height, width, ...style } as CSSProperties}
  />
);
