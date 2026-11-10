import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";

import { excalidrawFonts } from "./packages/whiteboard/src/vite";

const entry = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  main: {
    build: {
      rolldownOptions: { input: { index: entry("src/main/index.ts") } },
    },
  },
  preload: {
    build: {
      rolldownOptions: {
        input: { index: entry("src/preload/index.ts") },
        output: { entryFileNames: "[name].cjs", format: "cjs" },
      },
    },
  },
  renderer: {
    build: {
      rolldownOptions: {
        // The window, and the page a bot's computer renders its whiteboard
        // in (`renderBoard` in src/main/index.ts).
        input: {
          index: entry("src/renderer/index.html"),
          whiteboard: entry("src/renderer/whiteboard.html"),
        },
      },
    },
    resolve: {
      alias: { "@": entry("src") },
      dedupe: ["react", "react-dom", "@excalidraw/excalidraw"],
    },
    // Excalidraw's CommonJS dependencies need bundling in development too.
    optimizeDeps: { include: ["@excalidraw/excalidraw"] },
    plugins: [react(), excalidrawFonts()],
  },
});
