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
  regionText,
  screenText,
  scrollText,
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
} & Region;

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
  // press, focus, setValue or one of the element's actions. role and name
  // are checked first, so an interface that changed since the element was
  // found is not acted on somewhere else.
  act(
    ref: string,
    action: string,
    options: { role: string; name: string; value: string | null },
  ): Promise<void>;
  // What the guest last asked to remember for the agent using the
  // computer, or null.
  recall(): Promise<unknown>;
  remember(memory: unknown): Promise<void>;
};

export const isModifier = (key: string) =>
  ["cmd", "ctrl", "alt", "shift", "fn"].includes(key);
