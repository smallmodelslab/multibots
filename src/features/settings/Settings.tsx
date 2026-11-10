import { useState } from "react";

import type { AppState, ModelList, OwnModelKind } from "../../shared/types";
import { Tabs } from "../ui/tabs";
import { ChatgptSetting } from "./ChatgptSetting";
import { ModelOrder } from "./ModelOrder";
import { MultidesktopSetting } from "./MultidesktopSetting";
import { OwnModelSettings } from "./OwnModelSetting";
import { PairingSetting } from "./PairingSetting";
import { ServerSetting } from "./ServerSetting";
import { SettingRow } from "./SettingRow";
import { SettingsSection } from "./SettingsSection";

const tailscaleNotes = {
  missing: "Install Tailscale to reach OpenBots on your other computers.",
  stopped: "Turn on Tailscale to reach OpenBots on your other computers.",
} as const;

const tabs = [
  ["chatgpt", "ChatGPT"],
  ["custom", "Custom models"],
] as const;

const lists: Record<
  ModelList,
  { title: string; order: string; note: string; uses: OwnModelKind[] }
> = {
  bots: {
    note: "Runs bots on this server on your ChatGPT plan.",
    order: "Fallback order",
    title: "Providers",
    uses: ["bots"],
  },
  voice: {
    note: "Talks in voice chats on this server on your ChatGPT plan.",
    order: "Voice fallback order",
    title: "Voice",
    uses: ["transcription", "speech"],
  },
};

// What one list runs on: ChatGPT and the models the user hosts, each in a
// tab, then the order they are tried in once there is more than one.
const ModelSections = ({
  list,
  state: { chatgpt, ownModels },
}: {
  list: ModelList;
  state: AppState;
}) => {
  const [tab, setTab] = useState<(typeof tabs)[number][0]>("chatgpt");
  const { note, order, title, uses } = lists[list];
  const entries = ownModels[list];
  return (
    <>
      <SettingsSection
        action={<Tabs onChange={setTab} tabs={tabs} value={tab} />}
        title={title}
      >
        {tab === "chatgpt" ? (
          <ChatgptSetting chatgpt={chatgpt} note={note} />
        ) : (
          <OwnModelSettings entries={entries} uses={uses} />
        )}
      </SettingsSection>
      {entries.length > 1 ? (
        <SettingsSection title={order}>
          <ModelOrder chatgpt={chatgpt} entries={entries} list={list} />
        </SettingsSection>
      ) : null}
    </>
  );
};

// The user's computers running OpenBots, found over Tailscale and reached
// with the pairing code they share, the servers among them; and, last,
// whether this computer is a server, which then shows what its bots and
// voice chats run on, its ChatGPT sign-in and the models the user hosts in
// the order they are tried, and the Multidesktop through which its bots use
// its screen and the user's other computers.
export const Settings = ({ state }: { state: AppState }) => {
  const self = state.hosts[0]!;
  return (
    <div className="pane settings-pane">
      <div className="settings-scroll">
        <div className="settings">
          <SettingsSection title="Computers">
            {state.hosts.map((host) => (
              <SettingRow
                detail={
                  !host.server
                    ? host.name
                    : host.model
                      ? `${host.name}, a server on ${host.model}`
                      : `${host.name}, a server not signed in to ChatGPT`
                }
                key={host.id}
                label={host.self ? "This computer" : host.os}
              />
            ))}
            <PairingSetting pairing={state.pairing} />
            {state.tailscale === "running" ? null : (
              <SettingRow
                detail={tailscaleNotes[state.tailscale]}
                label="Tailscale"
              />
            )}
          </SettingsSection>
          <SettingsSection title="Server">
            <ServerSetting server={self.server} />
          </SettingsSection>
          {self.server ? (
            <>
              <ModelSections list="bots" state={state} />
              <ModelSections list="voice" state={state} />
              <SettingsSection title="Screen">
                <MultidesktopSetting multidesktop={state.multidesktop} />
              </SettingsSection>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
};
