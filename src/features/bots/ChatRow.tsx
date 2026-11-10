import type { CSSProperties, ReactNode } from "react";

import { cn } from "@/lib/utils";
import { Hint } from "../shell/Hint";
import type { HoverCards } from "../shell/HoverCard";
import { CloseIcon } from "../shell/icons";
import { PlaceholderBar } from "../ui/placeholder";

// A chat in a list as Messages lists one: its avatar, its name with when it
// last spoke, and a line of what was said. Hovering it shows its card, in
// the list's `cards`: what the row has no room for. A chat that can be
// removed shows an × in its time's place on hover; the list is the only
// place it is removed from.
export const ChatRow = ({
  remove,
  ...row
}: ChatRowProps & {
  remove?: { label: string; onRemove: () => void };
}) =>
  remove ? (
    <div className="chat-row-item hover-actions">
      <Row {...row} />
      <Hint label={remove.label}>
        <button
          aria-label={remove.label}
          className="icon-button hover-action chat-row-remove"
          onClick={remove.onRemove}
          type="button"
        >
          <CloseIcon />
        </button>
      </Hint>
    </div>
  ) : (
    <Row {...row} />
  );

type ChatRowProps = {
  active: boolean;
  avatar: ReactNode;
  card: ReactNode;
  cards: HoverCards;
  name: string;
  onSelect: () => void;
  // Null while it is still on its way.
  preview: string | null;
  time: string | null;
  // Something in it the user has not seen, or they marked it unread.
  unread?: boolean;
};

const Row = ({
  active,
  avatar,
  card,
  cards,
  name,
  onSelect,
  preview,
  time,
  unread = false,
}: ChatRowProps) => (
  <cards.Trigger
    aria-current={active ? "page" : undefined}
    card={card}
    className={cn(
      "chat-row glow",
      active && "is-active",
      unread && !active && "is-unread",
    )}
    onClick={onSelect}
    type="button"
  >
    {avatar}
    <span className="chat-row-text">
      <span className="chat-row-head">
        <span className="chat-row-name">{name}</span>
        {time ? <span className="chat-row-time">{time}</span> : null}
        {unread && !active ? (
          <span aria-label="Unread" className="chat-row-unread" />
        ) : null}
      </span>
      <span className="chat-row-preview">
        {preview ?? <span className="placeholder-bar" />}
      </span>
    </span>
  </cards.Trigger>
);

// How big a chat's avatar is in the sidebar's lists.
export const avatarSize = 32;

// Rows shaped like chats while a list loads.
export const ChatRowPlaceholders = ({ count }: { count: number }) =>
  Array.from({ length: count }, (_, row) => (
    <div
      aria-hidden="true"
      className="chat-row is-placeholder"
      key={row}
      style={{ "--row": row } as CSSProperties}
    >
      <PlaceholderBar height={avatarSize} round width={avatarSize} />
      <span className="chat-row-text">
        <span className="chat-row-head">
          <span
            className="placeholder-bar"
            style={{ width: `${36 + ((row * 17) % 24)}%` }}
          />
        </span>
        <span className="chat-row-preview">
          <span className="placeholder-bar" />
        </span>
      </span>
    </div>
  ));
