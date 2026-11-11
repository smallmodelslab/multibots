// Every product reports to one PostHog project, told apart by `product`
// (docs/analytics.md in wrkrsh/monorepo). Only the production site loads it.
// It keeps nothing in the browser: PostHog tells visitors apart by a hash of
// their address and browser that changes daily, which the project's
// cookieless setting turns on.
if (location.hostname === "openbots.ca") {
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
            product: "openbots",
            surface: "web",
          });
        return event;
      },
    });
    // A link opened with the middle button fires auxclick, not click.
    const clicked = (event: MouseEvent) => {
      if (event.button > 1) return;
      const link = (event.target as Element).closest("a");
      const options = { transport: "sendBeacon" } as const;
      if (link?.dataset.download)
        posthog.capture(
          "desktop download clicked",
          { platform: link.dataset.download },
          options,
        );
      else if (link?.hostname === "github.com")
        posthog.capture("github link clicked", { href: link.href }, options);
    };
    document.addEventListener("click", clicked);
    document.addEventListener("auxclick", clicked);
  });
}
