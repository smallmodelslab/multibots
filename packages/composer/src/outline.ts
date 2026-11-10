export type RoundedBox = { width: number; height: number; radius: number };

type Point = { x: number; y: number };

const clamp = (value: number, low: number, high: number) =>
  Math.min(Math.max(value, low), high);

// Where the outline lies from `point`: the nearest point of the box with its
// corners' radius taken off all round, and the turn from it toward the
// outline, clockwise from straight up. A point inside the box goes out to
// its nearest edge.
const bearing = ({ width, height, radius }: RoundedBox, point: Point) => {
  const r = Math.min(radius, width / 2, height / 2);
  let x = clamp(point.x, r, width - r);
  let y = clamp(point.y, r, height - r);
  let dx = point.x - x;
  let dy = point.y - y;
  if (!dx && !dy) {
    const gaps = [point.y, width - point.x, height - point.y, point.x];
    const side = gaps.indexOf(Math.min(...gaps));
    [dx, dy, x, y] = (
      [
        [0, -1, x, r],
        [1, 0, width - r, y],
        [0, 1, x, height - r],
        [-1, 0, r, y],
      ] as const
    )[side]!;
  }
  const turn = (Math.atan2(dx, -dy) + 2 * Math.PI) % (2 * Math.PI);
  return { r, turn, x, y };
};

// The point on a rounded box's outline nearest `point`, however far off.
export const outlinePoint = (box: RoundedBox, point: Point): Point => {
  const { r, turn, x, y } = bearing(box, point);
  return { x: x + r * Math.sin(turn), y: y - r * Math.cos(turn) };
};

// How far round a rounded box's outline the point nearest `point` is, from
// 0 to 100, measured as SVG draws a `<rect>`: clockwise from where the top
// edge leaves the top-left corner.
export const outlineShare = (box: RoundedBox, point: Point) => {
  const { width, height } = box;
  const { r, turn, x, y } = bearing(box, point);
  const across = width - 2 * r;
  const down = height - 2 * r;
  // Each quarter turn is one side.
  const side = Math.min(3, Math.floor(turn / (Math.PI / 2)));
  const along = [
    x - r,
    across + (y - r),
    across + down + (width - r - x),
    2 * across + down + (height - r - y),
  ][side]!;
  return ((along + r * turn) / (2 * across + 2 * down + 2 * Math.PI * r)) * 100;
};
