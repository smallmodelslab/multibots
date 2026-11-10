import type { ReactNode } from "react";

export type MessageNeighbor = { at: number; sender: string | null };

// A gap this long between messages starts a new stretch, headed by its time.
export const stretchGapMs = 30 * 60_000;

const when = (at: number) => {
  const date = new Date(at);
  const time = date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return new Date().toDateString() === date.toDateString()
    ? time
    : `${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })} at ${time}`;
};

export const StretchTime = ({ at }: { at: number }) => (
  <div className="pt-4 pb-1 text-center text-xs text-muted-foreground">
    {when(at)}
  </div>
);

// Cards, deleted messages and sender changes interrupt a run of bubbles.
const joins = (
  before: MessageNeighbor | undefined,
  after: MessageNeighbor | undefined,
) =>
  Boolean(
    before?.sender &&
    before.sender === after?.sender &&
    after.at >= before.at &&
    after.at - before.at < 5 * 60_000,
  );

export const MessageGroup = ({
  children,
  message,
  next,
  previous,
  side,
}: {
  children: ReactNode;
  message: MessageNeighbor;
  next?: MessageNeighbor;
  previous?: MessageNeighbor;
  side: "start" | "end";
}) => (
  <div
    className="message-group"
    data-joins-after={joins(message, next) || undefined}
    data-joins-before={joins(previous, message) || undefined}
    data-side={side}
  >
    {children}
  </div>
);
