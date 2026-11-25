// The visitor's system, from the browser: which download leads, and what
// download clicks are tagged with.
const agent = navigator.userAgent;
export const platform = /Android|iPhone|iPad|iPod/.test(agent)
  ? "mobile"
  : /Windows/.test(agent)
    ? "windows"
    : /Mac/.test(agent)
      ? "mac"
      : /Linux|X11/.test(agent)
        ? "linux"
        : "other";
