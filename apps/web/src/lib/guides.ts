import type { Point } from "@lpd/shared";

export interface Guide {
  kind: "ortho" | "align";
  from: Point;
  to: Point;
}

export interface GuidedPoint {
  point: Point;
  guides: Guide[];
}

export interface GuideOptions {
  snapGrid: boolean;
  /** Shift held: draw freely. */
  disabled?: boolean;
  /** A segment this close to horizontal or vertical is straightened. */
  angleDeg?: number;
  /** A corner this close to an earlier corner's x or y lines up with it. */
  alignFt?: number;
}

const grid = (n: number) => Math.round(n * 2) / 2;

/**
 * Where the next room corner lands: straightened against the previous corner
 * and lined up with earlier corners, so rectangles come out square.
 */
export function guideRoomPoint(draft: Point[], raw: Point, opts: GuideOptions): GuidedPoint {
  const angle = opts.angleDeg ?? 8;
  const align = opts.alignFt ?? 0.5;
  if (opts.disabled) return { point: raw, guides: [] };

  let x = opts.snapGrid ? grid(raw.x) : raw.x;
  let y = opts.snapGrid ? grid(raw.y) : raw.y;
  const guides: Guide[] = [];
  const last = draft[draft.length - 1];
  let xLocked = false;
  let yLocked = false;

  if (last) {
    const dx = Math.abs(raw.x - last.x);
    const dy = Math.abs(raw.y - last.y);
    const deg = (Math.atan2(Math.min(dx, dy), Math.max(dx, dy)) * 180) / Math.PI;
    if (deg <= angle && (dx > 0 || dy > 0)) {
      if (dx >= dy) {
        y = last.y;
        yLocked = true;
      } else {
        x = last.x;
        xLocked = true;
      }
      guides.push({ kind: "ortho", from: last, to: { x, y } });
    }
  }

  for (const v of draft.slice(0, -1)) {
    if (!xLocked && Math.abs(raw.x - v.x) <= align) {
      x = v.x;
      xLocked = true;
      guides.push({ kind: "align", from: v, to: { x, y } });
    } else if (!yLocked && Math.abs(raw.y - v.y) <= align) {
      y = v.y;
      yLocked = true;
      guides.push({ kind: "align", from: v, to: { x, y } });
    }
  }
  return { point: { x, y }, guides };
}
