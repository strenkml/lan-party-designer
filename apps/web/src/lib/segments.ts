import type { Point } from "@lpd/shared";

const distToSegment = (p: Point, a: Point, b: Point) => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
};

/** Index of the leg of a path (leg i runs from points[i] to points[i + 1]) closest to a point. */
export function nearestSegment(points: Point[], at: Point): number {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < points.length - 1; i++) {
    const d = distToSegment(at, points[i]!, points[i + 1]!);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}
