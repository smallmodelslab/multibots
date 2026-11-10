import { useState } from "react";

import { bridge, messageOf } from "../data";
import { confirm } from "../ui/confirm";
import { Spinner } from "../ui/spinner";
import { Switch } from "../ui/switch";
import { SettingRow } from "./SettingRow";

// Whether this computer is one of the user's OpenBots servers, which keep a
// copy of every bot and run them. Turning it off hands its copies to the
// other servers online and lets them go.
export const ServerSetting = ({ server }: { server: boolean }) => {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const toggle = async (on: boolean) => {
    if (
      !on &&
      !(await confirm({
        action: "Turn off",
        detail:
          "This computer stops running bots and removes its copies of them once your other servers have them.",
        title: "Turn off server mode?",
      }))
    )
      return;
    setBusy(true);
    setProblem(null);
    bridge
      .setServer(on)
      .catch((error: unknown) => setProblem(messageOf(error)))
      .finally(() => setBusy(false));
  };
  return (
    <SettingRow
      action={
        <>
          {busy ? <Spinner className="size-3" /> : null}
          <Switch
            aria-label="Server mode"
            checked={server}
            disabled={busy}
            onCheckedChange={(on) => void toggle(on)}
          />
        </>
      }
      detail={
        problem ? (
          <span className="text-destructive" role="alert">
            {problem}
          </span>
        ) : server ? (
          "Keeps a copy of every bot and runs them."
        ) : (
          "Shows the bots your servers run."
        )
      }
      label="Server mode"
    />
  );
};
