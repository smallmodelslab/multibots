/// <reference types="chrome" />
import type { BrowserTarget, ScrollCapture } from "../shared/browser";

// What a bot does in one of its tabs, over the debugger Chrome attaches to
// it: the page's accessibility tree with refs, trusted input that leaves
// the user's pointer alone, screenshots, and reading a long page or list
// whole. Scripts of the extension's own run in a world of their own, apart
// from the page's.

type Tab = number;
type Point = { x: number; y: number };
type RemoteObject = { objectId?: string; value?: unknown };

const send = <T>(tab: Tab, method: string, params?: object) =>
  chrome.debugger.sendCommand({ tabId: tab }, method, params) as Promise<T>;

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

// The world each tab's document runs the extension's scripts in, made once
// per document.
const worlds = new Map<Tab, { loader: string; context: number }>();

const world = async (tab: Tab) => {
  const { frameTree } = await send<{
    frameTree: { frame: { id: string; loaderId: string } };
  }>(tab, "Page.getFrameTree");
  const known = worlds.get(tab);
  if (known?.loader === frameTree.frame.loaderId) return known.context;
  const { executionContextId } = await send<{ executionContextId: number }>(
    tab,
    "Page.createIsolatedWorld",
    { frameId: frameTree.frame.id, worldName: "openbots" },
  );
  worlds.set(tab, {
    context: executionContextId,
    loader: frameTree.frame.loaderId,
  });
  return executionContextId;
};

export const forget = (tab: Tab) => worlds.delete(tab);

const failed = (details?: { exception?: { description?: string } }) => {
  if (details)
    throw new Error(
      details.exception?.description ?? "The page's script failed.",
    );
};

const evaluate = async (tab: Tab, expression: string, byValue = true) => {
  const { exceptionDetails, result } = await send<{
    result: RemoteObject;
    exceptionDetails?: { exception?: { description?: string } };
  }>(tab, "Runtime.evaluate", {
    awaitPromise: true,
    contextId: await world(tab),
    expression,
    returnByValue: byValue,
  });
  failed(exceptionDetails);
  return result;
};

// Runs one of the extension's functions with `this` an object of the page.
const callOn = async <T>(
  tab: Tab,
  objectId: string,
  fn: (this: never, ...args: never[]) => unknown,
  args: unknown[] = [],
  byValue = true,
) => {
  const { exceptionDetails, result } = await send<{
    result: RemoteObject;
    exceptionDetails?: { exception?: { description?: string } };
  }>(tab, "Runtime.callFunctionOn", {
    arguments: args.map((value) => ({ value })),
    awaitPromise: true,
    functionDeclaration: fn.toString(),
    objectId,
    returnByValue: byValue,
  });
  failed(exceptionDetails);
  return (byValue ? result.value : result) as T;
};

// ---- Snapshot ----

type AxValue = { value?: unknown };
type AxNode = {
  nodeId: string;
  ignored: boolean;
  role?: AxValue;
  name?: AxValue;
  value?: AxValue;
  properties?: { name: string; value: AxValue }[];
  childIds?: string[];
  backendDOMNodeId?: number;
};

// Roles that only hold others, shown through what they hold.
const holders = new Set([
  "generic",
  "none",
  "presentation",
  "InlineTextBox",
  "LineBreak",
  "RootWebArea",
  "WebArea",
]);
// Fields whose text the outline shows as their value.
const fields = new Set(["combobox", "searchbox", "textbox"]);
// Roles named by their own text, which the outline then shows once.
const namedByText = new Set([
  "button",
  "cell",
  "checkbox",
  "columnheader",
  "gridcell",
  "heading",
  "link",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "radio",
  "rowheader",
  "switch",
  "tab",
  "treeitem",
]);
const states = ["focused", "checked", "selected", "expanded", "disabled"];
const outlineLimit = 60_000;

const clip = (text: string, length: number) =>
  text.length > length ? `${text.slice(0, length)}…` : text;

// A frame's accessibility tree, the root first, with the trees of the
// frames in it under their iframes. A cross-site frame's document runs in
// another process, out of reach here: its iframe stays empty.
const treeOf = async (tab: Tab, frameId?: string): Promise<AxNode[]> => {
  const { nodes } = await send<{ nodes: AxNode[] }>(
    tab,
    "Accessibility.getFullAXTree",
    frameId ? { frameId } : {},
  ).catch(() => ({ nodes: [] as AxNode[] }));
  // Ids of one frame's nodes, apart from another's.
  const prefix = frameId ? `${frameId}:` : "";
  const own = nodes.map((node) => ({
    ...node,
    childIds: node.childIds?.map((id) => prefix + id),
    nodeId: prefix + node.nodeId,
  }));
  const inner = await Promise.all(
    own
      .filter((node) => node.role?.value === "Iframe" && node.backendDOMNodeId)
      .map(async (frame) => {
        const { node } = await send<{ node: { frameId?: string } }>(
          tab,
          "DOM.describeNode",
          { backendNodeId: frame.backendDOMNodeId },
        );
        const nodes = node.frameId ? await treeOf(tab, node.frameId) : [];
        if (nodes[0]) frame.childIds = [nodes[0].nodeId];
        return nodes;
      }),
  );
  return [...own, ...inner.flat()];
};

// The tab's accessibility tree as an outline, one element a line, each with
// the ref actions take: the whole page, or the part under a ref.
export const snapshot = async (tab: Tab, ref?: number) => {
  const nodes = await treeOf(tab);
  const byId = new Map(nodes.map((node) => [node.nodeId, node]));
  const root =
    ref === undefined
      ? nodes[0]
      : nodes.find((node) => node.backendDOMNodeId === ref);
  if (!root) throw new Error(`Nothing on the page has the ref ${ref}.`);
  const lines: string[] = [];
  let length = 0;
  let left = 0;
  const walk = (node: AxNode, depth: number, named: boolean) => {
    const role = String(node.role?.value ?? "");
    const name = String(node.name?.value ?? "")
      .replace(/\s+/g, " ")
      .trim();
    let shown = false;
    if (
      !node.ignored &&
      !holders.has(role) &&
      !(named && role === "StaticText")
    ) {
      if (role !== "StaticText" || name) {
        const value = node.value?.value;
        const flags = (node.properties ?? [])
          .filter(
            (property) =>
              states.includes(property.name) &&
              property.value.value !== false &&
              property.value.value !== "false",
          )
          .map((property) =>
            property.value.value === true || property.value.value === "true"
              ? property.name
              : `${property.name}=${String(property.value.value)}`,
          );
        const line = `${"  ".repeat(depth)}[${node.backendDOMNodeId ?? "-"}] ${role === "StaticText" ? "text" : role}${name ? ` ${JSON.stringify(clip(name, 300))}` : ""}${value !== undefined && value !== "" ? ` = ${JSON.stringify(clip(String(value), 300))}` : ""}${flags.length ? ` (${flags.join(", ")})` : ""}`;
        if (length + line.length < outlineLimit) {
          lines.push(line);
          length += line.length + 1;
        } else left++;
        shown = true;
      }
    }
    const holdsName =
      named ||
      (shown && (fields.has(role) || (Boolean(name) && namedByText.has(role))));
    for (const id of node.childIds ?? []) {
      const child = byId.get(id);
      if (child) walk(child, shown ? depth + 1 : depth, holdsName);
    }
  };
  walk(root, 0, false);
  if (left)
    lines.push(
      `… ${left} more elements. Snapshot a ref to see part of the page, or use scroll_capture to read it whole.`,
    );
  return lines.join("\n") || "(nothing on the page)";
};

// ---- Input ----

const center = async (tab: Tab, target: BrowserTarget): Promise<Point> => {
  if (target.ref !== undefined) {
    await send(tab, "DOM.scrollIntoViewIfNeeded", {
      backendNodeId: target.ref,
    });
    const { quads } = await send<{ quads: number[][] }>(
      tab,
      "DOM.getContentQuads",
      { backendNodeId: target.ref },
    );
    const quad = quads[0];
    if (!quad)
      throw new Error(`The element ${target.ref} has no box on the page.`);
    return {
      x: (quad[0]! + quad[2]! + quad[4]! + quad[6]!) / 4,
      y: (quad[1]! + quad[3]! + quad[5]! + quad[7]!) / 4,
    };
  }
  if (target.x !== undefined && target.y !== undefined)
    return { x: target.x, y: target.y };
  throw new Error("Give a ref from the snapshot, or x and y.");
};

export const click = async (tab: Tab, target: BrowserTarget) => {
  const { x, y } = await center(tab, target);
  await send(tab, "Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  for (const type of ["mousePressed", "mouseReleased"])
    await send(tab, "Input.dispatchMouseEvent", {
      button: "left",
      clickCount: 1,
      type,
      x,
      y,
    });
};

// Keys by name, with the code Chrome's events carry and what they type.
const keys: Record<string, [code: string, keyCode: number, text?: string]> = {
  Backspace: ["Backspace", 8],
  Delete: ["Delete", 46],
  End: ["End", 35],
  Enter: ["Enter", 13, "\r"],
  Escape: ["Escape", 27],
  Home: ["Home", 36],
  PageDown: ["PageDown", 34],
  PageUp: ["PageUp", 33],
  Space: ["Space", 32, " "],
  Tab: ["Tab", 9],
  ArrowDown: ["ArrowDown", 40],
  ArrowLeft: ["ArrowLeft", 37],
  ArrowRight: ["ArrowRight", 39],
  ArrowUp: ["ArrowUp", 38],
};
const modifierBits: Record<string, number> = {
  Alt: 1,
  Control: 2,
  Ctrl: 2,
  Meta: 4,
  Cmd: 4,
  Shift: 8,
};

// A key, or keys held together such as "Shift+Tab" or "Control+A".
export const press = async (tab: Tab, combination: string) => {
  const parts = combination.split("+").map((part) => part.trim());
  const name = parts.pop() ?? "";
  let modifiers = 0;
  for (const part of parts) {
    const bit = modifierBits[part];
    if (!bit) throw new Error(`${part} is not a modifier key.`);
    modifiers |= bit;
  }
  const named = keys[name];
  const single = !named && [...name].length === 1;
  if (!named && !single) throw new Error(`${name} is not a key.`);
  const upper = name.toUpperCase();
  const [code, keyCode, typed] = named ?? [
    /\d/.test(name) ? `Digit${name}` : `Key${upper}`,
    upper.charCodeAt(0),
    name,
  ];
  const text = modifiers & ~8 ? undefined : typed;
  const key = name === "Space" ? " " : name;
  await send(tab, "Input.dispatchKeyEvent", {
    code,
    key,
    modifiers,
    text,
    type: text ? "keyDown" : "rawKeyDown",
    windowsVirtualKeyCode: keyCode,
  });
  await send(tab, "Input.dispatchKeyEvent", {
    code,
    key,
    modifiers,
    type: "keyUp",
    windowsVirtualKeyCode: keyCode,
  });
};

// Text into the element, in place of what it held, or where the focus is.
export const type = async (
  tab: Tab,
  ref: number | undefined,
  text: string,
  submit = false,
) => {
  if (ref !== undefined) {
    await click(tab, { ref });
    await send(tab, "DOM.focus", { backendNodeId: ref });
    await send(tab, "Input.dispatchKeyEvent", {
      code: "KeyA",
      commands: ["selectAll"],
      key: "a",
      type: "rawKeyDown",
      windowsVirtualKeyCode: 65,
    });
    await send(tab, "Input.dispatchKeyEvent", {
      code: "KeyA",
      key: "a",
      type: "keyUp",
      windowsVirtualKeyCode: 65,
    });
  }
  await send(tab, "Input.insertText", { text });
  if (submit) await press(tab, "Enter");
};

// ---- Pictures ----

const dataOf = async (blob: Blob) => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let at = 0; at < bytes.length; at += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return btoa(binary);
};
const bitmapOf = (data: string) =>
  createImageBitmap(
    new Blob([Uint8Array.from(atob(data), (char) => char.charCodeAt(0))], {
      type: "image/png",
    }),
  );

// A region of the page in CSS pixels of the viewport, pictured in CSS
// pixels, so points of it are points to click.
const capture = async (
  tab: Tab,
  region: { left: number; top: number; width: number; height: number },
) => {
  const { cssVisualViewport: view } = await send<{
    cssVisualViewport: { pageX: number; pageY: number };
  }>(tab, "Page.getLayoutMetrics");
  const ratio = Number((await evaluate(tab, "devicePixelRatio")).value) || 1;
  const { data } = await send<{ data: string }>(tab, "Page.captureScreenshot", {
    clip: {
      height: region.height,
      scale: 1 / ratio,
      width: region.width,
      x: region.left + view.pageX,
      y: region.top + view.pageY,
    },
    format: "png",
  });
  return data;
};

export const screenshot = async (tab: Tab) => {
  const size = (
    await evaluate(tab, "({ width: innerWidth, height: innerHeight })")
  ).value as { width: number; height: number };
  return {
    image: await capture(tab, { left: 0, top: 0, ...size }),
    ...size,
  };
};

// ---- Reading a long page or list whole ----

// A line of text: where in the content it is, and in the viewport, and
// whether a sticky or fixed element pins it to the view.
type Line = { text: string; y: number; x: number; pinned: boolean };
type View = {
  // How far the target is scrolled, how tall its view is and how much of
  // that is in the viewport, and how tall all of it is.
  top: number;
  client: number;
  height: number;
  scrollHeight: number;
  // What of it shows in the viewport.
  view: { left: number; top: number; width: number; height: number };
  // Where in the viewport the content's scroll position is, and how much
  // of the view's top pinned elements hide, as a sticky header does.
  origin: number;
  cover: number;
  lines: Line[];
};

// The element a target scrolls: itself, else the largest that scrolls
// inside it, as a dialog's list, else the nearest that scrolls around it,
// else the page.
function scroller(this: Node) {
  const doc = this.ownerDocument ?? (this as Document);
  const scrolls = (element: Element) =>
    element.scrollHeight > element.clientHeight + 1 &&
    /auto|scroll|overlay/.test(getComputedStyle(element).overflowY);
  const target = this.nodeType === 1 ? (this as Element) : this.parentElement;
  if (!target || target === doc.documentElement || target === doc.body)
    return doc.scrollingElement;
  if (scrolls(target)) return target;
  let inside: Element | null = null;
  let area = 0;
  for (const element of target.querySelectorAll("*")) {
    if (!scrolls(element)) continue;
    const { height, width } = element.getBoundingClientRect();
    if (width * height > area) [inside, area] = [element, width * height];
  }
  if (inside) return inside;
  for (
    let element =
      target.parentElement ??
      ((target.getRootNode() as ShadowRoot).host || null);
    element && element !== doc.documentElement && element !== doc.body;
    element =
      element.parentElement ??
      ((element.getRootNode() as ShadowRoot).host || null)
  )
    if (scrolls(element)) return element;
  return doc.scrollingElement;
}

// What the element shows now: the text of each line in its view, where
// in its content and in the viewport each is, and how far it is scrolled.
function look(this: Element): View {
  const doc = this.ownerDocument;
  const win = doc.defaultView!;
  const page = this === doc.scrollingElement;
  const box = this.getBoundingClientRect();
  const origin = page ? 0 : box.top + this.clientTop;
  const leftEdge = page ? 0 : box.left + this.clientLeft;
  const left = Math.max(leftEdge, 0);
  const top = Math.max(origin, 0);
  const right = Math.min(
    leftEdge + (page ? win.innerWidth : this.clientWidth),
    win.innerWidth,
  );
  const bottom = Math.min(
    origin + (page ? win.innerHeight : this.clientHeight),
    win.innerHeight,
  );
  const lines: Line[] = [];
  const range = doc.createRange();
  const walker = doc.createTreeWalker(
    page ? doc.body : this,
    NodeFilter.SHOW_TEXT,
  );
  let last: (Line & { right: number; top: number }) | null = null;
  const pins = new Map<Element, boolean>();
  const pinnedAt = (element: Element | null): boolean => {
    if (!element || element === this || element === doc.body) return false;
    let known = pins.get(element);
    if (known === undefined) {
      known =
        /sticky|fixed/.test(getComputedStyle(element).position) ||
        pinnedAt(element.parentElement);
      pins.set(element, known);
    }
    return known;
  };
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const words = (node as Text).data.replace(/\s+/g, " ").trim();
    const parent = node.parentElement;
    if (
      !words ||
      !parent ||
      parent.closest("script, style, noscript, template")
    )
      continue;
    range.selectNodeContents(node);
    const rect = range.getBoundingClientRect();
    if (
      !rect.height ||
      rect.bottom <= top ||
      rect.top >= bottom ||
      rect.right <= left ||
      rect.left >= right ||
      !parent.checkVisibility({
        opacityProperty: true,
        visibilityProperty: true,
      })
    )
      continue;
    // Pieces of one line in a row of text read as one.
    if (
      last &&
      Math.abs(last.top - rect.top) < 2 &&
      rect.left >= last.right - 1
    ) {
      last.text += (rect.left - last.right > 1 ? " " : "") + words;
      last.right = rect.right;
      continue;
    }
    last = {
      pinned: pinnedAt(parent),
      right: rect.right,
      text: words,
      top: rect.top,
      x: rect.left,
      y: rect.top - origin + (page ? win.scrollY : this.scrollTop),
    };
    lines.push(last);
  }
  let cover = 0;
  for (let y = top; y < bottom; y += 4) {
    const hit = doc.elementFromPoint((left + right) / 2, y + 1);
    if (!hit || !pinnedAt(hit)) break;
    cover = y + 4 - top;
  }
  return {
    client: page ? win.innerHeight : this.clientHeight,
    cover,
    height: bottom - top,
    lines: lines.map(({ pinned, text, x, y }) => ({ pinned, text, x, y })),
    origin,
    scrollHeight: this.scrollHeight,
    top: page ? win.scrollY : this.scrollTop,
    view: { height: bottom - top, left, top, width: right - left },
  };
}

function scrollTo(this: Element, top: number) {
  this.scrollTo({ behavior: "instant", top });
}

function scrollBy(this: Element, pixels: number) {
  this.scrollBy({ behavior: "instant", top: pixels });
}

// How much one image of a capture shows at most, in CSS pixels.
const partHeight = 2000;

// Scrolls the target from its top step by step, to its end or the step
// limit, waiting at each for what loads or is drawn as it scrolls, and
// keeps each line of text the first time it shows: a line is the same
// line again where its text shows at the same place in the content, or
// anywhere when a sticky or fixed element pins it to the view.
// Pictures of each step, with what an earlier one showed cut off, make
// one tall image, cut into parts when that is too tall to read.
export const scrollCapture = async (
  tab: Tab,
  target: BrowserTarget,
  maxSteps: number,
): Promise<ScrollCapture> => {
  const context = await world(tab);
  let objectId: string | undefined;
  if (
    target.ref !== undefined ||
    (target.x !== undefined && target.y !== undefined)
  ) {
    const backendNodeId =
      target.ref ??
      (
        await send<{ backendNodeId: number }>(tab, "DOM.getNodeForLocation", {
          x: Math.round(target.x!),
          y: Math.round(target.y!),
        })
      ).backendNodeId;
    const { object } = await send<{ object: RemoteObject }>(
      tab,
      "DOM.resolveNode",
      {
        backendNodeId,
        executionContextId: context,
      },
    );
    objectId = (
      await callOn<RemoteObject>(tab, object.objectId!, scroller, [], false)
    ).objectId;
  } else
    objectId = (await evaluate(tab, "document.scrollingElement", false))
      .objectId;
  if (!objectId) throw new Error("Nothing on the page scrolls there.");
  const element = objectId;
  const measure = () => callOn<View>(tab, element, look);
  const signature = ({ top, scrollHeight, lines }: View) =>
    `${top}|${scrollHeight}|${lines.map(({ text, y }) => `${text}@${Math.round(y)}`).join("|")}`;
  // Until two looks in a row see the same, or a while has passed.
  const settled = async (waitMs: number) => {
    let before = await measure();
    for (
      let waited = 0, quiet = 0;
      waited < waitMs && quiet < 2;
      waited += 150
    ) {
      await sleep(150);
      const now = await measure();
      quiet = signature(now) === signature(before) ? quiet + 1 : 0;
      before = now;
    }
    return before;
  };
  // Waits for the view to change, then to settle: the view as it was when
  // it does not.
  const changed = async (before: View, waitMs: number) => {
    for (let waited = 0; waited < waitMs; waited += 150) {
      await sleep(150);
      if (signature(await measure()) !== signature(before))
        return settled(3000);
    }
    return before;
  };

  await callOn(tab, element, scrollTo, [0]);
  let view = await settled(3000);
  const start = view.top;
  const seen = new Map<string, number[]>();
  const pinned = new Set<string>();
  const kept: Line[] = [];
  const parts: { data: string; skip: number; height: number }[] = [];
  let covered = -Infinity;
  // Where the step before showed each text it showed once.
  let once = new Map<string, number>();
  const record = async (now: View) => {
    const lines = now.lines.filter((line) => !line.pinned);
    const counts = new Map<string, number>();
    for (const { text } of lines) counts.set(text, (counts.get(text) ?? 0) + 1);
    const unique = lines.filter(({ text }) => counts.get(text) === 1);
    // What loaded above moves what the step before showed: by as far as
    // most of the texts both showed once moved, from the first of them.
    // A list that draws its rows anew keeps a text at its row's place.
    const moves = new Map<number, number[]>();
    for (const line of unique) {
      const was = once.get(line.text);
      const move = was === undefined ? 0 : Math.round(line.y - was);
      if (Math.abs(move) > 3)
        moves.set(move, [...(moves.get(move) ?? []), was!]);
    }
    const [move, movers] = [...moves].reduce<[number, number[]]>(
      (most, each) => (each[1].length > most[1].length ? each : most),
      [0, []],
    );
    if (movers.length >= 2) {
      const from = Math.min(...movers) - 3;
      for (const places of seen.values())
        places.forEach((y, index) => {
          if (y >= from) places[index] = y + move;
        });
      for (const line of kept)
        if (!line.pinned && line.y >= from) line.y += move;
    }
    once = new Map(unique.map(({ text, y }) => [text, y]));
    for (const line of now.lines) {
      if (line.pinned) {
        if (!pinned.has(line.text)) kept.push(line);
        pinned.add(line.text);
        continue;
      }
      const places = seen.get(line.text) ?? [];
      if (places.some((y) => Math.abs(y - line.y) <= 3)) continue;
      seen.set(line.text, [...places, line.y]);
      kept.push(line);
    }
    // What of the content this step pictures, past what earlier ones did.
    const from = now.top + (now.view.top - now.origin);
    const to = from + now.view.height;
    if (to <= covered + 0.5 || !now.view.width || !now.view.height) return;
    // After the first, what pinned elements hide is not the content.
    const skip = parts.length ? Math.max(now.cover, covered - from) : 0;
    covered = to;
    if (skip < now.view.height)
      parts.push({
        data: await capture(tab, now.view),
        height: now.view.height,
        skip,
      });
  };

  await record(view);
  let steps = 1;
  let reachedEnd = false;
  while (steps < maxSteps) {
    const atEnd = view.top + view.client >= view.scrollHeight - 2;
    // What the next view shows below its pinned header overlaps this one.
    const step = Math.max(1, Math.floor((view.height - view.cover) * 0.9));
    const { left, top, width, height } = view.view;
    await send(tab, "Input.dispatchMouseEvent", {
      deltaX: 0,
      deltaY: step,
      type: "mouseWheel",
      x: left + width / 2,
      y: top + height / 2,
    });
    let next: View;
    if (atEnd) {
      // What loads as the end is reached comes within a while, or not at
      // all.
      next = await changed(view, 2500);
      if (next === view) {
        reachedEnd = true;
        break;
      }
    } else {
      next = await settled(3000);
      // The wheel may land on something over the target: then it scrolls
      // itself.
      if (next.top === view.top) {
        await callOn(tab, element, scrollBy, [step]);
        next = await settled(3000);
      }
      if (signature(next) === signature(view)) break;
    }
    await record(next);
    view = next;
    steps++;
  }

  // One tall image, cut into parts when it is too tall to read.
  const bitmaps = await Promise.all(parts.map(({ data }) => bitmapOf(data)));
  const scale = bitmaps[0] ? bitmaps[0].height / parts[0]!.height : 1;
  const width = bitmaps[0]?.width ?? 0;
  const pieces = parts.map((part, index) => ({
    bitmap: bitmaps[index]!,
    from: Math.round(part.skip * scale),
    height: Math.round((part.height - part.skip) * scale),
  }));
  const images: string[] = [];
  let piece = 0;
  let offset = 0;
  while (piece < pieces.length) {
    const room = Math.round(partHeight * scale);
    const canvas = new OffscreenCanvas(width, room);
    const context = canvas.getContext("2d")!;
    let filled = 0;
    while (piece < pieces.length && filled < room) {
      const { bitmap, from, height } = pieces[piece]!;
      const take = Math.min(height - offset, room - filled);
      context.drawImage(
        bitmap,
        0,
        from + offset,
        width,
        take,
        0,
        filled,
        width,
        take,
      );
      filled += take;
      offset += take;
      if (offset >= height) {
        piece++;
        offset = 0;
      }
    }
    const cut = new OffscreenCanvas(width, filled);
    cut.getContext("2d")!.drawImage(canvas, 0, 0);
    images.push(await dataOf(await cut.convertToBlob({ type: "image/png" })));
  }
  for (const bitmap of bitmaps) bitmap.close();

  kept.sort((a, b) => a.y - b.y || a.x - b.x);
  return {
    images,
    reachedEnd,
    scrolled: Math.round(view.top - start),
    steps,
    text: kept.map(({ text }) => text),
    total: Math.round(view.scrollHeight),
  };
};
