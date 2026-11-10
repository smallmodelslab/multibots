// openbots.ca serves the built page from its assets. The Worker only proxies
// PostHog, reached through the site so blocklists that name PostHog's hosts
// still let visits through.
type Env = { ASSETS: { fetch(request: Request): Promise<Response> } };

const ANALYTICS_PATH = "/antenna";

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith(`${ANALYTICS_PATH}/`))
      return env.ASSETS.fetch(request);
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
  },
};
