import { GripVertical } from "lucide-react";
import { useRef, useState } from "react";

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

// How an order looks after `id` moved from `before` to `after`.
type Arrange = (before: string[], after: string[], id: string) => string[];

const moved = (order: string[], id: string, to: number) => {
  const rest = order.filter((each) => each !== id);
  rest.splice(Math.max(0, to), 0, id);
  return rest;
};

// ChatGPT's voice comes before the user's models or after them, never
// between: moved up it goes first and moved down last, and a model moved
// past it puts it on the other side.
const voiceArranged: Arrange = (before, after, id) => {
  const was = before.indexOf("chatgpt");
  if (was === -1) return after;
  const first =
    id === "chatgpt"
      ? after.indexOf("chatgpt") < was
      : was === 0
        ? after[0] === "chatgpt"
        : after.at(-1) !== "chatgpt";
  const rest = after.filter((each) => each !== "chatgpt");
  return first ? ["chatgpt", ...rest] : [...rest, "chatgpt"];
};

// An order shown while it is saved: set at once, so a change made before
// the last one is saved builds on it (`latest`).
const usePendingOrder = (
  saved: string[],
  persist: (next: string[]) => Promise<void>,
) => {
  const pending = useRef<string[] | null>(null);
  const [, setShown] = useState<string[] | null>(null);
  return {
    latest: () => pending.current ?? saved,
    order: pending.current ?? saved,
    save: (next: string[]) => {
      pending.current = next;
      setShown(next);
      void persist(next)
        .catch((error: unknown) => toastError(messageOf(error)))
        .finally(() => {
          if (pending.current !== next) return;
          pending.current = null;
          setShown(null);
        });
    },
  };
};

// A capability's sources in the order they are tried: each dragged into its
// place, or moved with the arrow keys from its handle.
const SourceOrder = ({
  arrange = (_, after) => after,
  label,
  save,
  sources,
}: {
  arrange?: Arrange;
  label: string;
  save: (ids: string[]) => void;
  sources: Source[];
}) => {
  // The order shown while one is dragged (`id`, from `start`).
  const [moving, setMoving] = useState<{
    id: string;
    start: string[];
    order: string[];
  } | null>(null);
  const byId = new Map(sources.map((source) => [source.id, source]));
  const order = (moving?.order ?? sources.map(({ id }) => id)).filter((id) =>
    byId.has(id),
  );
  const store = (next: string[]) => {
    setMoving(null);
    save(next);
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
              const next = arrange(
                moving.start,
                moved(moving.start, moving.id, index),
                moving.id,
              );
              if (next.join() !== moving.order.join())
                setMoving({ ...moving, order: next });
            }}
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = "move";
              setMoving({ id, order, start: order });
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
                if (to >= 0 && to < order.length)
                  store(arrange(order, moved(order, id, to), id));
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
  arrange,
  empty,
  label,
  save,
  sources,
}: {
  arrange?: Arrange;
  // What to set up while none of its sources can run.
  empty: string;
  label: string;
  save: (ids: string[]) => void;
  sources: Source[];
}) => (
  <div className="setting">
    <div className="setting-row capability">
      <div className="setting-label">{label}</div>
      <div className="setting-detail">
        {sources.some(({ skipped }) => !skipped) ? (
          <SourceOrder
            arrange={arrange}
            label={label}
            save={save}
            sources={sources}
          />
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
// among the models the user hosts. Chat tries each in turn on every call. A
// voice chat runs on ChatGPT's voice, which hears and speaks in one call, or
// on the user's transcription and speech models together, so ChatGPT keeps
// one place in both lists: first, or after them. Both lists change the one
// voice order. Each order shows at once while it is saved.
export const ModelOrders = ({
  chatgpt,
  ownModels: { bots, voice },
}: {
  chatgpt: ChatgptState;
  ownModels: OwnModelsState;
}) => {
  const idOf = (entry: OwnModel | "chatgpt") =>
    entry === "chatgpt" ? entry : entry.id;
  const chat = usePendingOrder(bots.map(idOf), (next) =>
    bridge.orderModels("bots", next),
  );
  const voices = usePendingOrder(voice.map(idOf), (next) =>
    bridge.orderModels("voice", next),
  );
  const byId = new Map(
    [...bots, ...voice].map((entry) => [idOf(entry), entry]),
  );
  const orderOf = (ids: string[]) =>
    ids.map((id) => byId.get(id)).filter((entry) => entry !== undefined);
  const voiceOrder = orderOf(voices.order);
  const ownVoice = voiceOrder.filter((entry) => entry !== "chatgpt");
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
    return voiceOrder[0] === "chatgpt"
      ? [voiceOfChatgpt, ...models]
      : [...models, voiceOfChatgpt];
  };
  // One kind reordered in the voice's order, ChatGPT first or last.
  const saveVoice = (kind: Voice) => (ids: string[]) => {
    const reordered = ids.filter((id) => id !== "chatgpt");
    let at = 0;
    const own = orderOf(voices.latest())
      .filter((entry) => entry !== "chatgpt")
      .map((model) => (model.kind === kind ? reordered[at++]! : model.id));
    voices.save(
      ids[0] === "chatgpt" ? ["chatgpt", ...own] : [...own, "chatgpt"],
    );
  };
  return (
    <>
      <Capability
        empty="Sign in to ChatGPT or add a chat model."
        label="Chat"
        save={chat.save}
        sources={orderOf(chat.order).map((entry) =>
          entry === "chatgpt"
            ? fromChatgpt(chatgpt.email ?? "Signed in")
            : fromOwn(entry),
        )}
      />
      {(["transcription", "speech"] as const).map((kind) => (
        <Capability
          arrange={voiceArranged}
          empty="Sign in to ChatGPT, or add a transcription and a speech model."
          key={kind}
          label={kind === "speech" ? "Speech" : "Transcription"}
          save={saveVoice(kind)}
          sources={sourcesOf(kind)}
        />
      ))}
      <div className="setting">
        <p className="capability-note">
          Chat moves to the next when one fails. A voice chat stays on ChatGPT's
          voice or your models, whichever it starts on, and your models move to
          the next of their kind when one fails. ChatGPT's voice hears and
          speaks, so it moves in both lists.
        </p>
      </div>
    </>
  );
};
