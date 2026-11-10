import { useState } from "react";

import type { Channel } from "@wrkrsh/electron-update/state";
import { bridge, messageOf } from "../data";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { SettingRow } from "./SettingRow";

const channels = [
  {
    value: "stable",
    label: "Stable",
    detail: "Releases that ran on nightly first",
  },
  {
    value: "nightly",
    label: "Nightly",
    detail: "A new build most days, with features still in progress",
  },
] as const;

// The channel updates follow. Picking the other one checks it at once, and
// its newest build replaces this one even when it is older.
export const ChannelSetting = ({ channel }: { channel: Channel }) => {
  const [problem, setProblem] = useState<string | null>(null);
  const pick = (next: Channel) => {
    setProblem(null);
    bridge
      .setChannel(next)
      .catch((error: unknown) => setProblem(messageOf(error)));
  };
  return (
    <SettingRow
      action={
        <Select
          items={channels}
          onValueChange={(next) => next && pick(next)}
          value={channel}
        >
          <SelectTrigger aria-label="Update channel" size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {channels.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      }
      detail={
        problem ? (
          <span className="text-destructive" role="alert">
            {problem}
          </span>
        ) : (
          channels.find((option) => option.value === channel)!.detail
        )
      }
      label="Channel"
    />
  );
};
