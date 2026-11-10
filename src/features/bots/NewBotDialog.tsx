import type { Dialog } from "@base-ui/react/dialog";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

import { Button, buttonVariants } from "@/features/ui/button";
import {
  grokHues,
  grokRecipeSchema,
  type GrokRecipe,
} from "../../shared/grokBot";
import { bridge, call, messageOf } from "../data";
import { useAvatar, SquircleAvatar } from "../avatars/SquircleAvatar";
import {
  accessoryNames,
  defaultAccessories,
  glasses,
  hats,
  type Accessories,
  type Appearance,
} from "../avatars/appearance";
import { renderAvatar } from "../avatars/artwork";
import { samplePose } from "../avatars/motion";
import {
  useStillOpen,
  WizardDialog,
  WizardDots,
  WizardStep,
} from "@wrkrsh/wizard";
import { WizardTop } from "../shell/WizardTop";
import { botColors, nextHue } from "./colors";
import "./newBot.css";

type Step = "name" | "look" | "purpose" | "import";
const newSteps: Step[] = ["name", "look", "purpose"];
// A bot from Grok Bot brings its name and what it is for.
const importSteps: Step[] = ["import", "look"];

// Every hat or pair of glasses as the wizard's choice cards, each one tried
// on the bot as it is now.
const still = samplePose(0);
const Outfits = <Kind extends keyof Accessories>({
  appearance,
  autoFocus = false,
  kind,
  label,
  onChange,
  options,
}: {
  appearance: Appearance;
  autoFocus?: boolean;
  kind: Kind;
  label: string;
  onChange: (value: Accessories[Kind]) => void;
  options: readonly Accessories[Kind][];
}) => (
  <fieldset className="wizard-choices new-bot-outfits">
    <legend className="sr-only">{label}</legend>
    {options.map((option) => (
      <label
        className="wizard-choice glow"
        key={option}
        title={accessoryNames[option]}
      >
        <input
          aria-label={accessoryNames[option]}
          autoFocus={autoFocus && appearance[kind] === option}
          checked={appearance[kind] === option}
          className="sr-only"
          name={`bot-${kind}`}
          onChange={() => onChange(option)}
          type="radio"
          value={option}
        />
        <span
          aria-hidden="true"
          className="new-bot-outfit"
          dangerouslySetInnerHTML={{
            __html: renderAvatar({ ...appearance, [kind]: option }, still),
          }}
        />
      </label>
    ))}
  </fieldset>
);

type Status =
  | { kind: "editing" }
  | { kind: "failed"; message: string }
  | { kind: "born"; botId: string | null };

const Wizard = ({
  hues,
  onDone,
}: {
  hues: number[];
  onDone: (botId: string) => void;
}) => {
  const [at, setAt] = useState<{ direction: 1 | -1; index: number }>({
    direction: 1,
    index: 0,
  });
  const [name, setName] = useState("");
  const [purpose, setPurpose] = useState("");
  // Picked once, so the bot it makes doesn't move the default on.
  const [hue, setHue] = useState(() => nextHue(hues));
  const [status, setStatus] = useState<Status>({ kind: "editing" });
  // Grok Bot's bots to bring one over from, while importing, and the one
  // picked.
  const [grok, setGrok] = useState<GrokRecipe[] | null>(null);
  const [recipe, setRecipe] = useState<GrokRecipe | null>(null);

  const steps = grok ? importSteps : newSteps;
  const index = Math.min(at.index, steps.length - 1);
  const step = steps[index]!;
  const last = index === steps.length - 1;

  const [accessories, setAccessories] = useState(() =>
    defaultAccessories(crypto.randomUUID()),
  );
  const appearance = { hue, ...accessories };
  const avatar = useAvatar(appearance);
  const typed = name.trim().length;
  useEffect(
    () => avatar.setState({ appearance: { hue, ...accessories } }),
    [avatar, hue, accessories],
  );
  // It glances at what changes, then goes back to looking around.
  const glanceEnds = useRef(0);
  const glance = (x: number, y: number) => {
    avatar.lookAt(x, y);
    clearTimeout(glanceEnds.current);
    glanceEnds.current = window.setTimeout(() => avatar.releaseGaze(), 900);
  };
  const dress = (change: Partial<Accessories>) => {
    setAccessories({ ...accessories, ...change });
    avatar.react();
    if (change.hat) glance(0, -1);
    else avatar.blink();
  };

  const edit = () => {
    if (status.kind === "failed") setStatus({ kind: "editing" });
  };
  const go = (by: 1 | -1) => {
    edit();
    setAt({ direction: by, index: index + by });
    avatar.blink();
  };
  const startImport = () => {
    edit();
    setGrok([]);
    setAt({ direction: 1, index: 0 });
    void bridge
      .grokBots()
      .then((found) => setGrok((list) => list && [...list, ...found]));
  };
  const stopImport = () => {
    edit();
    setGrok(null);
    setRecipe(null);
    setAt({ direction: -1, index: 0 });
  };
  const pick = (picked: GrokRecipe) => {
    edit();
    setRecipe(picked);
    setName(picked.profile.name);
    const grokHue = grokHues[picked.profile.avatarColor ?? ""];
    if (grokHue !== undefined) setHue(grokHue);
    avatar.react();
  };
  const openRecipe = async (file: File) => {
    const parsed = grokRecipeSchema.safeParse(
      await file
        .text()
        .then(JSON.parse)
        .catch(() => null),
    );
    if (!parsed.success) {
      setStatus({ kind: "failed", message: "That isn't a Grok Bot recipe." });
      return;
    }
    setGrok((list) => [parsed.data, ...(list ?? [])]);
    pick(parsed.data);
  };
  const ready = step === "name" ? typed > 0 : step !== "import" || !!recipe;

  const shown = useStillOpen();
  const make = () => {
    setStatus({ botId: null, kind: "born" });
    avatar.react();
    (recipe
      ? call({ accessories, hue, recipe, type: "bot.import" })
      : call({
          hue,
          accessories,
          instructions: purpose,
          name: name.trim(),
          type: "bot.create",
        })
    ).then(
      (bot) => setStatus({ botId: bot.id, kind: "born" }),
      (error: unknown) => {
        if (shown.current)
          setStatus({ kind: "failed", message: messageOf(error) });
      },
    );
  };

  const content: Record<Step, ReactNode> = {
    name: (
      <>
        <input
          aria-label="Name"
          autoComplete="off"
          autoFocus
          className="wizard-name"
          maxLength={40}
          onChange={(event) => {
            const next = event.currentTarget.value;
            if (!name.trim() && next.trim()) avatar.react();
            glance(Math.min(1, next.trim().length * 0.03), 0.8);
            setName(next);
            edit();
          }}
          placeholder="Name"
          spellCheck={false}
          value={name}
        />
        <Button
          className="new-bot-import"
          onClick={startImport}
          size="sm"
          type="button"
          variant="ghost"
        >
          Import from Grok Bot
        </Button>
      </>
    ),
    import: (
      <>
        {grok?.length ? (
          <fieldset className="wizard-choices">
            <legend className="sr-only">Grok Bot's bots</legend>
            {grok.map((each, i) => (
              <label className="wizard-choice glow" key={i}>
                <input
                  aria-label={each.profile.name}
                  autoFocus={i === 0}
                  checked={recipe === each}
                  className="sr-only"
                  name="grok-bot"
                  onChange={() => pick(each)}
                  type="radio"
                />
                <span className="wizard-choice-name">{each.profile.name}</span>
              </label>
            ))}
          </fieldset>
        ) : null}
        <label
          className={buttonVariants({
            className: "new-bot-recipe",
            size: "sm",
            variant: "secondary",
          })}
        >
          Open a recipe
          <input
            accept=".json,application/json"
            className="sr-only"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (file) void openRecipe(file);
            }}
            type="file"
          />
        </label>
        <p className="new-bot-recipe-note">
          Ask your Grok bot for its template recipe as JSON to bring its memory,
          skills and routines too.
        </p>
      </>
    ),
    look: (
      <>
        <Outfits
          appearance={appearance}
          autoFocus
          kind="hat"
          label="Hat"
          onChange={(hat) => dress({ hat })}
          options={hats}
        />
        <Outfits
          appearance={appearance}
          kind="glasses"
          label="Glasses"
          onChange={(glasses) => dress({ glasses })}
          options={glasses}
        />
      </>
    ),
    purpose: (
      <textarea
        aria-label="What it's for"
        autoFocus
        className="new-bot-purpose"
        maxLength={2000}
        onChange={(event) => {
          setPurpose(event.currentTarget.value);
          glance(0, 0.9);
          edit();
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter" || event.shiftKey) return;
          event.preventDefault();
          event.currentTarget.form?.requestSubmit();
        }}
        placeholder="What's it for?"
        rows={3}
        value={purpose}
      />
    ),
  };

  return (
    <form
      className="wizard-form new-bot-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (status.kind === "born" || !ready) return;
        if (last) make();
        else go(1);
      }}
      style={{ "--bot-hue": hue } as CSSProperties}
    >
      <div
        className={
          status.kind === "born" ? "new-bot-avatar is-born" : "new-bot-avatar"
        }
      >
        <SquircleAvatar className="bot-avatar" controller={avatar} size={104} />
      </div>
      <fieldset className="new-bot-colors" disabled={status.kind === "born"}>
        <legend className="sr-only">Bot color</legend>
        {botColors.map((color) => (
          <label
            className="new-bot-color glow"
            key={color.hue}
            style={
              {
                "--swatch": `hsl(${color.hue} 70% ${color.lightness}%)`,
              } as CSSProperties
            }
            title={color.name}
          >
            <input
              aria-label={color.name}
              checked={hue === color.hue}
              className="sr-only"
              name="bot-color"
              onChange={() => {
                setHue(color.hue);
                avatar.react();
                edit();
              }}
              type="radio"
              value={color.hue}
            />
            <span aria-hidden="true" />
          </label>
        ))}
      </fieldset>
      <fieldset className="wizard-stage">
        {status.kind === "born" ? (
          <WizardStep className="new-bot-born" key="born">
            <span className="new-bot-born-name">{name.trim()}</span>
          </WizardStep>
        ) : (
          <WizardStep direction={at.direction} key={step}>
            {content[step]}
          </WizardStep>
        )}
        {status.kind === "failed" ? (
          <p className="wizard-error" role="alert">
            {status.message}
          </p>
        ) : null}
      </fieldset>
      <div className="wizard-foot">
        {status.kind === "born" ? (
          <Button
            autoFocus
            className="new-bot-hello"
            disabled={!status.botId}
            onClick={() => status.botId && onDone(status.botId)}
            type="button"
          >
            Say hello
          </Button>
        ) : (
          <>
            <WizardDots count={steps.length} index={index} />
            <Button className="wizard-next" disabled={!ready} type="submit">
              {last ? "Create" : "Next"}
            </Button>
          </>
        )}
      </div>
      <WizardTop
        onBack={
          status.kind === "born"
            ? null
            : index > 0
              ? () => go(-1)
              : grok
                ? stopImport
                : null
        }
      />
    </form>
  );
};

// A new bot: named, told what it is for, and greeted, opened from
// `trigger`. The wizard starts over each time it opens.
export const NewBotDialog = ({
  hues,
  onOpenBot,
  trigger,
}: {
  // The colours the user's bots already wear.
  hues: number[];
  onOpenBot: (botId: string) => void;
  trigger: Dialog.Trigger.Props["render"];
}) => {
  const [open, setOpen] = useState(false);
  return (
    <WizardDialog
      onOpenChange={setOpen}
      open={open}
      title="New bot"
      trigger={trigger}
    >
      <Wizard
        hues={hues}
        onDone={(botId) => {
          setOpen(false);
          onOpenBot(botId);
        }}
      />
    </WizardDialog>
  );
};
