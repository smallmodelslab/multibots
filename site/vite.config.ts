import { defineConfig, type Plugin } from "vite";

// multibots.ca: `bun run site` from multibots/, built into site/dist.

const origin = "https://multibots.ca";

// Every page: the landing page, the install guide, the pages that each
// answer one question, and the privacy policy.
const pages = [
  "index.html",
  "docs/index.html",
  "self-hosted-ai-agent/index.html",
  "chatgpt-subscription/index.html",
  "local-models/index.html",
  "grok-bot-alternative/index.html",
  "privacy/index.html",
];

// The sitemap search and answer engines' crawlers find in robots.txt.
const sitemap: Plugin = {
  name: "sitemap",
  generateBundle() {
    const urls = pages.map(
      (page) =>
        `  <url><loc>${origin}/${page.replace(/index\.html$/, "")}</loc></url>`,
    );
    this.emitFile({
      type: "asset",
      fileName: "sitemap.xml",
      source: `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join("\n")}
</urlset>
`,
    });
  },
};

// An answer page's heading asks its question and its first paragraph
// answers it; this hands both to search and answer engines as JSON-LD, so
// the markup always says what the page says.
const answer: Plugin = {
  name: "answer",
  transformIndexHtml(html) {
    const page =
      /<article data-answer>\s*<h1>(.*?)<\/h1>\s*<p>(.*?)<\/p>/s.exec(html);
    if (!page) return;
    const text = (fragment: string) => {
      const plain = fragment
        .replace(/<[^>]+>/g, "")
        .replace(/\s+/g, " ")
        .trim();
      if (/&(?!amp;)/.test(plain))
        throw new Error(`Spell out the entity in "${plain}".`);
      return plain.replaceAll("&amp;", "&");
    };
    const data = {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: {
        "@type": "Question",
        name: text(page[1]!),
        acceptedAnswer: { "@type": "Answer", text: text(page[2]!) },
      },
    };
    return [
      {
        tag: "script",
        attrs: { type: "application/ld+json" },
        children: JSON.stringify(data).replaceAll("<", "\\u003c"),
        injectTo: "head",
      },
    ];
  },
};

export default defineConfig({
  // The app's Tailwind setup (postcss.config.mjs) is not the site's.
  css: { postcss: {} },
  plugins: [sitemap, answer],
  build: {
    emptyOutDir: true,
    rollupOptions: { input: pages },
  },
});
