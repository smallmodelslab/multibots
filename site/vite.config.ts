import { defineConfig } from "vite";

// openbots.ca: `bun run site` from openbots/, built into site/dist.
export default defineConfig({
  // The app's Tailwind setup (postcss.config.mjs) is not the site's.
  css: { postcss: {} },
  // The landing page, and the install guide at /docs/.
  build: {
    emptyOutDir: true,
    rollupOptions: { input: ["index.html", "docs/index.html"] },
  },
});
