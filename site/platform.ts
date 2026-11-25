// The visitor's system, from the browser, as <html data-platform>: which
// download leads and what download clicks are tagged with. vite.config.ts
// inlines this into every page's head, so it is known before the page shows;
// it uses nothing outside itself. Chromium reports the system apart from the
// user agent; iPadOS passes for a Mac but has a touch screen.
export function markPlatform() {
  const agent = navigator.userAgent;
  const reported = (navigator as { userAgentData?: { platform?: string } })
    .userAgentData?.platform;
  document.documentElement.dataset.platform =
    reported === "Android" ||
    /Android|iPhone|iPad|iPod/.test(agent) ||
    (/Macintosh/.test(agent) && navigator.maxTouchPoints > 1)
      ? "mobile"
      : reported === "Chrome OS" || /CrOS/.test(agent)
        ? "chromeos"
        : reported === "Windows" || /Windows/.test(agent)
          ? "windows"
          : reported === "macOS" || /Mac/.test(agent)
            ? "mac"
            : reported === "Linux" || /Linux/.test(agent)
              ? "linux"
              : "other";
}
