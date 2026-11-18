// A computer as agent code uses it in every product (guest.ts), and the
// operations the code's host answers for it (ComputerHost). Each product
// runs the guest in its own interpreter and answers its calls from the
// computers it has: Multiwork's desktops and agent machines
// (multiwork/packages/repl), ProcessControl's machines under test
// (processcontrol-monorepo/apps/runner) and Multidesktop's (multidesktop/m11).
// The machines answer input and accessibility through the same native
// helpers: the Swift helper in macos/, and the Windows and Linux scripts in
// native.ts, which node.ts starts from Node.

export { guest } from "./guest";
export {
  appsText,
  ocrText,
  pasteText,
  policyText,
  regionText,
  screenText,
  scrollText,
  selectionText,
  usageText,
} from "./description";

export type Point = { x: number; y: number };
export type Region = Point & { width: number; height: number };
export type Button = "left" | "right" | "middle";

// An element of an application's accessibility tree, in the order the tree
// is walked: depth says which elements are inside which. Its role is one of
// application, window, dialog, menubar, menu, menuitem, toolbar, button,
// checkbox, radio, switch, textfield, textarea, combobox, slider, tab,
// tablist, list, listitem, table, row, cell, tree, treeitem, link, image,
// text, heading, group, scrollarea, webarea and progress, so one query finds
// a button on any platform, or the platform's own name, lowercased.
export type UiElement = {
  // "<pid>/<path>": the host's way back to the element, valid while the
  // interface keeps its shape.
  ref: string;
  // The ref names the element itself rather than its place, so it lasts
  // while the element does: a macOS window, a UI Automation element.
  stable?: true;
  depth: number;
  role: string;
  name: string;
  value?: string;
  sensitive?: true;
  description?: string;
  enabled?: false;
  focused?: true;
  checked?: boolean;
  // setValue works on it.
  settable?: true;
  // What it can do besides being pressed and focused, for perform().
  actions?: string[];
  // Where a link goes, on platforms whose helper reports it.
  url?: string;
} & Region;

// Text to select in an editable element, told apart from the same text
// elsewhere in it by the text right before and after it; with caret, the
// cursor goes before or after it instead.
export type Selection = {
  text: string;
  prefix: string;
  suffix: string;
  caret?: "before" | "after";
};

// An action on an element, as hosts pass it to their native helper: role
// and name are checked first, so an interface that changed since the
// element was found is not acted on somewhere else. value is setValue's,
// selection select's.
export type ActOptions = {
  role: string;
  name: string;
  value: string | null;
  selection?: Selection;
};
export type ActRequest = { ref: string; action: string } & ActOptions;

// A line of text on the screen, framed in screen pixels.
export type TextLine = { text: string } & Region;
// What scrollCapture read: each line once, in order, how far it scrolled in
// screen pixels, how many scrolls moved it, and the region it scrolled.
export type ScrollCapture = {
  text: string[];
  scrolled: number;
  steps: number;
  reachedEnd: boolean;
  region: Region;
};

export type UiWindow = { title: string } & Region;
export type UiApp = {
  name: string;
  pid: number;
  frontmost: boolean;
  windows: UiWindow[];
};
export type UiTree = {
  app: { name: string; pid: number };
  elements: UiElement[];
  truncated: boolean;
};

// The operations the guest calls by name with JSON arguments. A host answers
// each its computer can do and rejects the rest. Points are pixels of a full
// screenshot.
export type ComputerHost = {
  // The whole screen, or a region of it; the host attaches the image to the
  // run's result and answers at least its width and height.
  screenshot(region: Region | null): Promise<unknown>;
  click(at: Point, button: Button, count: number): Promise<void>;
  move(to: Point): Promise<void>;
  drag(from: Point, to: Point): Promise<void>;
  // Lines; positive dy scrolls down, positive dx right.
  scroll(at: Point, dx: number, dy: number): Promise<void>;
  type(text: string): Promise<void>;
  // Text put in through the clipboard, which is then put back as it was.
  paste(text: string): Promise<void>;
  // Keys pressed together, named as guest.ts names them.
  key(keys: string[]): Promise<void>;
  // A URL, a file path, or an application by name.
  open(target: string): Promise<void>;
  wait(ms: number): Promise<void>;
  apps(): Promise<UiApp[]>;
  // The accessibility tree of an app (by name or pid, else the frontmost):
  // its windows, and its menu bar when asked.
  elements(options: {
    app: string | number | null;
    menus: boolean;
  }): Promise<UiTree>;
  // press, focus, setValue, select or one of the element's actions.
  act(ref: string, action: string, options: ActOptions): Promise<void>;
  // The lines of text on the screen or in a region, top to bottom. Only hosts
  // that read text answer it, and tell agents of it with ocrText.
  text?(region: Region | null): Promise<TextLine[]>;
  // Scrolls the region, or what moves at the point, down to its end or a
  // limit, attaching an image of what it showed, or tiles of it. Only hosts
  // that scroll-capture answer it, and tell agents of it with scrollText.
  scrollCapture?(
    target: { region: Region } | { point: Point },
    options: { maxSteps: number; timeout: number; wait: number; tiles: boolean },
  ): Promise<ScrollCapture>;
  // What the guest last asked to remember for the agent using the
  // computer, or null.
  recall(): Promise<unknown>;
  remember(memory: unknown): Promise<void>;
};

export const isModifier = (key: string) =>
  ["cmd", "ctrl", "alt", "shift", "fn"].includes(key);
