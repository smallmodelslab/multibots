import type { AppState } from "../../shared/types";
import { ChannelSetting } from "./ChannelSetting";
import { ChatgptSetting } from "./ChatgptSetting";
import { ModelOrders } from "./ModelOrder";
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

// The user's computers running OpenBots, found over Tailscale and reached
// with the pairing code they share, the servers among them; and, last,
// whether this computer is a server, which then shows what its bots and
// voice chats run on: its ChatGPT sign-in and the models the user hosts,
// either or both, and the order each capability tries them in; and the
// Multidesktop through which its bots use its screen and the user's other
// computers; then the channel updates follow.
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
              <SettingsSection title="ChatGPT">
                <ChatgptSetting
                  chatgpt={state.chatgpt}
                  note="Runs chat and voice chats on your ChatGPT plan."
                />
              </SettingsSection>
              <SettingsSection title="Your models">
                <OwnModelSettings
                  entries={[...state.ownModels.bots, ...state.ownModels.voice]}
                />
              </SettingsSection>
              <SettingsSection
                note="Either is enough, and both work together: each runs the first in its order, and the next takes over when one fails or isn't set up."
                title="Order"
              >
                <ModelOrders
                  chatgpt={state.chatgpt}
                  ownModels={state.ownModels}
                />
              </SettingsSection>
              <SettingsSection title="Screen">
                <MultidesktopSetting multidesktop={state.multidesktop} />
              </SettingsSection>
            </>
          ) : null}
          <SettingsSection title="Updates">
            <ChannelSetting channel={state.channel} />
          </SettingsSection>
        </div>
      </div>
    </div>
  );
};
