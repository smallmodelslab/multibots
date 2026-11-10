// Every product reports to one PostHog project, told apart by `product`
// (docs/analytics.md in wrkrsh/monorepo). Only the production site loads it.
if (location.hostname === "openbots.ca") {
  void import("posthog-js").then(({ default: posthog }) => {
    posthog.init("phc_oFwEfJVgTTkyJDj6xCPSCb2bbSjb7suJYan9AyfJBqpr", {
      api_host: "/antenna",
      ui_host: "https://us.posthog.com",
      defaults: "2026-08-30",
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
    for (const link of document.querySelectorAll<HTMLAnchorElement>(
      "a[data-download]",
    ))
      link.addEventListener("click", () =>
        posthog.capture(
          "desktop download clicked",
          { platform: link.dataset.download },
          { transport: "sendBeacon" },
        ),
      );
  });
}
