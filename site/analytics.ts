// Every product reports to one PostHog project, told apart by `product`
// (docs/analytics.md in wrkrsh/monorepo). Only the production site loads it.
// It keeps nothing in the browser: PostHog tells visitors apart by a hash of
// their address and browser that changes daily, which the project's
// cookieless setting turns on. A download click names the build clicked,
// `os`, and the visitor's own system, `platform` (platform.ts).

type Click = [event: string, properties: Record<string, unknown>];

if (location.hostname === "multibots.ca") {
  // Clicks are heard from the start, and those made before PostHog has
  // loaded are sent once it has.
  const early: Click[] = [];
  let send = (...click: Click) => void early.push(click);
  // A link opened with the middle button fires auxclick, not click.
  const clicked = (event: MouseEvent) => {
    if (event.button > 1) return;
    const link = (event.target as Element).closest("a");
    if (link?.dataset.download)
      send("download clicked", {
        os: link.dataset.download,
        platform: document.documentElement.dataset.platform,
      });
    else if (link?.hostname === "github.com")
      send("github link clicked", { href: link.href });
    else if (link?.getAttribute("href") === "/docs/")
      send("docs link clicked", {});
  };
  document.addEventListener("click", clicked);
  document.addEventListener("auxclick", clicked);
  void import("posthog-js").then(({ default: posthog }) => {
    posthog.init("phc_oFwEfJVgTTkyJDj6xCPSCb2bbSjb7suJYan9AyfJBqpr", {
      api_host: "/antenna",
      ui_host: "https://us.posthog.com",
      defaults: "2026-08-30",
      cookieless_mode: "always",
      mask_all_text: true,
      mask_all_element_attributes: true,
      disable_session_recording: true,
      before_send: (event) => {
        if (event)
          Object.assign(event.properties, {
            product: "multibots",
            surface: "web",
          });
        return event;
      },
    });
    send = (event, properties) =>
      void posthog.capture(event, properties, { transport: "sendBeacon" });
    for (const click of early.splice(0)) send(...click);
  });
}
