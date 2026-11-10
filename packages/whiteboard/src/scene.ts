// A whiteboard is Excalidraw's elements, kept as Excalidraw writes them, so
// what a person draws comes back exactly. People and agents change it
// element by element; whoever changed an element last wins it, as in
// Excalidraw's own collaboration. Agents read it as text with an image and
// change it with the edit below, which makes whole Excalidraw elements
// without Excalidraw or any other package, so any server can apply it.

// An image's file, kept apart from the image elements showing it, at a URL
// (or a data URL) the board's app can fetch.
export type BoardFile = { id: string; mimeType: string; url: string };

// The files a board's images use, removed ones included while they can be
// brought back.
export const filesUsed = (elements: readonly BoardElement[]) =>
  new Set(
    elements.flatMap((element) =>
      element.type === "image" && typeof element.fileId === "string" ? [element.fileId] : [],
    ),
  );

export type BoardElement = {
  id: string;
  type: string;
  version: number;
  versionNonce: number;
  isDeleted: boolean;
  index: string | null;
  updated: number;
  x: number;
  y: number;
  width: number;
  height: number;
  [key: string]: unknown;
};

const newer = (a: BoardElement, b: BoardElement) =>
  a.version > b.version || (a.version === b.version && a.versionNonce < b.versionNonce);

// Removed elements are kept a day, long enough for every open board to hear
// of it, then forgotten.
const keepRemovedMs = 24 * 60 * 60_000;

// Back to front, as Excalidraw orders them by their fractional index.
const inOrder = (elements: BoardElement[]) =>
  elements.sort((a, b) =>
    a.index === b.index ? 0 : a.index === null ? 1 : b.index === null || a.index < b.index ? -1 : 1,
  );

// A removed element is kept only as what Excalidraw needs to know it is
// gone, so removing frees the board's room at once.
const slim = (element: BoardElement): BoardElement =>
  element.isDeleted
    ? {
        ...element,
        // Excalidraw drops a line with fewer than two points, removal and all.
        ...(Array.isArray(element.points)
          ? { points: [element.points[0], element.points.at(-1)] }
          : {}),
        ...(Array.isArray(element.pressures) ? { pressures: [] } : {}),
        ...(typeof element.text === "string" ? { text: "", originalText: "" } : {}),
      }
    : element;

export const mergeElements = (
  stored: readonly BoardElement[],
  incoming: readonly BoardElement[],
  now = Date.now(),
) => {
  const byId = new Map(stored.map((element) => [element.id, element]));
  for (const element of incoming) {
    const kept = byId.get(element.id);
    if (!kept || newer(element, kept)) byId.set(element.id, slim(element));
  }
  return inOrder(
    [...byId.values()].filter(
      (element) => !element.isDeleted || now - element.updated < keepRemovedMs,
    ),
  );
};

const shapes = ["rectangle", "ellipse", "diamond"] as const;
const linear = ["arrow", "line"] as const;
const defaultStroke = "#1e1e1e";
const fontSize = 20;
const lineHeight = 1.25;
// Excalifont, Excalidraw's hand-drawn face.
const fontFamily = 5;

const containerOf = (element: BoardElement) =>
  element.type === "text" && typeof element.containerId === "string" ? element.containerId : null;

// A line's or stroke's points on the board: relative to its first point,
// then turned by its angle about their middle, as Excalidraw turns a
// straight line (a curved one turns about its curve's middle, near this).
const boardPoints = (element: BoardElement): [number, number][] => {
  const points = (element.points as [number, number][]).map(
    ([x, y]) => [element.x + x, element.y + y] as [number, number],
  );
  const angle = (element.angle as number | undefined) ?? 0;
  if (!angle) return points;
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const [cos, sin] = [Math.cos(angle), Math.sin(angle)];
  return points.map(([x, y]) => [
    cx + (x - cx) * cos - (y - cy) * sin,
    cy + (x - cx) * sin + (y - cy) * cos,
  ]);
};

const pointsOf = (element: BoardElement) =>
  boardPoints(element).map(([x, y]) => [Math.round(x), Math.round(y)] as const);

// Where the drawn elements lie, which the board's image shows with a small
// margin around it.
// Where an element lies. A line's or stroke's x and y are its first point,
// which its other points are relative to, not its top left.
const extent = (element: BoardElement) => {
  if (!Array.isArray(element.points))
    return {
      left: element.x,
      top: element.y,
      right: element.x + element.width,
      bottom: element.y + element.height,
    };
  const points = boardPoints(element);
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  return {
    left: Math.min(...xs),
    top: Math.min(...ys),
    right: Math.max(...xs),
    bottom: Math.max(...ys),
  };
};

export const boardBounds = (elements: readonly BoardElement[]) => {
  const shown = elements.filter((element) => !element.isDeleted).map(extent);
  if (!shown.length) return null;
  const left = Math.min(...shown.map((at) => at.left));
  const top = Math.min(...shown.map((at) => at.top));
  const right = Math.max(...shown.map((at) => at.right));
  const bottom = Math.max(...shown.map((at) => at.bottom));
  return {
    x: Math.round(left),
    y: Math.round(top),
    width: Math.round(right - left),
    height: Math.round(bottom - top),
  };
};

// The board as an agent reads it: one element a line, back to front, a
// shape's label with it rather than apart.
export const describeBoard = (elements: readonly BoardElement[]) => {
  const shown = elements.filter((element) => !element.isDeleted);
  if (!shown.length) return "The whiteboard is empty.";
  const labels = new Map(
    shown.flatMap((element) => {
      const container = containerOf(element);
      return container ? [[container, element.text as string]] : [];
    }),
  );
  const lines = shown
    .filter((element) => !containerOf(element))
    .map((element) => {
      const at = extent(element);
      const where =
        element.type === "freedraw" || !Array.isArray(element.points)
          ? {
              x: Math.round(at.left),
              y: Math.round(at.top),
              width: Math.round(at.right - at.left),
              height: Math.round(at.bottom - at.top),
            }
          : { points: pointsOf(element) };
      return JSON.stringify({
        id: element.id,
        type: element.type,
        ...where,
        ...(element.type === "text" ? { text: element.text, fontSize: element.fontSize } : {}),
        ...(labels.has(element.id) ? { text: labels.get(element.id) } : {}),
        ...(element.strokeColor !== defaultStroke ? { strokeColor: element.strokeColor } : {}),
        ...(element.backgroundColor !== "transparent"
          ? { backgroundColor: element.backgroundColor }
          : {}),
      });
    });
  const bounds = boardBounds(shown)!;
  return [
    `The whiteboard's elements, back to front, in board coordinates (x to the right, y down). A freehand stroke is listed by where it lies; the image shows its shape. The image covers x ${bounds.x} to ${bounds.x + bounds.width} and y ${bounds.y} to ${bounds.y + bounds.height}, with a small margin.`,
    ...lines,
  ].join("\n");
};

const colour = {
  type: "string",
  maxLength: 32,
  description:
    'A CSS colour such as "#1e1e1e" (black), "#e03131" (red), "#2f9e44" (green), "#1971c2" (blue), "#f08c00" (orange), or "transparent".',
};
const label = (description: string) => ({
  type: "string",
  minLength: 1,
  maxLength: 2000,
  description,
});
const number = { type: "number" };
const size = { type: "number", exclusiveMinimum: 0 };
const points = (maxItems: number, description: string) => ({
  type: "array",
  items: { type: "array", items: number, minItems: 2, maxItems: 2 },
  minItems: 2,
  maxItems,
  description: `${description}, as [x, y] in board coordinates.`,
});
const object = (properties: Record<string, object>, required: string[] = []) => ({
  type: "object" as const,
  properties,
  required,
  additionalProperties: false,
});

type Style = { strokeColor?: string };
type Shape = (typeof shapes)[number];
type Linear = (typeof linear)[number];
export type WhiteboardEdit = {
  add?: (
    | (Style & {
        type: Shape;
        x: number;
        y: number;
        width: number;
        height: number;
        text?: string;
        backgroundColor?: string;
      })
    | (Style & { type: "text"; x: number; y: number; text: string; fontSize?: number })
    | (Style & { type: Linear; points: [number, number][]; text?: string })
    | (Style & { type: "freedraw"; points: [number, number][] })
  )[];
  change?: (Style & {
    id: string;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    text?: string;
    backgroundColor?: string;
  })[];
  remove?: string[];
};

// The edit as JSON Schema, for each app's own validator and tools.
export const whiteboardEditSchema = object({
  add: {
    type: "array",
    maxItems: 200,
    description: "Elements to draw, in front of what is there.",
    items: {
      anyOf: [
        object(
          {
            type: { type: "string", enum: shapes },
            x: number,
            y: number,
            width: size,
            height: size,
            text: label("A label inside it."),
            strokeColor: colour,
            backgroundColor: colour,
          },
          ["type", "x", "y", "width", "height"],
        ),
        object(
          {
            type: { type: "string", const: "text" },
            x: number,
            y: number,
            text: label("The text, from its top left."),
            fontSize: { type: "number", minimum: 8, maximum: 200 },
            strokeColor: colour,
          },
          ["type", "x", "y", "text"],
        ),
        object(
          {
            type: { type: "string", enum: linear },
            points: points(100, "Its points in order"),
            text: label("A label on it."),
            strokeColor: colour,
          },
          ["type", "points"],
        ),
        object(
          {
            type: { type: "string", const: "freedraw" },
            points: points(2000, "The stroke's points in order"),
            strokeColor: colour,
          },
          ["type", "points"],
        ),
      ],
    },
  },
  change: {
    type: "array",
    maxItems: 200,
    description:
      "Elements to move, resize, recolour or reword, by id. x and y move a line or stroke whole; only shapes resize.",
    items: object(
      {
        id: { type: "string" },
        x: number,
        y: number,
        width: size,
        height: size,
        text: label("A text's text, or a shape's or line's label."),
        strokeColor: colour,
        backgroundColor: colour,
      },
      ["id"],
    ),
  },
  remove: {
    type: "array",
    maxItems: 500,
    items: { type: "string" },
    description: "Ids of elements to remove.",
  },
});

export const toolDescriptions = {
  view: "Look at the whiteboard you share with the user, where you both draw: an image of it and its elements with their ids and board coordinates. Look before you change it; the user may have drawn on it since.",
  edit: "Draw on the whiteboard you share with the user: add shapes, text, arrows, lines and freehand strokes, and move, recolour, reword or remove elements by their id from viewing it. Coordinates are board pixels, x to the right and y down; text is about 20 px tall and 11 px wide a character. Keep clear of what is there unless you mean to mark it, and draw only what was asked. Returns the board as it now is.",
};

const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const randomId = () =>
  Array.from({ length: 20 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
const randomInt = () => Math.floor(Math.random() * 2 ** 31);

// The next fractional index after a key, as the fractional-indexing package
// Excalidraw orders by makes it (generateKeyBetween(key, null)): the key's
// integer part plus one, its first character saying how long that part is.
const indexAfter = (key: string | null) => {
  if (key === null) return "a0";
  const head = key[0]!;
  const length = head >= "a" ? head.charCodeAt(0) - 95 : 92 - head.charCodeAt(0);
  const digits = key.slice(1, length).split("");
  for (let i = digits.length - 1; i >= 0; i--) {
    const next = alphabet.indexOf(digits[i]!) + 1;
    if (next < alphabet.length) {
      digits[i] = alphabet[next]!;
      return head + digits.join("");
    }
    digits[i] = "0";
  }
  if (head === "Z") return "a0";
  if (head === "z") throw new Error("The whiteboard has too many elements.");
  const larger = String.fromCharCode(head.charCodeAt(0) + 1);
  if (larger > "a") digits.push("0");
  else digits.pop();
  return larger + digits.join("");
};

const measure = (text: string, size: number) => {
  const lines = text.split("\n");
  return {
    width: Math.max(...lines.map((line) => line.length)) * size * 0.55,
    height: lines.length * size * lineHeight,
  };
};

// The agent's edit as Excalidraw elements: those it made or changed, to
// merge into the board, and the ids of those it added.
export const applyEdit = (
  elements: readonly BoardElement[],
  edit: WhiteboardEdit,
  now = Date.now(),
) => {
  const board = new Map(elements.map((element) => [element.id, element]));
  const touched = new Set<string>();
  const put = (element: BoardElement) => {
    board.set(element.id, element);
    touched.add(element.id);
  };
  const bump = (element: BoardElement, patch: Partial<BoardElement>) =>
    put({
      ...element,
      ...patch,
      version: element.version + 1,
      versionNonce: randomInt(),
      updated: now,
    });
  let last = elements.findLast((element) => element.index !== null)?.index ?? null;
  const make = (
    type: string,
    at: { x: number; y: number; width: number; height: number },
    style: { strokeColor?: string | undefined; backgroundColor?: string | undefined },
    extra: Record<string, unknown> = {},
  ): BoardElement => {
    last = indexAfter(last);
    return {
      id: randomId(),
      type,
      ...at,
      angle: 0,
      strokeColor: style.strokeColor ?? defaultStroke,
      backgroundColor: style.backgroundColor ?? "transparent",
      fillStyle: "solid",
      strokeWidth: 2,
      strokeStyle: "solid",
      roughness: 1,
      opacity: 100,
      groupIds: [],
      frameId: null,
      index: last,
      roundness: type === "rectangle" ? { type: 3 } : type === "diamond" ? { type: 2 } : null,
      seed: randomInt(),
      version: 1,
      versionNonce: randomInt(),
      isDeleted: false,
      boundElements: null,
      updated: now,
      link: null,
      locked: false,
      ...extra,
    };
  };
  const textFields = (text: string, size: number) => ({
    text,
    originalText: text,
    fontSize: size,
    fontFamily,
    lineHeight,
    autoResize: true,
  });
  // A label sits in the middle of a shape, or of a line's first segment.
  const middleOf = (element: BoardElement) => {
    if (!Array.isArray(element.points))
      return {
        x: element.x + element.width / 2,
        y: element.y + element.height / 2,
      };
    const [[x0, y0], [x1, y1]] = element.points as [[number, number], [number, number]];
    return { x: element.x + (x0 + x1) / 2, y: element.y + (y0 + y1) / 2 };
  };
  const boundTo = (element: BoardElement) =>
    (element.boundElements ?? []) as { id: string; type: string }[];
  const labelOf = (element: BoardElement) => {
    const text = boundTo(element).find((item) => item.type === "text");
    const found = text && board.get(text.id);
    return found && !found.isDeleted ? found : null;
  };
  const centred = (container: BoardElement, text: string) => {
    const size = measure(text, fontSize);
    const middle = middleOf(container);
    return {
      x: middle.x - size.width / 2,
      y: middle.y - size.height / 2,
      ...size,
    };
  };
  const setLabel = (container: BoardElement, text: string) => {
    const existing = labelOf(container);
    if (existing)
      return bump(existing, {
        ...centred(container, text),
        ...textFields(text, existing.fontSize as number),
      });
    const made = make(
      "text",
      centred(container, text),
      { strokeColor: container.strokeColor as string },
      {
        ...textFields(text, fontSize),
        textAlign: "center",
        verticalAlign: "middle",
        containerId: container.id,
      },
    );
    put(made);
    bump(board.get(container.id)!, {
      boundElements: [
        ...((container.boundElements ?? []) as unknown[]),
        { id: made.id, type: "text" },
      ],
    });
  };

  // An arrow attached to a shape that moved or resized keeps its ends on
  // it, each where it was relative to the shape.
  type Place = (x: number, y: number) => [number, number];
  const follow = (arrow: BoardElement | undefined, shape: string, place: Place) => {
    if (!arrow || arrow.isDeleted || !Array.isArray(arrow.points)) return;
    const ends = (binding: unknown) =>
      (binding as { elementId?: string } | null)?.elementId === shape;
    const start = ends(arrow.startBinding);
    const end = ends(arrow.endBinding);
    if (!start && !end) return;
    // A turned curved arrow turns about the middle of its drawn curve, which
    // Excalidraw jitters by hand; it lets go of the shape instead.
    if (arrow.angle && arrow.roundness) {
      bump(arrow, {
        ...(start ? { startBinding: null } : {}),
        ...(end ? { endBinding: null } : {}),
      });
      return;
    }
    const last = arrow.points.length - 1;
    const route = boardPoints(arrow).map(([x, y], at) =>
      (start && end) || (start && at === 0) || (end && at === last)
        ? place(x, y)
        : ([x, y] as [number, number]),
    );
    // An elbow arrow's route no longer holds with one end moved; it goes
    // straight instead.
    const bent = Boolean(arrow.elbowed) && !(start && end);
    const [x0, y0] = route[0]!;
    const points = (bent ? [route[0]!, route[last]!] : route).map(
      ([x, y]) => [x - x0, y - y0] as const,
    );
    const xs = points.map(([x]) => x);
    const ys = points.map(([, y]) => y);
    bump(arrow, {
      x: x0,
      y: y0,
      points,
      // Its points are on the board now, unturned.
      angle: 0,
      ...(bent ? { elbowed: false, fixedSegments: null } : {}),
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys),
    });
    const moved = board.get(arrow.id)!;
    const label = labelOf(moved);
    if (label) bump(label, centred(moved, label.text as string));
  };

  for (const id of edit.remove ?? []) {
    const element = board.get(id);
    if (!element || element.isDeleted)
      throw new Error(`There is no element ${id} on the whiteboard.`);
    const label = labelOf(element);
    if (label) bump(label, { isDeleted: true });
    bump(element, { isDeleted: true });
  }

  for (const change of edit.change ?? []) {
    const element = board.get(change.id);
    if (!element || element.isDeleted || containerOf(element))
      throw new Error(`There is no element ${change.id} on the whiteboard.`);
    if (
      (change.width !== undefined || change.height !== undefined) &&
      !(shapes as readonly string[]).includes(element.type)
    )
      throw new Error(
        `Only shapes resize, and ${change.id} is a ${element.type}. Remove it and draw it again instead.`,
      );
    if (change.backgroundColor !== undefined && element.type === "text")
      throw new Error(`Text has no background; ${change.id} is text.`);
    const { id: _id, text, ...patch } = change;
    const label = labelOf(element);
    if (element.type === "text" && text !== undefined)
      Object.assign(
        patch,
        textFields(text, element.fontSize as number),
        measure(text, element.fontSize as number),
      );
    // A line moved on its own leaves the shapes it was attached to.
    if (Array.isArray(element.points) && (change.x !== undefined || change.y !== undefined))
      Object.assign(patch, { startBinding: null, endBinding: null });
    bump(element, patch);
    const moved = board.get(element.id)!;
    if (element.type !== "text" && text !== undefined) setLabel(moved, text);
    else if (label)
      bump(label, {
        ...centred(moved, label.text as string),
        ...(change.strokeColor ? { strokeColor: change.strokeColor } : {}),
      });
    // A point keeps its place in the shape: taken into the shape's own
    // unturned frame about its middle, scaled with it, and turned back about
    // its new middle, as Excalidraw turns shapes.
    const angle = (element.angle as number | undefined) ?? 0;
    const [cos, sin] = [Math.cos(angle), Math.sin(angle)];
    const scale = (to: number, from: number) => (from ? to / from : 1);
    const place: Place = (x, y) => {
      const dx = x - (element.x + element.width / 2);
      const dy = y - (element.y + element.height / 2);
      const u = (dx * cos + dy * sin) * scale(moved.width, element.width);
      const v = (-dx * sin + dy * cos) * scale(moved.height, element.height);
      return [
        moved.x + moved.width / 2 + u * cos - v * sin,
        moved.y + moved.height / 2 + u * sin + v * cos,
      ];
    };
    if (["x", "y", "width", "height"].some((key) => moved[key] !== element[key]))
      for (const { id, type } of boundTo(element))
        if (type === "arrow") follow(board.get(id), element.id, place);
  }

  const added: string[] = [];
  for (const shape of edit.add ?? []) {
    let made: BoardElement;
    if (shape.type === "text") {
      const size = shape.fontSize ?? fontSize;
      made = make(
        "text",
        { x: shape.x, y: shape.y, ...measure(shape.text, size) },
        { strokeColor: shape.strokeColor },
        {
          ...textFields(shape.text, size),
          textAlign: "left",
          verticalAlign: "top",
          containerId: null,
        },
      );
    } else if ("width" in shape) {
      const { x, y, width, height } = shape;
      made = make(shape.type, { x, y, width, height }, shape);
    } else {
      const [x0, y0] = shape.points[0]!;
      const points = shape.points.map(([x, y]) => [x - x0, y - y0] as const);
      const xs = points.map(([x]) => x);
      const ys = points.map(([, y]) => y);
      made = make(
        shape.type,
        {
          x: x0,
          y: y0,
          width: Math.max(...xs) - Math.min(...xs),
          height: Math.max(...ys) - Math.min(...ys),
        },
        { strokeColor: shape.strokeColor },
        shape.type === "freedraw"
          ? { points, pressures: [], simulatePressure: true, lastCommittedPoint: null }
          : {
              points,
              lastCommittedPoint: null,
              startBinding: null,
              endBinding: null,
              startArrowhead: null,
              endArrowhead: shape.type === "arrow" ? "arrow" : null,
              elbowed: false,
            },
      );
    }
    put(made);
    added.push(made.id);
    if ("text" in shape && shape.text && shape.type !== "text") setLabel(made, shape.text);
  }

  return {
    added,
    changed: [...touched].map((id) => board.get(id)!),
  };
};
