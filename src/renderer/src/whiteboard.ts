import { fontsFrom, renderBoard } from "@wrkrsh/whiteboard/board";
import type { BoardElement, BoardFile } from "@wrkrsh/whiteboard/scene";

// A page that only renders a whiteboard, which a bot's computer opens hidden
// to show the bot its board (`renderBoard` in src/main/index.ts).

declare global {
  interface Window {
    renderWhiteboard: (
      elements: BoardElement[],
      files: BoardFile[],
    ) => Promise<string>;
  }
}

fontsFrom(new URL("excalidraw/", document.baseURI).href);

window.renderWhiteboard = async (elements, files) => {
  const image = new Uint8Array(
    await (await renderBoard(elements, files)).arrayBuffer(),
  );
  let binary = "";
  for (const byte of image) binary += String.fromCharCode(byte);
  return btoa(binary);
};
