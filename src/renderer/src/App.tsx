import { useEffect, useState, type CSSProperties } from "react";

import { followPointerLight } from "@wrkrsh/glow/pointer";
import { Conversation } from "@/features/bots/Conversation";
import { Details } from "@/features/bots/Details";
import { markSeen, type Pane, Sidebar } from "@/features/bots/Sidebar";
import { followVoiceChat } from "@/features/bots/voiceChat";
import { useAppState, useBots } from "@/features/data";
import { followChannel } from "@/features/flags";
import { Plugins } from "@/features/plugins/Plugins";
import { Settings } from "@/features/settings/Settings";
import {
  SidebarResizer,
  useSidebarLayout,
} from "@/features/shell/SidebarControls";
import { Toasts } from "@/features/shell/Toasts";
import { Confirmations } from "@/features/ui/confirm";
import type { Bot } from "../../shared/types";

type Chosen = Pick<Bot, "id">;

const remembered = <T,>(key: string, fallback: T): T => {
  try {
    const saved = localStorage.getItem(key);
    return saved === null ? fallback : (JSON.parse(saved) as T);
  } catch {
    return fallback;
  }
};

// The window as Grok Bot lays it out, with no bar along the top: the bots
// down the left, the chosen one's conversation, and its details beside it.
export const App = () => {
  const state = useAppState();
  const bots = useBots();
  useEffect(() => followVoiceChat(bots), [bots]);
  const layout = useSidebarLayout();
  const [chosen, setChosen] = useState<Chosen | null>(() =>
    remembered("openbots.chosen", null),
  );
  const [pane, setPane] = useState<Pane | null>(null);
  const [details, setDetails] = useState(() =>
    remembered("openbots.details", true),
  );

  useEffect(() => followPointerLight(document), []);
  const channel = state?.channel;
  useEffect(() => {
    if (channel) followChannel(channel);
  }, [channel]);
  const drawn = Boolean(state);
  useEffect(() => {
    if (drawn) window.openbots.ready();
  }, [drawn]);
  useEffect(
    () => localStorage.setItem("openbots.chosen", JSON.stringify(chosen)),
    [chosen],
  );
  useEffect(
    () => localStorage.setItem("openbots.details", JSON.stringify(details)),
    [details],
  );

  const self = state?.hosts[0];
  const bot =
    bots?.find((each) => each.id === chosen?.id) ??
    bots?.find((each) => each.pinnedAt !== null) ??
    bots?.[0] ??
    null;
  const host = state?.hosts.find((each) => each.id === bot?.server);

  // Its conversation on screen, while the window has the user's attention,
  // means its newest message is seen.
  useEffect(() => {
    if (!bot || pane) return;
    const see = () => document.hasFocus() && markSeen(bot);
    see();
    window.addEventListener("focus", see);
    return () => window.removeEventListener("focus", see);
  }, [bot, pane]);

  if (!state || !self) return null;
  const mac = window.openbots.platform === "darwin";
  const shownDetails = Boolean(!pane && details && bot && host);
  return (
    <div
      className={[
        "app",
        mac && "is-mac",
        layout.resizing && "is-sidebar-resizing",
        shownDetails && "has-details",
      ]
        .filter(Boolean)
        .join(" ")}
      style={{ "--sidebar-width": `${layout.width}px` } as CSSProperties}
    >
      <div className="sidebar-slot">
        <Sidebar
          active={bot}
          bots={bots}
          hosts={state.hosts}
          onPane={setPane}
          onSelect={(next) => {
            setChosen({ id: next.id });
            setPane(null);
          }}
          pane={pane}
          signedIn={state.chatgpt.signedIn}
          update={state.update}
          user={state.user}
        />
      </div>
      <main className="main">
        <Toasts />
        {pane === "settings" ? (
          <Settings state={state} />
        ) : pane === "plugins" ? (
          <Plugins plugins={state.plugins} />
        ) : bot ? (
          <Conversation
            bot={bot}
            host={host}
            key={bot.id}
            onOpenDetails={() => setDetails(true)}
            onSettings={() => setPane("settings")}
          />
        ) : null}
      </main>
      <div className="details-slot" inert={!shownDetails}>
        {bot && host ? (
          <Details
            bot={bot}
            host={host}
            key={bot.id}
            onClose={() => setDetails(false)}
          />
        ) : null}
      </div>
      <Confirmations />
      <SidebarResizer
        onResize={layout.resize}
        onResizing={layout.setResizing}
      />
    </div>
  );
};
