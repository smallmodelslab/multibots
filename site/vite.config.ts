import { defineConfig } from "vite";

// multibots.ca: `bun run site` from multibots/, built into site/dist.
export default defineConfig({
  // The app's Tailwind setup (postcss.config.mjs) is not the site's.
  css: { postcss: {} },
  // The landing page, the install guide at /docs/ and the privacy policy
  // at /privacy/.
  build: {
    emptyOutDir: true,
    rollupOptions: {
      input: ["index.html", "docs/index.html", "privacy/index.html"],
    },
  },
});
