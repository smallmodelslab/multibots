import { WizardDialog } from "@wrkrsh/wizard";
import { senders, type Sender } from "@wrkrsh/webhooks";
import { Check, Copy, Eye, EyeOff } from "lucide-react";
import { useState } from "react";

import {
  describeSource,
  describeTrigger,
  webhookWait,
} from "../../shared/schedule";
import type { Bot, BotDetail, Routine, Webhook } from "../../shared/types";
import { botKey, call, messageOf, patch, refresh } from "../data";
import { Hint } from "../shell/Hint";
import { toastError } from "../shell/Toasts";
import { WizardTop } from "../shell/WizardTop";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { Switch } from "../ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";

// What the bot set itself to do later, each with what wakes it. The bot
// writes them; the user switches each off and on here, and opens one to
// manage it.
export const Routines = ({ bot, detail }: { bot: Bot; detail: BotDetail }) => (
  <ul className="m-0 -ml-2 flex list-none flex-col gap-1 p-0">
    {detail.routines.map((routine) => (
      <li className="flex items-center gap-2" key={routine.id}>
        <RoutineDialog
          bot={bot}
          routine={routine}
          webhook={detail.webhooks[routine.id]}
        />
        <Switch
          aria-label={`${routine.title}: ${routine.enabled ? "on" : "off"}`}
          checked={routine.enabled}
          onCheckedChange={(enabled) => {
            patch<BotDetail | null>(botKey(bot.id), (current) =>
              current
                ? {
                    ...current,
                    routines: current.routines.map((each) =>
                      each.id === routine.id ? { ...each, enabled } : each,
                    ),
                  }
                : current,
            );
            call({
              botId: bot.id,
              enabled,
              routineId: routine.id,
              type: "routine.enable",
            }).catch((error: unknown) => {
              refresh(botKey(bot.id));
              toastError(messageOf(error));
            });
          }}
        />
      </li>
    ))}
  </ul>
);

// A routine's row, which opens it: what wakes it, what it does, and for one
// a webhook wakes, who calls it, where, and with what secret.
const RoutineDialog = ({
  bot,
  routine,
  webhook,
}: {
  bot: Bot;
  routine: Routine;
  webhook: Webhook | undefined;
}) => {
  const [open, setOpen] = useState(false);
  const wait = webhookWait(routine, webhook);
  return (
    <WizardDialog
      onOpenChange={setOpen}
      open={open}
      title={routine.title}
      trigger={
        <button className="details-row glow min-w-0 flex-1" type="button">
          <span className="flex min-w-0 flex-col">
            <span className="truncate">{routine.title}</span>
            {/* What it waits for stays whole; a long sender is cut short. */}
            <span className="flex min-w-0 text-muted-foreground">
              <span className="truncate">
                {describeSource(routine, webhook)}
              </span>
              {wait ? (
                <span className="shrink-0 whitespace-pre"> · {wait}</span>
              ) : null}
            </span>
          </span>
        </button>
      }
    >
      <div className="relative flex max-h-[calc(100vh-64px)] flex-col gap-5 overflow-y-auto p-5">
        <WizardTop />
        <header className="flex flex-col gap-0.5 pr-8">
          <h2 className="m-0 text-[15px] font-semibold wrap-anywhere">
            {routine.title}
          </h2>
          <p className="m-0 text-muted-foreground">
            {describeTrigger(routine, webhook)}
          </p>
        </header>
        <p className="m-0 whitespace-pre-wrap wrap-anywhere select-text">
          {routine.instructions}
        </p>
        {webhook ? (
          <WebhookFields bot={bot} routineId={routine.id} webhook={webhook} />
        ) : null}
      </div>
    </WizardDialog>
  );
};

// Who calls a webhook, where, and the secret they prove themselves with:
// ours to copy, or theirs to paste, with how to set the sender up.
const WebhookFields = ({
  bot,
  routineId,
  webhook,
}: {
  bot: Bot;
  routineId: string;
  webhook: Webhook;
}) => {
  const sender = senders[webhook.sender];
  const set = (next: Sender, secret?: string) =>
    call({
      botId: bot.id,
      routineId,
      secret,
      sender: next,
      type: "routine.webhook",
    }).catch((error: unknown) => toastError(messageOf(error)));
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-3">
        <span className="text-muted-foreground">Sender</span>
        <Select
          onValueChange={(next) => next !== null && void set(next)}
          value={webhook.sender}
        >
          <SelectTrigger aria-label="Sender" className="-ml-2.5" size="sm">
            <SelectValue>
              {(current: Sender) => senders[current].label}
            </SelectValue>
          </SelectTrigger>
          <SelectContent align="start">
            {Object.entries(senders).map(([value, { label }]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span />
        <WebhookValue label="POST to" name="URL" value={webhook.url} />
        {sender.ours ? (
          <WebhookValue
            label={sender.secret}
            name={sender.secret.toLowerCase()}
            secret
            value={webhook.secret ?? ""}
          />
        ) : (
          <PastedSecret
            key={webhook.sender}
            label={sender.secret}
            onSave={(secret) => set(webhook.sender, secret)}
            saved={webhook.secret}
          />
        )}
      </div>
      <p className="m-0 text-muted-foreground">{sender.setup}</p>
    </div>
  );
};

// A value of a webhook's to copy, `name`d for assistive technology, in a
// row of the webhook's grid; a secret one shows only when asked.
const WebhookValue = ({
  label,
  name,
  secret = false,
  value,
}: {
  label: string;
  name: string;
  secret?: boolean;
  value: string;
}) => {
  const [shown, setShown] = useState(!secret);
  // What was copied, so a value changed since, as by a new sender, isn't
  // shown as copied.
  const [copied, setCopied] = useState<string | null>(null);
  return (
    <>
      <span className="text-muted-foreground">{label}</span>
      <span
        className="truncate font-mono text-xs select-text"
        title={shown ? value : undefined}
      >
        {shown ? value : "•".repeat(20)}
      </span>
      <span className="flex items-center justify-end gap-1">
        {secret ? (
          <Hint label={shown ? "Hide" : "Show"}>
            <button
              aria-label={`${shown ? "Hide" : "Show"} the ${name}`}
              className="icon-button"
              onClick={() => setShown(!shown)}
              type="button"
            >
              {shown ? (
                <EyeOff aria-hidden size={16} strokeWidth={1.5} />
              ) : (
                <Eye aria-hidden size={16} strokeWidth={1.5} />
              )}
            </button>
          </Hint>
        ) : null}
        <Hint label={copied === value ? "Copied" : "Copy"}>
          <button
            aria-label={`Copy the ${name}`}
            className="icon-button"
            onClick={() =>
              void navigator.clipboard
                .writeText(value)
                .then(() => setCopied(value))
            }
            type="button"
          >
            {copied === value ? (
              <Check aria-hidden size={16} strokeWidth={1.5} />
            ) : (
              <Copy aria-hidden size={16} strokeWidth={1.5} />
            )}
          </button>
        </Hint>
      </span>
    </>
  );
};

// A sender's own secret, pasted and saved, in a row of the webhook's grid.
const PastedSecret = ({
  label,
  onSave,
  saved,
}: {
  label: string;
  onSave: (secret: string) => void;
  saved: string | null;
}) => {
  const [draft, setDraft] = useState(saved ?? "");
  // One saved elsewhere since, as on another computer, takes the place of
  // a draft not edited here, so Save can't put back the one before.
  const [shownSaved, setShownSaved] = useState(saved);
  if (saved !== shownSaved) {
    setShownSaved(saved);
    if (draft.trim() === (shownSaved ?? "")) setDraft(saved ?? "");
  }
  const pasted = draft.trim();
  const why = !pasted
    ? `Paste the ${label.toLowerCase()} to save it`
    : pasted === saved
      ? "Saved"
      : null;
  return (
    <>
      <span className="text-muted-foreground">{label}</span>
      <Input
        aria-label={label}
        className="h-7 font-mono text-xs md:text-xs"
        onChange={(event) => setDraft(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && why === null) onSave(pasted);
        }}
        placeholder="Paste it here"
        spellCheck={false}
        type="password"
        value={draft}
      />
      {/* Why it can't save, only while it can't: one tooltip throughout,
          so the button keeps its focus as that changes. */}
      <Tooltip disabled={why === null}>
        <TooltipTrigger
          render={
            <Button
              disabled={why !== null}
              focusableWhenDisabled
              onClick={() => onSave(pasted)}
              size="sm"
              variant="secondary"
            >
              Save
            </Button>
          }
        />
        <TooltipContent>{why}</TooltipContent>
      </Tooltip>
    </>
  );
};
