import { useState } from "react";
import type { Bot } from "../../shared/types";
import { Button } from "../ui/button";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "../ui/select";
import { toastError } from "../shell/Toasts";
import { messageOf } from "../data";
import { botColors } from "../bots/colors";
import {
  accessoryNames,
  appearanceOf,
  glasses,
  hats,
  type Accessories,
} from "./appearance";
import { downloadAvatarGif } from "./download";
import { motions, type Motion } from "./motion";

const labels: Record<string, string> = {
  ...Object.fromEntries(botColors.map(({ hue, name }) => [String(hue), name])),
  ...accessoryNames,
  "look-around": "Look around",
  working: "Working",
  asking: "Waiting",
};
const Choice = ({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly string[];
  onChange: (value: string) => void;
}) => (
  <div className="flex items-center justify-between gap-3">
    <span>{label}</span>
    <Select
      value={value}
      onValueChange={(next) => next !== null && onChange(next)}
    >
      <SelectTrigger aria-label={label} size="sm">
        <SelectValue>
          {(current: string) => labels[current] ?? current}
        </SelectValue>
      </SelectTrigger>
      <SelectContent align="end">
        {options.map((option) => (
          <SelectItem key={option} value={option}>
            {labels[option] ?? option}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  </div>
);

export function AppearanceSection({
  bot,
  onChange,
}: {
  bot: Bot;
  onChange: (change: { hue?: number; accessories?: Accessories }) => void;
}) {
  const appearance = appearanceOf(bot);
  const [motion, setMotion] = useState<Motion>("look-around");
  const [exporting, setExporting] = useState(false);
  const download = async () => {
    setExporting(true);
    try {
      await downloadAvatarGif(appearance, bot.name, { motion });
    } catch (error) {
      console.error("Avatar GIF export failed", error);
      toastError(`Could not export ${bot.name}'s GIF: ${messageOf(error)}`);
    } finally {
      setExporting(false);
    }
  };
  return (
    <section className="flex flex-col gap-3">
      <h3 className="m-0 text-[13px] font-medium text-muted-foreground">
        Appearance
      </h3>
      <Choice
        label="Color"
        value={String(bot.hue)}
        options={botColors.map((color) => String(color.hue))}
        onChange={(hue) => onChange({ hue: Number(hue) })}
      />
      <Choice
        label="Hat"
        value={appearance.hat}
        options={hats}
        onChange={(hat) =>
          onChange({
            accessories: {
              hat: hat as Accessories["hat"],
              glasses: appearance.glasses,
            },
          })
        }
      />
      <Choice
        label="Glasses"
        value={appearance.glasses}
        options={glasses}
        onChange={(glasses) =>
          onChange({
            accessories: {
              hat: appearance.hat,
              glasses: glasses as Accessories["glasses"],
            },
          })
        }
      />
      <Choice
        label="GIF animation"
        value={motion}
        options={motions}
        onChange={(motion) => setMotion(motion as Motion)}
      />
      <Button
        disabled={exporting}
        onClick={() => void download()}
        size="sm"
        variant="secondary"
      >
        {exporting ? "Exporting GIF…" : "Download GIF"}
      </Button>
    </section>
  );
}
