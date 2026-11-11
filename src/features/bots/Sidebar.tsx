import { Grid2x2Plus, LogIn, LogOut, Search, Settings } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";

import type { UpdateState } from "@wrkrsh/electron-update/state";
import { cn } from "@/lib/utils";
import { botPreview, listTime } from "../../shared/preview";
import type { Bot, Host } from "../../shared/types";
import { botsKey, bridge, call, messageOf, patch } from "../data";
import { Hint } from "../shell/Hint";
import {
  createHoverCard,
  HoverCardBody,
  HoverCardLine,
} from "../shell/HoverCard";
import { PlusIcon } from "../shell/icons";
import { SidebarUpdate } from "../shell/SidebarUpdate";
import { toastError } from "../shell/Toasts";
import { UserAvatar } from "../shell/UserAvatar";
import { confirm } from "../ui/confirm";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";
import { BotAvatar } from "./BotAvatar";
import { avatarSize, ChatRow, ChatRowPlaceholders } from "./ChatRow";
import { cue, settle } from "./avatars";
import { NewBotDialog } from "./NewBotDialog";

const cards = createHoverCard();

// The newest message of each bot the user has seen, so a row marks what
// arrived while they were elsewhere.
const seenKey = "openbots.seen";
let seen: Record<string, string> = (() => {
  try {
    return JSON.parse(localStorage.getItem(seenKey) ?? "{}") as Record<
      string,
      string
    >;
  } catch {
    return {};
  }
})();
const seenListeners = new Set<() => void>();
export const markSeen = (bot: Bot) => {
  if (!bot.last || seen[bot.id] === bot.last.id) return;
  seen = { ...seen, [bot.id]: bot.last.id };
  localStorage.setItem(seenKey, JSON.stringify(seen));
  for (const listener of seenListeners) listener();
};
const useSeen = () =>
  useSyncExternalStore(
    (listener) => {
      seenListeners.add(listener);
      return () => seenListeners.delete(listener);
    },
    () => seen,
  );

const pin = (bot: Bot, pinned: boolean) => {
  patch<Bot[]>(botsKey, (list) =>
    list.map((each) =>
      each.id === bot.id
        ? { ...each, pinnedAt: pinned ? Date.now() : null }
        : each,
    ),
  );
  call({ botId: bot.id, pinned, type: "bot.update" }).catch((error: unknown) =>
    toastError(messageOf(error)),
  );
};

const remove = async (bot: Bot) => {
  if (
    !(await confirm({
      action: "Delete",
      detail: "Its conversation, routines and files go with it.",
      title: `Delete ${bot.name}?`,
    }))
  )
    return;
  await call({ botId: bot.id, type: "bot.delete" }).catch((error: unknown) =>
    toastError(messageOf(error)),
  );
};

// When a bot last did something, which orders the list, newest first.
const activity = (bot: Bot) => bot.last?.at ?? bot.createdAt;

// A page the window shows in place of a conversation.
export type Pane = "plugins" | "settings";

// The chats as Messages lists them: the pinned bots in a grid at the top,
// every other bot of the user's below them, whichever computer runs it,
// newest first, then an update on its way, the user with their menu, and
// plugins and settings.
export const Sidebar = ({
  active,
  bots,
  hosts,
  onPane,
  onSelect,
  pane,
  update,
  user,
  signedIn,
}: {
  active: Bot | null;
  // Null until this computer's are known.
  bots: Bot[] | null;
  hosts: Host[];
  onPane: (pane: Pane) => void;
  onSelect: (bot: Pick<Bot, "id">) => void;
  pane: Pane | null;
  update: UpdateState;
  user: string;
  signedIn: boolean;
}) => {
  const [search, setSearch] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const seenIds = useSeen();
  const self = hosts[0]!;

  useEffect(() => {
    for (const bot of bots ?? [])
      settle(bot, bot.working ? "working" : "resting", bot.working);
  }, [bots]);

  const query = search?.trim().toLowerCase() ?? "";
  const pinned = query
    ? []
    : (bots ?? [])
        .filter((bot) => bot.pinnedAt !== null)
        .sort((a, b) => a.pinnedAt! - b.pinnedAt!);
  const listed = (bots ?? [])
    .filter((bot) =>
      query
        ? `${bot.name} ${bot.last?.text ?? ""}`.toLowerCase().includes(query)
        : bot.pinnedAt === null,
    )
    .sort((a, b) => activity(b) - activity(a));
  const select = (bot: Bot) => {
    if (active?.id !== bot.id) cue(bot.id, "greeted");
    onSelect(bot);
  };
  const isActive = (bot: Bot) => !pane && active?.id === bot.id;
  const unread = (bot: Bot) =>
    bot.last?.role === "bot" && seenIds[bot.id] !== bot.last.id;
  const card = (bot: Bot) => {
    const host = hosts.find((each) => each.id === bot.server);
    return (
      <HoverCardBody title={bot.name}>
        {bot.instructions ? (
          <HoverCardLine kind="text">{bot.instructions}</HoverCardLine>
        ) : null}
        {bot.working ? <HoverCardLine>{bot.working}</HoverCardLine> : null}
        {host && !host.self ? (
          <HoverCardLine>On {host.name}</HoverCardLine>
        ) : null}
      </HoverCardBody>
    );
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-top">
        {search === null ? (
          <>
            <Hint label="Search" side="bottom">
              <button
                aria-label="Search"
                className="icon-button sidebar-round"
                onClick={() => setSearch("")}
                type="button"
              >
                <Search aria-hidden size={16} strokeWidth={1.5} />
              </button>
            </Hint>
            <NewBotDialog
              hues={(bots ?? []).map((bot) => bot.hue)}
              onMultibot={(botId) => onSelect({ id: botId })}
              trigger={(props) => (
                <Hint label="New bot" side="bottom">
                  <button
                    {...props}
                    aria-label="New bot"
                    className="icon-button sidebar-round"
                    type="button"
                  >
                    <PlusIcon />
                  </button>
                </Hint>
              )}
            />
          </>
        ) : (
          <input
            aria-label="Search bots"
            autoFocus
            className="sidebar-search"
            onBlur={() => {
              if (!search.trim()) setSearch(null);
            }}
            onChange={(event) => setSearch(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setSearch(null);
            }}
            placeholder="Search"
            value={search}
          />
        )}
      </div>
      <cards.Cards />
      {pinned.length ? (
        <div className="sidebar-pins">
          {pinned.map((bot) => (
            <ContextMenu key={bot.id}>
              <ContextMenuTrigger className="sidebar-pin-slot">
                <cards.Trigger
                  aria-current={isActive(bot) ? "page" : undefined}
                  card={card(bot)}
                  className={cn(
                    "sidebar-pin glow",
                    isActive(bot) && "is-active",
                  )}
                  onClick={() => select(bot)}
                  type="button"
                >
                  <BotAvatar
                    bot={bot}
                    size={56}
                    working={Boolean(bot.working)}
                  />
                  <span className="sidebar-pin-name">
                    {unread(bot) && !isActive(bot) ? (
                      <span aria-label="Unread" className="chat-row-unread" />
                    ) : null}
                    <span className="truncate">{bot.name}</span>
                  </span>
                </cards.Trigger>
              </ContextMenuTrigger>
              <ContextMenuContent>
                <MenuItem onClick={() => pin(bot, false)}>Unpin</MenuItem>
                <MenuItem
                  onClick={() => void remove(bot)}
                  variant="destructive"
                >
                  Delete
                </MenuItem>
              </ContextMenuContent>
            </ContextMenu>
          ))}
        </div>
      ) : null}
      <div className="sidebar-scroll">
        <div className="sidebar-chats">
          {bots ? (
            listed.map((bot) => (
              <ContextMenu key={bot.id}>
                <ContextMenuTrigger>
                  <ChatRow
                    active={isActive(bot)}
                    avatar={
                      <BotAvatar
                        bot={bot}
                        size={avatarSize}
                        working={Boolean(bot.working)}
                      />
                    }
                    card={card(bot)}
                    cards={cards}
                    name={bot.name}
                    onSelect={() => select(bot)}
                    preview={botPreview(bot)}
                    remove={{
                      label: `Delete ${bot.name}`,
                      onRemove: () => void remove(bot),
                    }}
                    time={bot.last ? listTime(bot.last.at, now) : null}
                    unread={unread(bot)}
                  />
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <MenuItem onClick={() => pin(bot, true)}>Pin</MenuItem>
                </ContextMenuContent>
              </ContextMenu>
            ))
          ) : (
            <ChatRowPlaceholders count={3} />
          )}
        </div>
      </div>
      <SidebarUpdate state={update} />
      <div className="sidebar-footer">
        <Menu>
          <MenuTrigger className="sidebar-profile glow">
            <UserAvatar person={{ name: user, picture: null }} size={30} />
            <span className="sidebar-profile-text">
              <span className="sidebar-profile-name">{user}</span>
              {self.server && !self.model ? (
                <span className="sidebar-profile-note">Sign in to ChatGPT</span>
              ) : null}
            </span>
          </MenuTrigger>
          <MenuContent className="min-w-56" side="top">
            <MenuItem onClick={() => onPane("settings")}>
              <Settings aria-hidden size={16} strokeWidth={1.5} />
              Settings
            </MenuItem>
            {!self.server ? null : signedIn ? (
              <>
                <MenuSeparator />
                <MenuItem onClick={() => void bridge.signOut()}>
                  <LogOut aria-hidden size={16} strokeWidth={1.5} />
                  Sign out of ChatGPT
                </MenuItem>
              </>
            ) : (
              <>
                <MenuSeparator />
                <MenuItem onClick={() => onPane("settings")}>
                  <LogIn aria-hidden size={16} strokeWidth={1.5} />
                  Sign in to ChatGPT
                </MenuItem>
              </>
            )}
          </MenuContent>
        </Menu>
        {self.server ? (
          <Hint label="Plugins">
            <button
              aria-current={pane === "plugins" ? "page" : undefined}
              aria-label="Plugins"
              className="icon-button sidebar-round"
              onClick={() => onPane("plugins")}
              type="button"
            >
              <Grid2x2Plus aria-hidden size={16} strokeWidth={1.5} />
            </button>
          </Hint>
        ) : null}
        <Hint label="Settings">
          <button
            aria-current={pane === "settings" ? "page" : undefined}
            aria-label="Settings"
            className="icon-button sidebar-round"
            onClick={() => onPane("settings")}
            type="button"
          >
            <Settings aria-hidden size={16} strokeWidth={1.5} />
          </button>
        </Hint>
      </div>
    </aside>
  );
};
