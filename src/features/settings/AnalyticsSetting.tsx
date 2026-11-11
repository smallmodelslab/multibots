import { useState } from "react";

import { bridge, messageOf } from "../data";
import { Switch } from "../ui/switch";
import { SettingRow } from "./SettingRow";

// Whether this computer tells us which features are used and what fails.
export const AnalyticsSetting = ({ on }: { on: boolean }) => {
  const [problem, setProblem] = useState<string | null>(null);
  const toggle = (next: boolean) => {
    setProblem(null);
    bridge
      .setAnalytics(next)
      .catch((error: unknown) => setProblem(messageOf(error)));
  };
  return (
    <SettingRow
      action={
        <Switch aria-label="Analytics" checked={on} onCheckedChange={toggle} />
      }
      detail={
        problem ? (
          <span className="text-destructive" role="alert">
            {problem}
          </span>
        ) : on ? (
          "Tells us which features you use and what fails, never your messages, files or keys."
        ) : (
          "Only critical errors are reported."
        )
      }
      label="Analytics"
    />
  );
};
