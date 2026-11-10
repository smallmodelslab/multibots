import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

// Serves Excalidraw's fonts with the app under excalidraw/, where fontsFrom
// points it, in development and in the build. Its Chinese face (12 MB) is
// split by characters, so a board loads only the pieces its text uses. Typed by the
// parts of Vite it uses, so it needs no Vite of its own.
type Server = {
  middlewares: {
    use(
      handle: (request: IncomingMessage, response: ServerResponse, next: () => void) => void,
    ): void;
  };
};
type Bundle = {
  emitFile(file: { type: "asset"; fileName: string; source: Uint8Array }): string;
};

export const excalidrawFonts = () => {
  const fonts = join(
    dirname(createRequire(join(process.cwd(), "package.json")).resolve("@excalidraw/excalidraw")),
    "fonts",
  );
  const files = readdirSync(fonts, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) =>
      join(entry.parentPath, entry.name)
        .slice(fonts.length + 1)
        .replaceAll("\\", "/"),
    );
  return {
    name: "excalidraw-fonts",
    configureServer(server: Server) {
      server.middlewares.use((request, response, next) => {
        const path = decodeURIComponent(request.url?.split("?")[0] ?? "");
        const file = files.find((name) => path.endsWith(`/excalidraw/fonts/${name}`));
        if (!file) return next();
        response.setHeader("Content-Type", "font/woff2");
        response.end(readFileSync(join(fonts, file)));
      });
    },
    generateBundle(this: Bundle) {
      for (const file of files)
        this.emitFile({
          type: "asset",
          fileName: `excalidraw/fonts/${file}`,
          source: readFileSync(join(fonts, file)),
        });
    },
  };
};
