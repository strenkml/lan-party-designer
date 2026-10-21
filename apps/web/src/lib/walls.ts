import type { Point } from "@lpd/shared";

export interface WallSnap {
  point: Point;
  /** Degrees. Local +x runs along the wall and local +y points into the room. */
  rotation: number;
  wallIndex: number;
}

export const pointInPolygon = (poly: Point[], p: Point) => {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
};

/** Nearest point on the room outline within reach, or null. */
export function snapToWall(room: Point[], at: Point, opts: { maxDistFt: number }): WallSnap | null {
  if (room.length < 3) return null;
  let best: { dist: number; point: Point; dir: Point; index: number } | null = null;
  for (let i = 0; i < room.length; i++) {
    const a = room[i]!;
    const b = room[(i + 1) % room.length]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) continue;
    const t = Math.min(1, Math.max(0, ((at.x - a.x) * dx + (at.y - a.y) * dy) / len2));
    const point = { x: a.x + t * dx, y: a.y + t * dy };
    const dist = Math.hypot(at.x - point.x, at.y - point.y);
    if (!best || dist < best.dist) {
      const len = Math.sqrt(len2);
      best = { dist, point, dir: { x: dx / len, y: dy / len }, index: i };
    }
  }
  if (!best || best.dist > opts.maxDistFt) return null;

  // Local +y is the wall direction turned a quarter clockwise on screen. Flip when that faces outside.
  const normal = { x: -best.dir.y, y: best.dir.x };
  const probe = { x: best.point.x + normal.x * 0.5, y: best.point.y + normal.y * 0.5 };
  let rotation = (Math.atan2(best.dir.y, best.dir.x) * 180) / Math.PI;
  if (!pointInPolygon(room, probe)) rotation += 180;
  rotation = ((rotation + 180) % 360) - 180;
  if (rotation === -180) rotation = 180;
  const round = (n: number) => Math.round(n * 1e6) / 1e6;
  return { point: { x: round(best.point.x), y: round(best.point.y) }, rotation: round(rotation) === 0 ? 0 : round(rotation), wallIndex: best.index };
}
