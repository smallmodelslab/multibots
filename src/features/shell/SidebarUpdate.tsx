import { ArrowDown, RefreshCw } from "lucide-react";

import type { UpdateState } from "@wrkrsh/electron-update/state";
import { Hint } from "./Hint";

const icon = {
  "aria-hidden": true,
  className: "icon",
  size: 16,
  strokeWidth: 1.5,
} as const;

// What an update needs from the user or is doing on its way, if anything.
export const SidebarUpdate = ({ state }: { state: UpdateState }) => {
  switch (state.status) {
    case "available":
    case "downloading":
      return (
        <Hint label={`Downloading OpenBots ${state.version}`}>
          <div className="sidebar-update">
            <ArrowDown {...icon} />
            <span className="truncate">Downloading update</span>
            {state.status === "downloading" ? (
              <span className="sidebar-update-detail">{state.percent}%</span>
            ) : null}
          </div>
        </Hint>
      );
    case "downloaded":
      return (
        <Hint label={`Install OpenBots ${state.version}`}>
          <button
            className="sidebar-update glow"
            onClick={() => void window.openbots.installUpdate()}
            type="button"
          >
            <RefreshCw {...icon} />
            {state.restart ? "Restart to update" : "Update"}
          </button>
        </Hint>
      );
    case "error":
      return state.download ? (
        <Hint label={state.message}>
          <button
            className="sidebar-update glow"
            onClick={() => void window.openbots.checkForUpdate()}
            type="button"
          >
            <RefreshCw {...icon} />
            Update failed
            <span className="sidebar-update-detail">Retry</span>
          </button>
        </Hint>
      ) : null;
    default:
      return null;
  }
};
