import { useState, type CSSProperties } from "react";

import { bytes } from "@/lib/utils";
import type { Bot, BotDetail, Host } from "../../shared/types";
import {
  languages,
  speeds,
  voices,
  type VoiceSettings,
} from "../../shared/voice";
import {
  bridge,
  botKey,
  call,
  messageOf,
  patch,
  useAppState,
  useBotDetail,
} from "../data";
import { Hint } from "../shell/Hint";
import { CloseIcon, FileIcon } from "../shell/icons";
import { toastError } from "../shell/Toasts";
import { Button } from "../ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { Tabs } from "../ui/tabs";
import { BotAvatar } from "./BotAvatar";
import { BotWhiteboard } from "./BotWhiteboard";
import { cue } from "./avatars";
import { LiveScreen } from "./LiveScreen";
import { Routines } from "./Routines";
import { Section } from "./Section";
import { AppearanceSection } from "../avatars/AppearanceSection";

const tabs = [
  ["computer", "Computer"],
  ["library", "Library"],
  ["details", "Details"],
] as const;
type Tab = (typeof tabs)[number][0];

const update = (
  bot: Bot,
  change: Partial<
    Pick<Bot, "name" | "instructions" | "voice" | "hue" | "accessories">
  >,
) => {
  patch<BotDetail | null>(botKey(bot.id), (current) =>
    current ? { ...current, bot: { ...current.bot, ...change } } : current,
  );
  call({ botId: bot.id, type: "bot.update", ...change }).catch(
    (error: unknown) => toastError(messageOf(error)),
  );
};

// A field that keeps what it says until it loses focus, then saves it.
const useField = (saved: string, save: (value: string) => void) => {
  const [draft, setDraft] = useState<string | null>(null);
  return {
    onBlur: () => {
      if (draft !== null && draft !== saved) save(draft);
      setDraft(null);
    },
    onChange: (event: { currentTarget: { value: string } }) =>
      setDraft(event.currentTarget.value),
    value: draft ?? saved,
  };
};

// One of the bot's voice settings, and what it can be.
const VoiceSetting = ({
  label,
  onChange,
  options,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  options: [value: string, name: string][];
  value: string;
}) => (
  <div className="flex items-center justify-between gap-3">
    {label}
    <Select
      onValueChange={(next) => next !== null && onChange(next)}
      value={value}
    >
      <SelectTrigger aria-label={label} size="sm">
        <SelectValue>
          {(current: string) => options.find(([each]) => each === current)?.[1]}
        </SelectValue>
      </SelectTrigger>
      <SelectContent align="end">
        {options.map(([each, name]) => (
          <SelectItem key={each} value={each}>
            {name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  </div>
);

// Its voice is one of ChatGPT's, or of the speech server's when its
// computer speaks on the user's own model, where it may also keep the
// server's default.
const VoiceSettingsSection = ({
  bot,
  host,
  voice,
}: {
  bot: Bot;
  host: Host;
  voice: VoiceSettings;
}) => {
  const set = (change: Partial<VoiceSettings>) =>
    update(bot, { voice: { ...voice, ...change } });
  const own = host.voice?.kind === "own" ? host.voice.voices : null;
  return (
    <Section title="Voice chat">
      {own ? (
        <VoiceSetting
          label="Voice"
          onChange={(value) =>
            set({ ownVoice: value === "default" ? null : value })
          }
          options={[
            ["default", "Default"],
            ...own.map((each): [string, string] => [each, each]),
          ]}
          value={
            voice.ownVoice && own.includes(voice.ownVoice)
              ? voice.ownVoice
              : "default"
          }
        />
      ) : (
        <VoiceSetting
          label="Voice"
          onChange={(value) => set({ voice: value })}
          options={voices.map((each) => [
            each,
            each[0]!.toUpperCase() + each.slice(1),
          ])}
          value={voice.voice}
        />
      )}
      <VoiceSetting
        label="Speed"
        onChange={(value) => set({ speed: value as VoiceSettings["speed"] })}
        options={Object.entries(speeds)}
        value={voice.speed}
      />
      <VoiceSetting
        label="Language"
        onChange={(value) => set({ language: value === "auto" ? null : value })}
        options={[
          ["auto", "Auto-detect"],
          ...languages.map((each): [string, string] => [each, each]),
        ]}
        value={voice.language ?? "auto"}
      />
    </Section>
  );
};

const DetailsTab = ({
  bot,
  detail,
  host,
}: {
  bot: Bot;
  detail: BotDetail;
  host: Host;
}) => {
  const instructions = useField(detail.bot.instructions, (value) =>
    update(bot, { instructions: value }),
  );
  return (
    <>
      <AppearanceSection
        bot={detail.bot}
        onChange={(change) => update(bot, change)}
      />
      <Section title="Instructions">
        <textarea
          {...instructions}
          aria-label="Instructions"
          className="details-instructions"
          placeholder="What's it for?"
          rows={4}
        />
      </Section>
      <VoiceSettingsSection bot={bot} host={host} voice={detail.bot.voice} />
      {detail.routines.length ? (
        <Section title="Routines">
          <Routines bot={bot} detail={detail} />
        </Section>
      ) : null}
    </>
  );
};

const LibraryTab = ({ bot, detail }: { bot: Bot; detail: BotDetail }) =>
  detail.files.length ? (
    <div className="-mx-2 flex flex-col">
      {detail.files.map((file) => (
        <button
          className="details-row glow"
          key={file.path}
          onClick={() =>
            bridge
              .openFile(bot.id, file.path)
              .catch((error: unknown) => toastError(messageOf(error)))
          }
          type="button"
        >
          <FileIcon />
          <span className="min-w-0 flex-1 truncate">{file.path}</span>
          <span className="shrink-0 text-muted-foreground">
            {bytes(file.size)}
          </span>
        </button>
      ))}
    </div>
  ) : (
    <p className="m-0 text-muted-foreground">No files yet</p>
  );

const ComputerTab = ({
  bot,
  detail,
  host,
}: {
  bot: Bot;
  detail: BotDetail;
  host: Host;
}) => {
  // A server opens its own copy of the bot's folder.
  const server = useAppState()?.hosts[0]?.server;
  return (
    <>
      <Section title="Whiteboard">
        <BotWhiteboard bot={bot} />
      </Section>
      <Section title="Runs on">
        <div className="flex flex-col">
          <span className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="size-1.5 shrink-0 rounded-full bg-[var(--green)]"
            />
            {host.self ? `${host.name} (this computer)` : host.name}
          </span>
          <span className="pl-3.5 text-muted-foreground">
            {host.os},{" "}
            {host.model ? `on ${host.model}` : "not signed in to ChatGPT"}
          </span>
        </div>
      </Section>
      <ScreenSection host={host} />
      {server ? (
        <Section title="Folder">
          <Button
            className="self-start"
            onClick={() => void bridge.openFolder(bot.id)}
            size="sm"
            variant="ghost"
          >
            Open
          </Button>
        </Section>
      ) : null}
      {detail.commands.length ? (
        <Section title="Commands">
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {detail.commands.toReversed().map((command, index) => (
              <li
                className="truncate font-mono text-xs select-text"
                key={index}
                title={command}
              >
                {command}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </>
  );
};

// The screen the bot sees and uses: live from another computer; on this one,
// the user's own, so only what it takes to let bots use it.
const ScreenSection = ({ host }: { host: Host }) =>
  host.screen === "ready" && !host.self ? (
    <Section title="Screen">
      <LiveScreen hostId={host.id} />
    </Section>
  ) : host.screen === "blocked" ? (
    <Section title="Screen">
      <p className="m-0 text-muted-foreground">
        {host.self
          ? "Bots here can use this screen once Multidesktop Bridge is allowed to record and control it."
          : `Bots on ${host.name} can use its screen once it is allowed there.`}
      </p>
      {host.self ? (
        <Button
          className="self-start"
          onClick={() => void bridge.allowScreen()}
          size="sm"
          variant="secondary"
        >
          Allow
        </Button>
      ) : null}
    </Section>
  ) : null;

// A bot's own panel beside its conversation, as Grok Bot shows one: the bot,
// then its whiteboard and the computer it runs on, its library of files, and
// its details.
export const Details = ({
  bot,
  host,
  onClose,
}: {
  bot: Bot;
  host: Host;
  onClose: () => void;
}) => {
  const detail = useBotDetail(bot.id);
  const [tab, setTab] = useState<Tab>("computer");
  const name = useField(
    bot.name,
    (value) => value.trim() && update(bot, { name: value.trim() }),
  );
  return (
    <aside
      className="details"
      style={{ "--bot-hue": bot.hue } as CSSProperties}
    >
      <div className="details-top">
        <Hint label="Close" side="bottom">
          <button
            aria-label="Close"
            className="icon-button"
            onClick={onClose}
            type="button"
          >
            <CloseIcon />
          </button>
        </Hint>
      </div>
      <div className="details-scroll">
        <header className="flex flex-col items-center gap-3 text-center">
          <Hint label={`Poke ${bot.name}`}>
            <button
              aria-label={`Poke ${bot.name}`}
              className="glow rounded-full border-0 bg-transparent p-0 transition-transform active:scale-95"
              onClick={() => cue(bot.id, "poked")}
              type="button"
            >
              <BotAvatar bot={bot} size={72} />
            </button>
          </Hint>
          <div className="flex w-full flex-col items-center gap-0.5">
            <input
              {...name}
              aria-label="Name"
              className="details-name"
              maxLength={40}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
              spellCheck={false}
            />
            <span className="text-muted-foreground">
              {bot.working ??
                (host.self ? "On this computer" : `On ${host.name}`)}
            </span>
          </div>
        </header>
        <Tabs
          className="justify-center"
          onChange={setTab}
          tabs={tabs}
          value={tab}
        />
        {detail ? (
          tab === "details" ? (
            <DetailsTab bot={bot} detail={detail} host={host} key={bot.id} />
          ) : tab === "library" ? (
            <LibraryTab bot={bot} detail={detail} />
          ) : (
            <ComputerTab bot={bot} detail={detail} host={host} />
          )
        ) : null}
      </div>
    </aside>
  );
};
