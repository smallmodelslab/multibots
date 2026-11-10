import { Dialog } from "@base-ui/react/dialog";
import {
  fontsFrom,
  renderBoard,
  settleBoards,
  Whiteboard,
} from "@wrkrsh/whiteboard/board";
import {
  mergeElements,
  type BoardElement,
  type BoardFile,
} from "@wrkrsh/whiteboard/scene";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import type { Bot } from "../../shared/types";
import { call, messageOf, useWhiteboard } from "../data";
import { Hint } from "../shell/Hint";
import { CloseIcon, DrawIcon } from "../shell/icons";
import { toastError } from "../shell/Toasts";

// The whiteboard the bot and the user both draw on, kept by the bot's
// computer (src/main/bots.ts), in the bot's panel: an image of it, which
// opens it over the whole window to draw on.

// Excalidraw's fonts ship with the renderer (@wrkrsh/whiteboard/vite).
fontsFrom(new URL("excalidraw/", document.baseURI).href);

// What a board is still holding back from the last stroke goes as the
// window closes or reloads.
window.addEventListener("pagehide", settleBoards);

type AddedFile = { id: string; mimeType: string; dataURL: string };

// What this window changed on each board, kept until the bot's computer
// takes it and sent again a moment after it fails, as when that computer is
// out of reach for a while. Its elements are replaced, not changed, so the
// board shows the latest of them as it opens.
type Outbox = {
  elements: ReadonlyMap<string, BoardElement>;
  files: Map<string, AddedFile>;
  retry: ReturnType<typeof setTimeout> | null;
  failing: boolean;
};
const outboxes = new Map<string, Outbox>();
const retryMs = 5000;

const deliver = (botId: string, outbox: Outbox) => {
  if (outbox.retry) return;
  const files = [...outbox.files.values()];
  const elements = [...outbox.elements.values()];
  // All at once, so all of it leaves before a closing window goes.
  void Promise.all([
    ...files.map((file) =>
      call({ botId, file, type: "whiteboard.addFile" }).then(() =>
        outbox.files.delete(file.id),
      ),
    ),
    ...(elements.length
      ? [
          call({ botId, elements, type: "whiteboard.save" }).then(() => {
            outbox.elements = new Map(
              [...outbox.elements].filter(
                ([, element]) => !elements.includes(element),
              ),
            );
          }),
        ]
      : []),
  ]).then(
    () => {
      outbox.failing = false;
    },
    (error: unknown) => {
      if (outbox.retry) return;
      if (!outbox.failing) toastError(messageOf(error));
      outbox.failing = true;
      outbox.retry = setTimeout(() => {
        outbox.retry = null;
        deliver(botId, outbox);
      }, retryMs);
    },
  );
};

const send = (
  { id: botId }: Bot,
  change: { elements?: BoardElement[]; file?: AddedFile },
) => {
  const outbox = outboxes.get(botId) ?? {
    elements: new Map(),
    failing: false,
    files: new Map(),
    retry: null,
  };
  outboxes.set(botId, outbox);
  if (change.elements)
    outbox.elements = new Map([
      ...outbox.elements,
      ...change.elements.map((element) => [element.id, element] as const),
    ]);
  if (change.file) outbox.files.set(change.file.id, change.file);
  deliver(botId, outbox);
};

const dark = matchMedia("(prefers-color-scheme: dark)");
const useTheme = () =>
  useSyncExternalStore(
    (listener) => {
      dark.addEventListener("change", listener);
      return () => dark.removeEventListener("change", listener);
    },
    () => (dark.matches ? "dark" : "light"),
  );

// Boards' images' files, by bot and id, each read once.
const loaded = new Map<string, BoardFile>();
const fileKey = (botId: string, id: string) => `${botId}:${id}`;

const useFiles = ({ id: botId }: Bot, ids: string[] | undefined) => {
  const [files, setFiles] = useState<BoardFile[]>([]);
  const listed = ids?.join(" ");
  useEffect(() => {
    if (listed === undefined) return;
    let current = true;
    void Promise.all(
      listed
        .split(" ")
        .filter(Boolean)
        .map(
          (id) =>
            loaded.get(fileKey(botId, id)) ??
            call({ botId, id, type: "whiteboard.file" }).then(
              (file) => {
                loaded.set(fileKey(botId, id), file);
                return file;
              },
              // Gone since it was listed.
              () => null,
            ),
        ),
    ).then((found) => {
      if (current) setFiles(found.filter((file) => file !== null));
    });
    return () => {
      current = false;
    };
  }, [botId, listed]);
  return files;
};

// The board's image, rendered again a moment after it changes while the
// board is closed.
const renderAfterMs = 300;
const usePreview = (
  elements: BoardElement[] | undefined,
  files: BoardFile[],
  open: boolean,
) => {
  const [url, setUrl] = useState<string | null>(null);
  const drawn = elements?.some((element) => !element.isDeleted) ?? false;
  useEffect(() => {
    if (!elements || !drawn || open) return;
    let current = true;
    const timer = setTimeout(
      () =>
        void renderBoard(elements, files).then(
          (image) => current && setUrl(URL.createObjectURL(image)),
          (error: unknown) =>
            console.error("The whiteboard's image did not render:", error),
        ),
      renderAfterMs,
    );
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [drawn, elements, files, open]);
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );
  return drawn ? url : null;
};

export const BotWhiteboard = ({ bot }: { bot: Bot }) => {
  const board = useWhiteboard(bot.id);
  const files = useFiles(bot, board?.files);
  const [open, setOpen] = useState(false);
  // The board as the servers keep it, with what this window changed
  // that it has yet to take.
  const unsent = outboxes.get(bot.id)?.elements;
  const elements = useMemo(
    () =>
      board && unsent?.size
        ? mergeElements(board.elements, [...unsent.values()])
        : board?.elements,
    [board, unsent],
  );
  const preview = usePreview(elements, files, open);
  const theme = useTheme();
  return (
    <Dialog.Root onOpenChange={setOpen} open={open}>
      <Dialog.Trigger
        aria-label="Open the whiteboard"
        className="whiteboard-preview glow"
        disabled={!board}
      >
        {preview ? <img alt="" src={preview} /> : <DrawIcon />}
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop className="whiteboard-backdrop" />
        <Dialog.Popup className="whiteboard-stage">
          <Dialog.Title className="sr-only">Whiteboard</Dialog.Title>
          <div className="whiteboard-board">
            {elements ? (
              <Whiteboard
                elements={elements}
                files={files}
                onChange={(elements) => send(bot, { elements })}
                onFile={(file) => {
                  loaded.set(fileKey(bot.id, file.id), {
                    id: file.id,
                    mimeType: file.mimeType,
                    url: file.dataURL,
                  });
                  send(bot, { file });
                }}
                theme={theme}
              />
            ) : null}
          </div>
          <div className="whiteboard-bar">
            <Hint label="Close">
              <Dialog.Close aria-label="Close" className="icon-button">
                <CloseIcon />
              </Dialog.Close>
            </Hint>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
