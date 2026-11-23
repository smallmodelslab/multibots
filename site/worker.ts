// multibots.ca serves the built pages from its assets. The Worker proxies
// PostHog, reached through the site so blocklists that name PostHog's hosts
// still let visits through, and answers "/" with llms.txt for clients that
// ask for Markdown, as answer engines' agents do.
type Env = { ASSETS: { fetch(request: Request): Promise<Response> } };

const ANALYTICS_PATH = "/antenna";

// Whether the client names Markdown itself, acceptably and at least as
// highly as HTML. Wildcards alone, as browsers and curl send, keep the page.
function prefersMarkdown(accept: string | null) {
  const ranges = (accept ?? "").split(",").map((range) => {
    const [type = "", ...parameters] = range.toLowerCase().split(";");
    const q = parameters.find((parameter) => parameter.trim().startsWith("q="));
    return { type: type.trim(), q: q ? Number(q.trim().slice(2)) : 1 };
  });
  const quality = (...types: string[]) =>
    types
      .map((type) => ranges.find((range) => range.type === type)?.q)
      .find((q) => q !== undefined) ?? 0;
  const markdown = quality("text/markdown");
  return markdown > 0 && markdown >= quality("text/html", "text/*", "*/*");
}

// "/" differs by Accept, so caches keep its page and its Markdown apart.
async function home(request: Request, env: Env) {
  if (!prefersMarkdown(request.headers.get("Accept"))) {
    const page = await env.ASSETS.fetch(request);
    const response = new Response(page.body, page);
    response.headers.append("Vary", "Accept");
    return response;
  }
  const text = await env.ASSETS.fetch(
    new Request(new URL("/llms.txt", request.url), { method: request.method }),
  );
  return new Response(text.body, {
    status: text.status,
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      Vary: "Accept",
    },
  });
}

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);
    if (
      !url.pathname.startsWith(`${ANALYTICS_PATH}/`) &&
      url.hostname !== "multibots.ca"
    ) {
      url.hostname = "multibots.ca";
      return Response.redirect(url.toString(), 308);
    }
    if (url.pathname === "/") return home(request, env);
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
