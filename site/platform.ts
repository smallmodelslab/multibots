// The visitor's system, from the browser: which download leads, and what
// download clicks are tagged with. Chromium reports it apart from the user
// agent; iPadOS passes for a Mac but has a touch screen.
const agent = navigator.userAgent;
const reported = (navigator as { userAgentData?: { platform?: string } })
  .userAgentData?.platform;
export const platform =
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
          : reported === "Linux" || /Linux|X11/.test(agent)
            ? "linux"
            : "other";
