import { useSyncExternalStore } from "react";

import type { Flag, Setting } from "@wrkrsh/flags";
import { flags, type FlagId } from "../flags";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { SettingRow } from "./SettingRow";
import { SettingsSection } from "./SettingsSection";

const ids = Object.keys(flags.definitions) as FlagId[];

// Each feature in progress, on where its flag says until the user sets it.
export const FlagSettings = () =>
  ids.length ? (
    <SettingsSection title="Flags">
      {ids.map((id) => (
        <FlagSetting id={id} key={id} />
      ))}
    </SettingsSection>
  ) : null;

const FlagSetting = ({ id }: { id: FlagId }) => {
  const setting = useSyncExternalStore(flags.subscribe, () =>
    flags.setting(id),
  );
  const channel = useSyncExternalStore(flags.subscribe, flags.channel);
  const flag: Flag = flags.definitions[id];
  const settings = [
    {
      value: "default",
      label: flag.on.includes(channel) ? "Default (on)" : "Default (off)",
    },
    { value: "on", label: "On" },
    { value: "off", label: "Off" },
  ] satisfies { value: Setting; label: string }[];
  return (
    <SettingRow
      action={
        <Select
          items={settings}
          onValueChange={(next) => next && flags.set(id, next)}
          value={setting}
        >
          <SelectTrigger aria-label={flag.name} size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {settings.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      }
      detail={flag.description}
      label={flag.name}
    />
  );
};
