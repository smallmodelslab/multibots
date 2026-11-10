import { Tooltip } from "@base-ui/react/tooltip";
import type { ReactNode } from "react";

type Side = "top" | "bottom" | "left" | "right";

// A card of what a row or tile has no room for, beside whichever of a
// list's items is hovered. The list shares one card, so moving along it
// slides the card from item to item rather than closing one and opening the
// next. The card is only seen; each item still says what it is itself.
export const createHoverCard = () => {
  const handle = Tooltip.createHandle<ReactNode>();

  const Trigger = ({
    card,
    ...props
  }: Omit<Tooltip.Trigger.Props<ReactNode>, "handle" | "payload"> & {
    card: ReactNode;
  }) => (
    <Tooltip.Trigger delay={600} handle={handle} payload={card} {...props} />
  );

  // Where the card shows, once for the whole list.
  const Cards = ({
    align = "start",
    side = "right",
  }: {
    align?: "start" | "center" | "end";
    side?: Side;
  }) => (
    <Tooltip.Root handle={handle}>
      {({ payload }) => (
        <Tooltip.Portal>
          <Tooltip.Positioner
            align={align}
            className="hover-card-positioner"
            collisionPadding={8}
            side={side}
            sideOffset={10}
          >
            <Tooltip.Popup className="hover-card">
              <Tooltip.Viewport className="hover-card-viewport">
                {payload}
              </Tooltip.Viewport>
            </Tooltip.Popup>
          </Tooltip.Positioner>
        </Tooltip.Portal>
      )}
    </Tooltip.Root>
  );

  return { Cards, Trigger };
};

export type HoverCards = ReturnType<typeof createHoverCard>;

// What a card says: a title, then lines about it.
export const HoverCardBody = ({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) => (
  <div className="hover-card-body">
    <span className="hover-card-title">{title}</span>
    {children}
  </div>
);

// A line in a card: `text` for what was said or written, which may run to
// a few lines; `detail` for a short fact about it.
export const HoverCardLine = ({
  children,
  kind = "detail",
}: {
  children: ReactNode;
  kind?: "text" | "detail";
}) => (
  <span className={kind === "text" ? "hover-card-text" : "hover-card-line"}>
    {children}
  </span>
);
