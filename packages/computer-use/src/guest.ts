// The functions agent code uses a computer with, the same in Multiwork,
// ProcessControl and Multidesktop: each product runs this in its own
// QuickJS as `(guest)(call)`, where call(name, ...args) asks the host for
// one of the operations in index.ts and resolves to its JSON answer. It
// returns `api`, the functions the code gets; `finish`, which the host
// awaits after each run of agent code for the text the run ends with; and
// `ordered`, which puts a host's own functions in line with the API's.
//
// Elements of an application's accessibility tree get small integer ids
// that last while the element does, so code can act on what an outline
// showed. The host keeps what the code has seen between runs (recall and
// remember): a run that acted on an application the code looked at ends
// with what changed in its tree since.
//
// multidesktop/m11 includes this file as text, so the guest is the raw
// string between the backticks: it never contains a backtick or a dollar
// sign before a brace.
export const guest = String.raw`(call) => {
  // After input, how long the screen gets to change before it is looked at.
  const settleMs = 300;
  // How many applications keep their elements' ids: those looked at last,
  // as hosts store what the code saw after every call that acts.
  const appsKept = 8;
  let actedAt = 0;
  // Whether input went in since the code last looked at an outline.
  let acted = false;
  // { next, current, apps: [{ pid, name, elements, truncated, seen }] }, seen
  // being the outline the code last saw: { lines: { id: [text, parent id] },
  // order, focus, menus }.
  let memory;

  const number = (value, what) => {
    if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(what + " must be a number.");
    return Math.round(value);
  };

  const recall = async () => (memory ??= (await call("recall")) ?? { next: 1, current: null, apps: [] });
  const remember = () => call("remember", memory);

  const look = async () => {
    const left = actedAt + settleMs - Date.now();
    if (left > 0) await call("wait", left);
  };
  const input = async (name, ...args) => {
    await call(name, ...args);
    actedAt = Date.now();
    acted = true;
  };

  // Key names as hosts receive them: the modifiers cmd, ctrl, alt, shift and
  // fn, named keys (enter, tab, space, backspace, delete, escape, home, end,
  // pageup, pagedown, left, right, up, down, f1 to f12), and single
  // characters, lowercased.
  const keyNames = new Map(Object.entries({
    alt: "alt", cmd: "cmd", command: "cmd", control: "ctrl", ctrl: "ctrl", fn: "fn", meta: "cmd", opt: "alt",
    option: "alt", shift: "shift", super: "cmd", win: "cmd", windows: "cmd", arrowdown: "down", arrowleft: "left",
    arrowright: "right", arrowup: "up", del: "delete", esc: "escape", pgdn: "pagedown", pgup: "pageup",
    return: "enter", " ": "space",
  }));
  const keyName = (key) => {
    const lower = key.length === 1 ? key.toLowerCase() : key.trim().toLowerCase();
    return keyNames.get(lower) ?? lower;
  };

  // ---- Elements ----

  const pidOf = (element) => Number(element.ref.split("/")[0]);
  const appOf = (pid) => memory.apps.find((app) => app.pid === pid);

  // Each element's children by index, -1 holding the roots, from the depth
  // the walk gives every element.
  const childrenOf = (elements) => {
    const children = new Map([[-1, []]]);
    const stack = [];
    elements.forEach((element, index) => {
      while (stack.length && elements[stack.at(-1)].depth >= element.depth) stack.pop();
      const parent = stack.length ? stack.at(-1) : -1;
      if (!children.has(parent)) children.set(parent, []);
      children.get(parent).push(index);
      stack.push(index);
    });
    return children;
  };

  // Each element's subtree as a number, from what an outline shows of it
  // and of its children.
  const signatures = (elements, children) => {
    const signs = [];
    for (let index = elements.length - 1; index >= 0; index--) {
      const { role, name, value } = elements[index];
      let text = role + "\u0000" + name + "\u0000" + (value ?? "");
      for (const child of children.get(index) ?? []) text += "\u0000" + signs[child];
      let hash = 2166136261;
      for (let at = 0; at < text.length; at++) hash = Math.imul(hash ^ text.charCodeAt(at), 16777619);
      signs[index] = hash >>> 0;
    }
    return signs;
  };

  // A fresh tree's elements take the ids their counterparts had, under a
  // parent that kept its id. Elements with stable refs pair by ref alone.
  // Other siblings whose whole subtrees look the same pair in order; the
  // rest pair only where one old and one new sibling alone share a role and
  // name, or then a role, so an id never passes to another control by
  // guesswork.
  const identify = (fresh, known) => {
    const before = childrenOf(known);
    const after = childrenOf(fresh);
    const signs = [signatures(known, before), signatures(fresh, after)];
    // Siblings by key, leaving out those without one.
    const group = (indices, elements, signs, key) => {
      const groups = new Map();
      for (const index of indices) {
        const name = key(elements[index], signs[index]);
        if (name !== undefined) groups.set(name, [...(groups.get(name) ?? []), index]);
      }
      return groups;
    };
    const pairs = [[-1, -1]];
    while (pairs.length) {
      const [old, now] = pairs.pop();
      let olds = before.get(old) ?? [];
      let news = after.get(now) ?? [];
      for (const [key, inOrder] of [
        [(element) => (element.stable ? element.role + "\u0000" + element.ref : undefined), false],
        [(element, sign) => element.role + "\u0000" + element.name + "\u0000" + sign, true],
        [(element) => element.role + "\u0000" + element.name, false],
        [(element) => element.role, false],
      ]) {
        const waiting = group(olds, known, signs[0], key);
        const paired = new Set();
        for (const [name, arriving] of group(news, fresh, signs[1], key)) {
          const matching = waiting.get(name) ?? [];
          if (!inOrder && (matching.length !== 1 || arriving.length !== 1)) continue;
          arriving.slice(0, matching.length).forEach((index, at) => {
            fresh[index].id = known[matching[at]].id;
            pairs.push([matching[at], index]);
            paired.add(matching[at]).add(-1 - index);
          });
        }
        olds = olds.filter((index) => !paired.has(index) && !known[index].stable);
        news = news.filter((index) => !paired.has(-1 - index) && !fresh[index].stable);
      }
    }
    for (const element of fresh) element.id ??= memory.next++;
  };

  // The menu bars in a tree, each with the id of the element holding it.
  const menuBars = (elements) => {
    const bars = [];
    for (let start = 0; start < elements.length; start++) {
      if (elements[start].role !== "menubar") continue;
      let end = start + 1;
      while (end < elements.length && elements[end].depth > elements[start].depth) end++;
      const holder = elements.slice(0, start).findLast((element) => element.depth < elements[start].depth);
      bars.push({ holder: holder?.id, elements: elements.slice(start, end) });
      start = end - 1;
    }
    return bars;
  };

  const fetchTree = async ({ app, menus }) => {
    await look();
    const tree = await call("elements", { app: app ?? null, menus: Boolean(menus) });
    await recall();
    const known = appOf(tree.app.pid) ?? { pid: tree.app.pid, elements: [], seen: null };
    identify(tree.elements, known.elements);
    // Menus a tree leaves out keep their elements and ids, kept out of
    // outlines and finds, at the end of what held them.
    let elements = tree.elements;
    if (!elements.some((element) => element.role === "menubar"))
      for (const bar of menuBars(known.elements)) {
        const at = bar.holder === undefined ? -1 : elements.findIndex((element) => element.id === bar.holder);
        if (bar.holder !== undefined && at < 0) continue;
        let end = at < 0 ? elements.length : at + 1;
        while (at >= 0 && end < elements.length && elements[end].depth > elements[at].depth) end++;
        elements = [...elements.slice(0, end), ...bar.elements.map((element) => ({ ...element, kept: true })), ...elements.slice(end)];
      }
    Object.assign(known, { name: tree.app.name, elements, truncated: tree.truncated });
    memory.apps = [known, ...memory.apps.filter((other) => other !== known)].slice(0, appsKept);
    memory.current = known.pid;
    return known;
  };

  const byId = async (id) => {
    await recall();
    for (const app of memory.apps) {
      const element = app.elements.find((element) => element.id === id);
      if (element) return element;
    }
    throw new Error("No element " + id + " is known; ui() shows the elements there are and their ids.");
  };
  const elementOf = async (target) => {
    if (typeof target === "number") return await byId(target);
    if (target && typeof target === "object" && typeof target.ref === "string") return target;
    throw new TypeError("Pass an element or its id.");
  };

  const matches = (pattern, text) =>
    pattern instanceof RegExp ? pattern.test(text ?? "") : (text ?? "").toLowerCase().includes(String(pattern).toLowerCase());
  const select = (query) => {
    if (typeof query === "function") return query;
    const { app, menus, within, ...wanted } = query ?? {};
    return (element) => Object.entries(wanted).every(([key, pattern]) => {
      if (pattern === undefined) return true;
      if (key === "role") return [pattern].flat().some((role) => String(role).toLowerCase() === element.role);
      if (key === "name" || key === "value" || key === "description") return matches(pattern, element[key]);
      if (key === "enabled") return (element.enabled ?? true) === pattern;
      if (key === "focused" || key === "settable") return (element[key] ?? false) === pattern;
      return element[key] === pattern;
    });
  };
  const where = async (query, options) => {
    const from = query && typeof query === "object" && !(query instanceof RegExp) ? query : {};
    let app = options?.app ?? from.app;
    const within = options?.within ?? from.within;
    if (app === undefined && within !== undefined) app = pidOf(await elementOf(within));
    return { app, menus: options?.menus ?? from.menus, within };
  };

  const find = async (query, options) => {
    const place = await where(query, options);
    const known = await fetchTree(place);
    await remember();
    let elements = known.elements;
    if (place.within !== undefined) {
      const id = typeof place.within === "number" ? place.within : place.within.id;
      const start = elements.findIndex((element) => element.id === id);
      if (start < 0) throw new Error("No element " + id + " is in " + known.name + " now.");
      let end = start + 1;
      while (end < elements.length && elements[end].depth > elements[start].depth) end++;
      elements = elements.slice(start + 1, end);
    }
    const wanted = select(query);
    return elements.filter((element) => !element.kept && wanted(element)).map(({ kept, ...element }) => element);
  };

  const element = async (query, options) => {
    if (typeof query === "number") {
      const { kept, ...found } = await byId(query);
      return found;
    }
    if (typeof query === "string") {
      // A ref names its app first; its element may be in the menu bar.
      const pid = Number(query.split("/")[0]);
      const [found] = await find((element) => element.ref === query, { app: Number.isInteger(pid) ? pid : undefined, menus: true });
      if (!found) throw new Error("No element " + query + " is on the screen now; find it again.");
      return found;
    }
    // An app just opened may not answer yet; it gets until the timeout too.
    const until = Date.now() + (options?.timeout ?? 3000);
    for (;;) {
      let failure;
      try {
        const [found] = await find(query, options);
        if (found) return found;
      } catch (error) {
        failure = error;
      }
      if (Date.now() >= until) {
        if (failure) throw failure;
        throw new Error("No element matches " + (typeof query === "function" ? "that function" : JSON.stringify(query)) + "; ui() shows what there is.");
      }
      await call("wait", 250);
    }
  };

  const act = async (target, action, value) => {
    const element = await elementOf(target);
    await recall();
    memory.current = pidOf(element);
    await input("act", element.ref, action, { role: element.role, name: element.name, value: value ?? null });
  };

  // ---- Outlines ----

  // Unnamed containers that only lay others out.
  const quiet = new Set(["group", "scrollarea", "splitgroup", "layoutarea", "unknown", "generic", "panel", "filler", "pane", "custom"]);
  const quote = (text, limit = 120) => JSON.stringify(text.length > limit ? text.slice(0, limit - 1) + "…" : text);
  const line = (element) => {
    let text = element.id + " " + element.role;
    if (element.name) text += " " + quote(element.name);
    if (element.value && element.value !== element.name) text += " = " + quote(element.value);
    if (element.description && element.description !== element.name) text += " (" + element.description.slice(0, 80) + ")";
    if (element.checked !== undefined) text += element.checked ? " checked" : " unchecked";
    if (element.enabled === false) text += " disabled";
    if (element.settable) text += " settable";
    if (element.actions?.length) text += " actions: " + element.actions.join(", ");
    return text;
  };

  // The lines of an app's tree, each indented by what holds it: containers
  // that only lay others out, and text repeating its row's name, are left
  // out, and runs of text side by side read as one line.
  const outline = (known) => {
    const entries = [];
    const stack = [];
    let focus = null;
    for (const element of known.elements) {
      if (element.kept) continue;
      while (stack.length && stack.at(-1).depth >= element.depth) stack.pop();
      const parent = stack.findLast((item) => item.entry)?.entry;
      if (element.focused) focus = element;
      const plain = !element.value && !element.settable && !element.actions?.length;
      const text = element.role === "text" && plain;
      let entry = null;
      if (
        !(quiet.has(element.role) && !element.name && plain) &&
        !(text && !element.name) &&
        !((text || element.role === "cell") && plain && parent && element.name === parent.element.name)
      ) {
        const last = entries.at(-1);
        if (text && last?.texts && last.parent === parent && !stack.some((item) => item.entry === last)) {
          last.texts.push(element.name);
          entry = last;
        } else {
          entry = { id: element.id, depth: parent ? parent.depth + 1 : 0, parent, element, texts: text ? [element.name] : null };
          entries.push(entry);
        }
      }
      stack.push({ depth: element.depth, entry });
    }
    const lines = {};
    for (const entry of entries) {
      entry.text = entry.texts?.length > 1 ? entry.id + " text " + quote(entry.texts.join(" "), 400) : line(entry.element);
      lines[entry.id] = [entry.text, entry.parent?.id ?? null];
    }
    return { entries, seen: { lines, order: entries.map((entry) => entry.id), focus: focus && line(focus) } };
  };

  const ranges = (ids) => {
    const parts = [];
    for (let start = 0; start < ids.length; ) {
      let end = start;
      while (end + 1 < ids.length && ids[end + 1] === ids[end] + 1) end++;
      parts.push(end > start ? ids[start] + "-" + ids[end] : String(ids[start]));
      start = end + 1;
    }
    return parts.join(", ");
  };

  const header = (known) => "app " + quote(known.name) + " pid " + known.pid;
  const more = (known) => known.truncated ? ["… more elements than shown; ask for one app, or use find()"] : [];

  const ui = async (options) => {
    const place = await where(options, options);
    const known = await fetchTree(place);
    acted = false;
    const view = outline(known);
    known.seen = { ...view.seen, menus: Boolean(place.menus) };
    await remember();
    return [
      header(known),
      ...view.entries.map((entry) => "  " + "  ".repeat(entry.depth) + entry.text),
      ...(view.seen.focus ? ["focused: " + view.seen.focus] : []),
      ...more(known),
    ].join("\n");
  };

  // What changed in the outline the code last saw of the app it last used:
  // + for what is new, ~ for what changed or moved, with what holds them;
  // the ids of what is gone.
  const finish = async () => {
    if (!acted) return undefined;
    acted = false;
    await recall();
    const before = appOf(memory.current);
    if (!before?.seen) return undefined;
    const { seen } = before;
    let known;
    try {
      known = await fetchTree({ app: before.pid, menus: seen.menus });
    } catch (error) {
      memory.current = null;
      await remember();
      return header(before) + ": " + error.message;
    }
    const view = outline(known);
    known.seen = { ...view.seen, menus: seen.menus };
    await remember();
    const marks = new Map();
    for (const entry of view.entries) {
      const was = seen.lines[entry.id];
      if (!was) marks.set(entry, "+");
      else if (was[0] !== entry.text || was[1] !== (entry.parent?.id ?? null)) marks.set(entry, "~");
    }
    // What stayed but changed places among what stayed.
    const stayed = (order, lines) => order.filter((id) => lines[id]);
    const then = stayed(seen.order, view.seen.lines);
    const entries = new Map(view.entries.map((entry) => [entry.id, entry]));
    stayed(view.seen.order, seen.lines).forEach((id, at) => {
      if (then[at] !== id && !marks.has(entries.get(id))) marks.set(entries.get(id), "~");
    });
    const shown = new Set();
    for (const entry of marks.keys())
      for (let item = entry; item && !shown.has(item); item = item.parent) shown.add(item);
    const removed = Object.keys(seen.lines).map(Number).filter((id) => !view.seen.lines[id]).sort((a, b) => a - b);
    const lines = [
      ...view.entries.filter((entry) => shown.has(entry)).map((entry) => (marks.get(entry) ?? " ") + " " + "  ".repeat(entry.depth) + entry.text),
      ...(removed.length ? ["removed: " + ranges(removed)] : []),
      ...(view.seen.focus !== seen.focus ? ["focused: " + (view.seen.focus ?? "nothing")] : []),
    ];
    if (!lines.length) return header(known) + ": no change since you last looked.";
    return [header(known) + ", changed since you last looked:", ...lines, ...more(known)].join("\n");
  };

  // ---- Points ----

  const pointOf = async (target, what) => {
    if (typeof target === "number" || typeof target?.ref === "string") {
      const element = await elementOf(target);
      await recall();
      memory.current = pidOf(element);
      if (!(element.width > 0 && element.height > 0))
        throw new Error("The " + element.role + " " + JSON.stringify(element.name) + " has no place on the screen; press() it instead.");
      return { x: Math.round(element.x + element.width / 2), y: Math.round(element.y + element.height / 2) };
    }
    if (target && typeof target === "object") {
      const x = number(target.x, what + "'s x");
      const y = number(target.y, what + "'s y");
      if (typeof target.width === "number" && typeof target.height === "number")
        return { x: Math.round(x + target.width / 2), y: Math.round(y + target.height / 2) };
      return { x, y };
    }
    throw new TypeError(what + " takes an element, its id or a point {x, y}.");
  };
  // Coordinates are one point, never two numbers, which would read as an id.
  const one = (args, what) => {
    if (typeof args[1] === "number")
      throw new TypeError(what + " takes one target, an element, its id or a point: " + what + "({x: 120, y: 340}).");
  };

  // ---- The API ----

  const click = async (...args) => {
    one(args, "click");
    const [target, options] = args;
    const button = options?.button ?? "left";
    if (!["left", "right", "middle"].includes(button)) throw new TypeError("button is left, right or middle.");
    const count = options?.count ?? 1;
    if (![1, 2, 3].includes(count)) throw new TypeError("count is 1, 2 or 3.");
    await input("click", await pointOf(target, "click"), button, count);
  };
  const doubleClick = async (...args) => {
    one(args, "doubleClick");
    await click(args[0], { ...args[1], count: 2 });
  };
  const move = async (...args) => {
    one(args, "move");
    await input("move", await pointOf(args[0], "move"));
  };
  const drag = async (...args) => {
    if (args.length !== 2) throw new TypeError("drag takes two targets: drag({x: 100, y: 200}, {x: 300, y: 200}).");
    await input("drag", await pointOf(args[0], "drag"), await pointOf(args[1], "drag"));
  };
  const scroll = async (target, lines) => {
    if (!lines || typeof lines !== "object")
      throw new TypeError("scroll takes a target and lines: scroll({x: 400, y: 300}, {dy: 5}); positive dy is down, dx right.");
    await input("scroll", await pointOf(target, "scroll"), number(lines.dx ?? 0, "dx"), number(lines.dy ?? 0, "dy"));
  };
  const key = async (keys) => {
    const names = (Array.isArray(keys) ? keys.map(String) : String(keys).split(/\+(?!$)/))
      .map((name) => (name.length === 1 ? name : name.trim()))
      .filter(Boolean)
      .map(keyName);
    if (!names.length) throw new TypeError("key takes keys: key('enter'), key('cmd+shift+t').");
    await input("key", names);
  };
  const screenshot = async (region) => {
    await look();
    if (region === undefined || region === null) return await call("screenshot", null);
    const area = typeof region === "number" || typeof region?.ref === "string" ? await elementOf(region) : region;
    return await call("screenshot", {
      x: number(area.x, "x"), y: number(area.y, "y"), width: number(area.width, "width"), height: number(area.height, "height"),
    });
  };

  // Operations run one after another in the order the code starts them,
  // awaited or not, and the run's finish after them all. The code gets a
  // promise of its own, so one it leaves unhandled still fails the run.
  let last = Promise.resolve();
  const ordered = (operation) => (...args) => {
    const run = last.then(() => operation(...args));
    last = run.then(() => undefined, () => undefined);
    return new Promise((resolve, reject) => run.then(resolve, reject));
  };
  const api = {
    screenshot,
    click,
    doubleClick,
    move,
    drag,
    scroll,
    type: async (text) => await input("type", String(text)),
    key,
    open: async (target) => await input("open", String(target)),
    wait: async (ms) => await call("wait", number(ms, "wait")),
    apps: async () => {
      await look();
      return await call("apps");
    },
    ui,
    find,
    element,
    press: (target) => act(target, "press"),
    focus: (target) => act(target, "focus"),
    setValue: (target, value) => act(target, "setValue", String(value)),
    perform: (target, action) => act(target, String(action)),
  };
  return {
    api: Object.freeze(Object.fromEntries(Object.entries(api).map(([name, operation]) => [name, ordered(operation)]))),
    finish: ordered(finish),
    ordered,
  };
}`;
