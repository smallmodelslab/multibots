import "@excalidraw/excalidraw/index.css";
import "./whiteboard.css";

import {
  CaptureUpdateAction,
  Excalidraw,
  MainMenu,
  exportToBlob,
  newElementWith,
  reconcileElements,
  restoreElements,
} from "@excalidraw/excalidraw";
import type { RemoteExcalidrawElement } from "@excalidraw/excalidraw/data/reconcile";
import type { BinaryFileData, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import type { BoardElement, BoardFile } from "./scene";

declare global {
  interface Window {
    EXCALIDRAW_ASSET_PATH?: string | string[];
  }
}

// Excalidraw's fonts come from the app, which serves them with ./vite at this
// absolute URL, rather than from a CDN its content policy refuses. Set before
// a board shows or renders.
export const fontsFrom = (assets: string) => {
  window.EXCALIDRAW_ASSET_PATH = assets;
};

// Text keeps the size it came with: measured before its face has loaded,
// Excalidraw would remember the wrong widths for good.
const restored = (elements: readonly BoardElement[], refreshDimensions = false) =>
  restoreElements(elements as never, null, {
    refreshDimensions,
    repairBindings: true,
  });

// An image's file as Excalidraw holds it, fetched from where the board keeps
// it.
const fileData = async (file: BoardFile): Promise<BinaryFileData> => {
  const dataURL = file.url.startsWith("data:")
    ? file.url
    : await fetch(file.url)
        .then((response) => {
          if (!response.ok) throw new Error(`An image did not load: ${response.status}.`);
          return response.blob();
        })
        .then(
          (blob) =>
            new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result as string);
              reader.onerror = () => reject(reader.error);
              reader.readAsDataURL(blob);
            }),
        );
  return {
    id: file.id as BinaryFileData["id"],
    mimeType: file.mimeType as BinaryFileData["mimeType"],
    dataURL: dataURL as BinaryFileData["dataURL"],
    created: 0,
  };
};

// What a person changes reaches the board this long after they stop, so a
// stroke or a drag is one change.
const settleMs = 250;

// Every shown board's way to report what it is still holding back.
const settling = new Set<() => void>();

// Reports at once what every shown board is holding back, as before the
// window closes.
export const settleBoards = () => {
  for (const send of settling) send();
};

// The board, which a person draws on while it follows the stored board as
// others change it.
export const Whiteboard = ({
  elements,
  files,
  onChange,
  onFile,
  theme,
}: {
  // The board as stored, as it changes.
  elements: readonly BoardElement[];
  // The images' files the board keeps.
  files: readonly BoardFile[];
  // The elements the person changed.
  onChange: (changed: BoardElement[]) => void;
  // An image's file the person added, for the board to keep.
  onFile: (file: { id: string; mimeType: string; dataURL: string }) => void;
  theme: "light" | "dark";
}) => {
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  // Each element's version as last heard from the board or sent to it.
  const known = useRef(new Map<string, number>());
  const pending = useRef(new Map<string, BoardElement>());
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // The files the board keeps or has been sent.
  const kept = useRef(new Set<string>());
  const hear = (from: readonly BoardElement[]) => {
    for (const element of from)
      if ((known.current.get(element.id) ?? 0) < element.version)
        known.current.set(element.id, element.version);
  };
  const [initial] = useState(() => {
    hear(elements);
    return { elements: restored(elements), scrollToContent: true };
  });

  const send = useEffectEvent(() => {
    timer.current = undefined;
    const changed = [...pending.current.values()];
    pending.current.clear();
    if (changed.length) onChange(changed);
  });
  useEffect(() => {
    const settle = () => {
      clearTimeout(timer.current);
      send();
    };
    settling.add(settle);
    return () => {
      settling.delete(settle);
      settle();
    };
  }, []);

  useEffect(() => {
    if (!api) return;
    hear(elements);
    api.updateScene({
      elements: reconcileElements(
        api.getSceneElementsIncludingDeleted(),
        restored(elements) as RemoteExcalidrawElement[],
        api.getAppState(),
      ),
      captureUpdate: CaptureUpdateAction.NEVER,
    });
    // Text an agent wrote comes with its size guessed. Measured with its
    // face loaded, text whose size was off changes, which redraws it and
    // corrects the board.
    const text = elements.flatMap((element) =>
      element.type === "text" && !element.isDeleted ? [element.text as string] : [],
    );
    if (!text.length) return;
    let shown = true;
    void document.fonts.load("20px Excalifont", text.join("")).then((faces) => {
      if (!shown || !faces.length) return;
      const scene = api.getSceneElementsIncludingDeleted();
      const measured = restored(scene as never, true);
      if (
        measured.every(
          (element, at) =>
            element.width === scene[at]!.width && element.height === scene[at]!.height,
        )
      )
        return;
      api.updateScene({
        elements: measured.map((element, at) =>
          element.width === scene[at]!.width && element.height === scene[at]!.height
            ? element
            : newElementWith(element, {}, true),
        ),
        captureUpdate: CaptureUpdateAction.NEVER,
      });
    });
    return () => {
      shown = false;
    };
  }, [api, elements]);

  // Images' files are kept apart from the elements showing them.
  const report = useEffectEvent(({ id, mimeType, dataURL }: BinaryFileData) =>
    onFile({ id, mimeType, dataURL }),
  );
  useEffect(() => {
    if (!api) return;
    const missing = files.filter((file) => !kept.current.has(file.id));
    for (const file of missing) kept.current.add(file.id);
    if (missing.length)
      void Promise.all(missing.map(fileData)).then((loaded) => api.addFiles(loaded));
  }, [api, files]);

  return (
    <Excalidraw
      excalidrawAPI={setApi}
      initialData={initial}
      onChange={(scene, _state, added) => {
        for (const element of scene as unknown as BoardElement[]) {
          if ((known.current.get(element.id) ?? 0) >= element.version) continue;
          known.current.set(element.id, element.version);
          pending.current.set(element.id, element);
        }
        for (const file of Object.values(added)) {
          if (kept.current.has(file.id)) continue;
          kept.current.add(file.id);
          report(file);
        }
        if (pending.current.size && timer.current === undefined)
          timer.current = setTimeout(send, settleMs);
      }}
      theme={theme}
      UIOptions={{
        canvasActions: {
          changeViewBackgroundColor: false,
          export: false,
          loadScene: false,
          saveToActiveFile: false,
          toggleTheme: false,
        },
      }}
    >
      <MainMenu>
        <MainMenu.DefaultItems.ClearCanvas />
        <MainMenu.DefaultItems.SaveAsImage />
      </MainMenu>
    </Excalidraw>
  );
};

// The board as a PNG on white, at most this large on its longer side and
// never enlarged more than twice, as agents see it.
const maxEdge = 1600;
export const renderBoard = async (elements: readonly BoardElement[], files: readonly BoardFile[]) =>
  exportToBlob({
    elements: restored(elements.filter((element) => !element.isDeleted)),
    files: Object.fromEntries(
      (await Promise.all(files.map(fileData))).map((file) => [file.id, file]),
    ),
    appState: {
      exportBackground: true,
      exportWithDarkMode: false,
      viewBackgroundColor: "#ffffff",
    },
    exportPadding: 16,
    mimeType: "image/png",
    getDimensions: (width: number, height: number) => {
      const scale = Math.min(2, maxEdge / Math.max(width, height));
      return { width: width * scale, height: height * scale, scale };
    },
  });
