// openbots.ca serves the built page from its assets. The Worker only answers
// the two paths that need it: downloads, which redirect to the current
// release's installer, and PostHog, reached through the site so blocklists
// that name PostHog's hosts still let visits through.
type Env = { ASSETS: { fetch(request: Request): Promise<Response> } };
type Catalog = { assets: { name: string; url: string }[] };

const CATALOG = "https://downloads.wrkrsh.com/openbots/channels/stable.json";
const INSTALLERS: Record<string, RegExp> = {
  mac: /-mac-arm64\.dmg$/,
  linux: /-linux-x86_64\.AppImage$/,
};
const ANALYTICS_PATH = "/antenna";

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);
    const installer = url.pathname.match(/^\/download\/(\w+)$/)?.[1];
    if (installer && INSTALLERS[installer]) {
      const response = await fetch(CATALOG, {
        cf: { cacheTtl: 60 },
      } as RequestInit);
      const catalog = response.ok ? ((await response.json()) as Catalog) : null;
      const asset = catalog?.assets.find((asset) =>
        INSTALLERS[installer]!.test(asset.name),
      );
      return asset
        ? Response.redirect(asset.url, 302)
        : new Response("The download is unavailable right now.", {
            status: 503,
          });
    }
    if (url.pathname.startsWith(`${ANALYTICS_PATH}/`)) {
      const path = url.pathname.slice(ANALYTICS_PATH.length) + url.search;
      const origin =
        path.startsWith("/static/") || path.startsWith("/array/")
          ? "https://us-assets.i.posthog.com"
          : "https://us.i.posthog.com";
      const forwarded = new Request(origin + path, request);
      forwarded.headers.delete("Cookie");
      // PostHog locates the visitor from this address rather than the Worker's.
      forwarded.headers.set(
        "X-Forwarded-For",
        request.headers.get("CF-Connecting-IP") ?? "",
      );
      return fetch(forwarded);
    }
    return env.ASSETS.fetch(request);
  },
};
