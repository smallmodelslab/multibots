// The one update state the main process pushes to every window. Installer and
// JavaScript updates share it; which one installs is the updater's choice.
export type UpdateState =
  | { status: "disabled"; reason: string }
  // Not checked yet this launch.
  | { status: "idle" }
  | { status: "checking" }
  // Checked: nothing newer.
  | { status: "current" }
  | { status: "available"; version: string }
  | { status: "downloading"; version: string; percent: number }
  // `restart` is false when only window code changed: installing reloads the
  // windows and nothing stops.
  | { status: "downloaded"; version: string; restart: boolean }
  // A confirmed restart: the app is shutting down to come back on `version`.
  | { status: "restarting"; version: string }
  | { status: "error"; message: string; download: boolean };
