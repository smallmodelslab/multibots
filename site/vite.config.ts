import { defineConfig, type Plugin } from "vite";

// multibots.ca: `bun run site` from multibots/, built into site/dist.

const origin = "https://multibots.ca";

// Every page, by its source: the landing page, then the docs pages with
// their titles in the docs header: the install guide, the pages that each
// answer one question, and the privacy policy.
const pages = [
  { source: "index.html" },
  { source: "docs/index.html", title: "Install" },
  { source: "self-hosted-ai-agent/index.html", title: "Your computers" },
  { source: "chatgpt-subscription/index.html", title: "ChatGPT plan" },
  { source: "local-models/index.html", title: "Your models" },
  { source: "ai-agent-webhooks/index.html", title: "Routines" },
  { source: "grok-bot-alternative/index.html", title: "vs Grok Bot" },
  { source: "privacy/index.html", title: "Privacy" },
].map((page) => ({
  ...page,
  path: `/${page.source.replace(/index\.html$/, "")}`,
}));

// The sitemap search and answer engines' crawlers find in robots.txt.
const sitemap: Plugin = {
  name: "sitemap",
  generateBundle() {
    const urls = pages.map(
      ({ path }) => `  <url><loc>${origin}${path}</loc></url>`,
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

// The docs pages' header: after the brand, every docs page as a text link,
// the current one marked as the contents list marks its section and going
// nowhere, each title stacked on a hidden bold copy that keeps its room
// (md-components/DOCS-PAGE.md in wrkrsh/monorepo).
const header: Plugin = {
  name: "header",
  transformIndexHtml(html, { path }) {
    if (!html.includes('<header class="masthead">')) return;
    const here = path.replace(/index\.html$/, "");
    const links = pages.flatMap(({ path, title }) =>
      title
        ? `<a ${path === here ? 'aria-current="page"' : `href="${path}"`}><span>${title}</span><span aria-hidden="true">${title}</span></a>`
        : [],
    );
    return html.replace(
      "</header>",
      `<nav class="pages" aria-label="Pages">${links.join("")}</nav></header>`,
    );
  },
};

// An answer page's article opens with its question as the heading and its
// answer as the first paragraph, both in plain text and in exactly this
// form, which the build checks; this hands both to search and answer
// engines as JSON-LD, so the markup always says what the page says.
const answer: Plugin = {
  name: "answer",
  transformIndexHtml(html) {
    if (!html.includes("data-answer")) return;
    const page =
      /<article data-answer>\s*<h1>([^<]+)<\/h1>\s*<p>([^<]+)<\/p>/.exec(html);
    if (!page)
      throw new Error(
        "An answer page's article starts <article data-answer><h1>…</h1><p>…</p>, in plain text.",
      );
    const text = (fragment: string) => {
      const plain = fragment.replace(/\s+/g, " ").trim();
      if (!plain || plain.includes("&"))
        throw new Error(`Write "${plain}" as plain text.`);
      return plain;
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
  plugins: [sitemap, header, answer],
  build: {
    emptyOutDir: true,
    rollupOptions: { input: pages.map(({ source }) => source) },
  },
});
