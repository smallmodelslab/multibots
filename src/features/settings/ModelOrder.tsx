import { GripVertical } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";
import type {
  ChatgptState,
  ModelList,
  OwnModel,
  OwnModelsState,
} from "../../shared/types";
import { bridge, messageOf } from "../data";
import { toastError } from "../shell/Toasts";
import { hostOf, useOf } from "./OwnModelSetting";

const idOf = (entry: OwnModel | "chatgpt") =>
  entry === "chatgpt" ? entry : entry.id;

const moved = (order: string[], id: string, to: number) => {
  const rest = order.filter((each) => each !== id);
  rest.splice(Math.max(0, to), 0, id);
  return rest;
};

// A list of models in the order they are tried, ChatGPT among them: each
// dragged into its place, or moved with the arrow keys from its handle. The
// new order shows at once, while it is saved.
export const ModelOrder = ({
  chatgpt,
  entries,
  list,
}: {
  chatgpt: ChatgptState;
  entries: OwnModelsState[ModelList];
  list: ModelList;
}) => {
  // The order shown while one is dragged (`id`) or saved.
  const [moving, setMoving] = useState<{
    id: string | null;
    order: string[];
  } | null>(null);
  const byId = new Map(entries.map((entry) => [idOf(entry), entry]));
  const order = (moving?.order ?? entries.map(idOf)).filter((id) =>
    byId.has(id),
  );
  const save = (next: string[]) => {
    const saving = { id: null, order: next };
    setMoving(saving);
    void bridge
      .orderModels(list, next)
      .catch((error: unknown) => toastError(messageOf(error)))
      .finally(() =>
        setMoving((current) => (current === saving ? null : current)),
      );
  };
  return order.map((id, index) => {
    const entry = byId.get(id)!;
    const name = entry === "chatgpt" ? "ChatGPT" : entry.model;
    return (
      <div
        className={cn("setting model-order", moving?.id === id && "is-moving")}
        draggable
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
          if (moving?.id) save(moving.order);
        }}
      >
        <div className="setting-row">
          <button
            aria-label={`Move ${name}`}
            className="icon-button model-order-handle"
            onKeyDown={(event) => {
              const to =
                event.key === "ArrowUp"
                  ? index - 1
                  : event.key === "ArrowDown"
                    ? index + 1
                    : null;
              if (to === null) return;
              event.preventDefault();
              if (to >= 0 && to < order.length) save(moved(order, id, to));
            }}
            type="button"
          >
            <GripVertical aria-hidden size={16} strokeWidth={1.5} />
          </button>
          <span className="truncate">{name}</span>
          <span className="truncate text-muted-foreground">
            {entry === "chatgpt"
              ? (chatgpt.email ??
                (chatgpt.signedIn ? "Signed in" : "Not signed in"))
              : entry.kind === "bots"
                ? hostOf(entry.address)
                : `${useOf[entry.kind]} · ${hostOf(entry.address)}`}
          </span>
        </div>
      </div>
    );
  });
};
