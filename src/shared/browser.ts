// What Multibots and its Chrome extension say to each other, through the
// native messaging host Chrome starts for the extension (src/main/browser.ts).
// Multibots asks only for what a bot does in its own tabs; the extension
// carries each out with code of its own, and never runs code it was sent.

export const browserHost = "com.wrkrsh.openbots";
// Chrome shows it as the extension's version. An extension Chrome loaded
// before Multibots updated its folder reloads from it when this differs.
// 2: the extension asks the user before it connects.
export const browserProtocol = 3;

// A tab of a bot's: Chrome's id for it, and what it shows.
export type BrowserTab = { tab: number; url: string; title: string };

// A long page or list, scrolled through from its top and read whole: its
// text, each line once in the order it appears, the pixels scrolled
// through of how tall it is, how many steps it took, whether it got to
// the end, and what it showed as one tall image, in parts when too tall
// to read as one, the overlap between steps left out.
export type ScrollCapture = {
  text: string[];
  scrolled: number;
  total: number;
  steps: number;
  reachedEnd: boolean;
  images: string[];
};

// Where an action happens: an element by its ref in the tab's snapshot, or
// a point of the tab's screenshot in CSS pixels.
export type BrowserTarget = { ref?: number; x?: number; y?: number };

export type BrowserCommand = { bot: string } & (
  | { action: "tabs" }
  | { action: "open"; name: string; url: string }
  | { action: "navigate"; tab: number; url: string }
  | { action: "back"; tab: number }
  | { action: "close"; tab: number }
  | { action: "snapshot"; tab: number; ref?: number }
  | ({ action: "click"; tab: number } & BrowserTarget)
  | {
      action: "type";
      tab: number;
      ref?: number;
      text: string;
      submit?: boolean;
    }
  | { action: "press"; tab: number; key: string }
  | { action: "screenshot"; tab: number }
  | ({
      action: "scroll_capture";
      tab: number;
      maxSteps?: number;
    } & BrowserTarget)
);

export type BrowserResults = {
  tabs: BrowserTab[];
  open: BrowserTab;
  navigate: BrowserTab;
  back: BrowserTab;
  close: null;
  snapshot: BrowserTab & { outline: string };
  click: BrowserTab;
  type: BrowserTab;
  press: BrowserTab;
  screenshot: BrowserTab & { image: string; width: number; height: number };
  scroll_capture: BrowserTab & ScrollCapture;
};

// On the line between them: requests carry an id their reply repeats.
export type BrowserRequest = BrowserCommand & { id: number };
export type BrowserReply = { id: number; result?: unknown; error?: string };
// What Multibots tells the extension when it connects: go ahead, reload
// from the folder Multibots updated, or why it can't.
export type BrowserWelcome =
  | { ready: true }
  | { reload: true }
  | { error: string };
