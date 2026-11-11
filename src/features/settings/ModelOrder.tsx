import { GripVertical } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";
import type {
  ChatgptState,
  OwnModel,
  OwnModelKind,
  OwnModelsState,
} from "../../shared/types";
import { bridge, messageOf } from "../data";
import { toastError } from "../shell/Toasts";
import { hostOf } from "./OwnModelSetting";

// One source in a capability's order: ChatGPT or a model the user hosts,
// skipped while it can't run, with why.
type Source = { id: string; name: string; detail: string; skipped: boolean };

const moved = (order: string[], id: string, to: number) => {
  const rest = order.filter((each) => each !== id);
  rest.splice(Math.max(0, to), 0, id);
  return rest;
};

// A capability's sources in the order they are tried: each dragged into its
// place, or moved with the arrow keys from its handle. The new order shows
// at once, while it is saved.
const SourceOrder = ({
  label,
  save,
  sources,
}: {
  label: string;
  save: (ids: string[]) => Promise<void>;
  sources: Source[];
}) => {
  // The order shown while one is dragged (`id`) or saved.
  const [moving, setMoving] = useState<{
    id: string | null;
    order: string[];
  } | null>(null);
  const byId = new Map(sources.map((source) => [source.id, source]));
  const order = (moving?.order ?? sources.map(({ id }) => id)).filter((id) =>
    byId.has(id),
  );
  const store = (next: string[]) => {
    const saving = { id: null, order: next };
    setMoving(saving);
    void save(next)
      .catch((error: unknown) => toastError(messageOf(error)))
      .finally(() =>
        setMoving((current) => (current === saving ? null : current)),
      );
  };
  return (
    <ol aria-label={`${label} order`} className="source-order">
      {order.map((id, index) => {
        const source = byId.get(id)!;
        return (
          <li
            className={cn(
              "source",
              source.skipped && "is-skipped",
              moving?.id === id && "is-moving",
            )}
            draggable={order.length > 1}
            key={id}
            onDragEnd={(event) => {
              if (event.dataTransfer.dropEffect === "none") setMoving(null);
            }}
            onDragOver={(event) => {
              if (!moving?.id) return;
              event.preventDefault();
              if (moving.id !== id)
                setMoving({
                  id: moving.id,
                  order: moved(moving.order, moving.id, index),
                });
            }}
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = "move";
              setMoving({ id, order });
            }}
            onDrop={(event) => {
              event.preventDefault();
              if (moving?.id) store(moving.order);
            }}
          >
            <button
              aria-label={`Move ${source.name}`}
              className="icon-button source-handle"
              disabled={order.length < 2}
              onKeyDown={(event) => {
                const to =
                  event.key === "ArrowUp"
                    ? index - 1
                    : event.key === "ArrowDown"
                      ? index + 1
                      : null;
                if (to === null) return;
                event.preventDefault();
                if (to >= 0 && to < order.length) store(moved(order, id, to));
              }}
              type="button"
            >
              <GripVertical aria-hidden size={16} strokeWidth={1.5} />
            </button>
            <span className="source-index">{index + 1}</span>
            <span className="truncate">{source.name}</span>
            <span className="truncate text-muted-foreground">
              {source.detail}
            </span>
          </li>
        );
      })}
    </ol>
  );
};

const Capability = ({
  empty,
  label,
  save,
  sources,
}: {
  // What to set up while none of its sources can run.
  empty: string;
  label: string;
  save: (ids: string[]) => Promise<void>;
  sources: Source[];
}) => (
  <div className="setting">
    <div className="setting-row capability">
      <div className="setting-label">{label}</div>
      <div className="setting-detail">
        {sources.some(({ skipped }) => !skipped) ? (
          <SourceOrder label={label} save={save} sources={sources} />
        ) : (
          <span className="capability-empty">{empty}</span>
        )}
      </div>
    </div>
  </div>
);

type Voice = Exclude<OwnModelKind, "bots">;
const other = { speech: "transcription", transcription: "speech" } as const;

// What chat, transcription and speech each run on, in order, with ChatGPT
// among the models the user hosts. Chat tries each in turn on every call.
// A voice chat runs on ChatGPT's voice, which hears and speaks in one call,
// or on the user's transcription and speech models together, so ChatGPT
// keeps one place in both orders: first, or after them.
export const ModelOrders = ({
  chatgpt,
  ownModels: { bots, voice },
}: {
  chatgpt: ChatgptState;
  ownModels: OwnModelsState;
}) => {
  const fromChatgpt = (detail: string): Source => ({
    detail: chatgpt.signedIn ? detail : "Not signed in, skipped",
    id: "chatgpt",
    name: "ChatGPT",
    skipped: !chatgpt.signedIn,
  });
  const fromOwn = (model: OwnModel, missing?: string): Source => ({
    detail: missing ?? hostOf(model.address),
    id: model.id,
    name: model.model,
    skipped: Boolean(missing),
  });
  const ownVoice = voice.filter((entry) => entry !== "chatgpt");
  const sourcesOf = (kind: Voice) => {
    const lacking = !ownVoice.some((model) => model.kind === other[kind]);
    const models = ownVoice
      .filter((model) => model.kind === kind)
      .map((model) =>
        fromOwn(
          model,
          lacking ? `Needs a ${other[kind]} model too` : undefined,
        ),
      );
    const voiceOfChatgpt = fromChatgpt("ChatGPT's voice");
    return voice[0] === "chatgpt"
      ? [voiceOfChatgpt, ...models]
      : [...models, voiceOfChatgpt];
  };
  // One kind reordered in the voice's order, ChatGPT first or last.
  const saveVoice = (kind: Voice) => (ids: string[]) => {
    const reordered = ids.filter((id) => id !== "chatgpt");
    let next = 0;
    const own = ownVoice.map((model) =>
      model.kind === kind ? reordered[next++]! : model.id,
    );
    return bridge.orderModels(
      "voice",
      ids[0] === "chatgpt" ? ["chatgpt", ...own] : [...own, "chatgpt"],
    );
  };
  return (
    <>
      <Capability
        empty="Sign in to ChatGPT or add a chat model."
        label="Chat"
        save={(ids) => bridge.orderModels("bots", ids)}
        sources={bots.map((entry) =>
          entry === "chatgpt"
            ? fromChatgpt(chatgpt.email ?? "Signed in")
            : fromOwn(entry),
        )}
      />
      {(["transcription", "speech"] as const).map((kind) => (
        <Capability
          empty="Sign in to ChatGPT, or add a transcription and a speech model."
          key={kind}
          label={kind === "speech" ? "Speech" : "Transcription"}
          save={saveVoice(kind)}
          sources={sourcesOf(kind)}
        />
      ))}
      <div className="setting">
        <p className="capability-note">
          A voice chat starts on the first that's set up and stays on it.
          ChatGPT's voice hears and speaks, so it moves in both lists.
        </p>
      </div>
    </>
  );
};
