import { Copy, Ellipsis } from "lucide-react";
import { useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";
import {
  quickReactions,
  toggleReaction,
  type Bot,
  type BotDetail,
  type Message,
  type Quote,
} from "../../shared/types";
import { BotAvatar } from "../bots/BotAvatar";
import { botKey, call, messageOf, patch, refresh, useBots } from "../data";
import { Hint } from "../shell/Hint";
import { ForwardIcon, PencilIcon, ReplyIcon, TrashIcon } from "../shell/icons";
import { toastError } from "../shell/Toasts";
import { confirm } from "../ui/confirm";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuSub,
  MenuTrigger,
} from "../ui/menu";
import { previewOf } from "../../shared/preview";
import "./messages.css";

// What can be done with a message, as Multiwork offers it: hovering it
// shows a few quick reactions, reply, forward and a menu with the rest;
// right-click opens the same menu. Reactions and replies stay in the
// conversation; forwarding sends the message on to another of the user's
// bots.

const report = (error: unknown) => toastError(messageOf(error));

export const textOf = (message: Message) =>
  message.text || message.forwarded?.text || "";

// Adds or takes back the user's reaction, shown at once.
const react = (bot: Bot, messageId: string, emoji: string) => {
  const key = botKey(bot.id);
  patch<BotDetail | null>(key, (current) =>
    current
      ? {
          ...current,
          messages: current.messages.map((message) =>
            message.id === messageId
              ? {
                  ...message,
                  reactions: toggleReaction(message.reactions, emoji),
                }
              : message,
          ),
        }
      : current,
  );
  call({
    botId: bot.id,
    emoji,
    messageId,
    type: "message.react",
  }).catch((error: unknown) => {
    refresh(key);
    report(error);
  });
};

// The user's other bots, on any of their computers, to forward to.
const ForwardTargets = ({
  author,
  bot,
  message,
}: {
  author: string;
  bot: Bot;
  message: Message;
}) => {
  const others = (useBots() ?? []).filter((each) => each.id !== bot.id);
  if (!others.length) return <MenuItem disabled>No other bots</MenuItem>;
  return others.map((to) => (
    <MenuItem
      key={to.id}
      onClick={() =>
        call({
          botId: to.id,
          forwarded: { author, text: textOf(message) },
          text: "",
          type: "bot.send",
          uploads: [],
        }).catch(report)
      }
    >
      <BotAvatar bot={to} size={16} />
      <span className="truncate">{to.name}</span>
    </MenuItem>
  ));
};

// The rest of what can be done with it, in the bar's menu and on
// right-click alike.
const MenuItems = ({ author, bot, message, onEdit, onReply }: Acts) => {
  const text = textOf(message);
  return (
    <>
      <MenuItem onClick={onReply}>
        <ReplyIcon />
        Reply
      </MenuItem>
      {text ? (
        <>
          <MenuSub
            label={
              <>
                <ForwardIcon />
                Forward
              </>
            }
          >
            <ForwardTargets author={author} bot={bot} message={message} />
          </MenuSub>
          <MenuItem
            onClick={() =>
              void navigator.clipboard.writeText(text).catch(report)
            }
          >
            <Copy aria-hidden size={16} />
            Copy text
          </MenuItem>
        </>
      ) : null}
      {message.role === "user" ? (
        <>
          <MenuSeparator />
          <MenuItem onClick={onEdit}>
            <PencilIcon />
            Edit
          </MenuItem>
          <MenuItem
            onClick={async () => {
              if (
                await confirm({
                  action: "Delete",
                  title: "Delete this message?",
                })
              )
                call({
                  botId: bot.id,
                  messageId: message.id,
                  type: "message.delete",
                }).catch(report);
            }}
            variant="destructive"
          >
            <TrashIcon />
            Delete
          </MenuItem>
        </>
      ) : null}
    </>
  );
};

type Acts = {
  // Who wrote it, as a forward names them.
  author: string;
  bot: Bot;
  message: Message;
  onEdit: () => void;
  onReply: () => void;
};

// A message with its hover bar and menu. `side` is where the bar sits:
// over the start of the user's own messages, the end of the bot's.
export const MessageActions = ({
  children,
  className,
  side,
  ...acts
}: Acts & {
  children: ReactNode;
  className?: string;
  side: "start" | "end";
}) => {
  const { author, bot, message, onReply } = acts;
  const [menuOpen, setMenuOpen] = useState(false);
  const [forwardOpen, setForwardOpen] = useState(false);
  return (
    <ContextMenu>
      <ContextMenuTrigger
        className={cn(
          "message-acted select-text",
          (menuOpen || forwardOpen) && "is-menu-open",
          className,
        )}
        data-message-id={message.id}
      >
        {children}
        <div
          className={cn("message-bar-track", side === "start" && "is-start")}
        >
          <div
            className="message-bar"
            onContextMenu={(event) => event.stopPropagation()}
          >
            {quickReactions.slice(0, 4).map((emoji) => (
              <button
                aria-label={`React with ${emoji}`}
                className="message-bar-button message-bar-emoji glow"
                key={emoji}
                onClick={() => react(bot, message.id, emoji)}
                type="button"
              >
                {emoji}
              </button>
            ))}
            <Hint label="Reply">
              <button
                aria-label="Reply"
                className="message-bar-button glow"
                onClick={onReply}
                type="button"
              >
                <ReplyIcon />
              </button>
            </Hint>
            {textOf(message) ? (
              <Menu onOpenChange={setForwardOpen} open={forwardOpen}>
                <Hint label="Forward">
                  <MenuTrigger
                    aria-label="Forward"
                    className="message-bar-button glow"
                  >
                    <ForwardIcon />
                  </MenuTrigger>
                </Hint>
                <MenuContent align="end">
                  <ForwardTargets author={author} bot={bot} message={message} />
                </MenuContent>
              </Menu>
            ) : null}
            <Menu onOpenChange={setMenuOpen} open={menuOpen}>
              <MenuTrigger
                aria-label="More actions"
                className="message-bar-button glow"
              >
                <Ellipsis aria-hidden size={16} />
              </MenuTrigger>
              <MenuContent align="end" className="min-w-44">
                <MenuItems {...acts} />
              </MenuContent>
            </Menu>
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="min-w-44">
        <div className="message-menu-reactions">
          {quickReactions.map((emoji) => (
            <MenuItem
              aria-label={`React with ${emoji}`}
              className="message-menu-emoji"
              key={emoji}
              onClick={() => react(bot, message.id, emoji)}
            >
              {emoji}
            </MenuItem>
          ))}
        </div>
        <MenuSeparator />
        <MenuItems {...acts} />
      </ContextMenuContent>
    </ContextMenu>
  );
};

// The reactions under a message; clicking one takes it back.
export const Reactions = ({
  align,
  bot,
  message,
}: {
  align: "start" | "end";
  bot: Bot;
  message: Message;
}) =>
  message.reactions?.length ? (
    <div className={cn("message-reactions", align === "end" && "is-end")}>
      {message.reactions.map((emoji) => (
        <button
          aria-label={`Take back ${emoji}`}
          className="message-reaction glow"
          key={emoji}
          onClick={() => react(bot, message.id, emoji)}
          type="button"
        >
          {emoji}
        </button>
      ))}
    </div>
  ) : null;

// The message replied to, which goes to it when clicked.
export const QuoteBlock = ({
  author,
  quote,
}: {
  author: string;
  quote: Quote;
}) => (
  <button
    className="message-quote"
    onClick={() => {
      const element = document.querySelector(
        `[data-message-id="${CSS.escape(quote.messageId)}"]`,
      );
      if (!element) return;
      element.scrollIntoView({ behavior: "smooth", block: "center" });
      element.classList.remove("is-jumped");
      void (element as HTMLElement).offsetWidth;
      element.classList.add("is-jumped");
    }}
    type="button"
  >
    <span className="message-quote-author">{author}</span>
    <span className="message-quote-text">{previewOf(quote.text)}</span>
  </button>
);

export const ForwardedBlock = ({
  forwarded,
}: {
  forwarded: NonNullable<Message["forwarded"]>;
}) => (
  <div className="message-forwarded">
    <span className="message-quote-author">
      Forwarded from {forwarded.author}
    </span>
    <span className="message-forwarded-text">{forwarded.text}</span>
  </div>
);
