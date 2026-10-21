export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface SnapGuide {
  axis: "x" | "y";
  /** Where the guide line sits on its axis. */
  pos: number;
  /** Extent along the other axis. */
  from: number;
  to: number;
}

export interface SnapResult {
  dx: number;
  dy: number;
  guides: SnapGuide[];
}

export interface RectLike {
  x: number;
  y: number;
  width: number;
  depth: number;
  rotation: number;
}

/** Axis aligned box around a possibly rotated rectangle. */
export function boxAround(r: RectLike): Box {
  const rad = (r.rotation * Math.PI) / 180;
  const hw = r.width / 2;
  const hd = r.depth / 2;
  const ex = Math.abs(hw * Math.cos(rad)) + Math.abs(hd * Math.sin(rad));
  const ey = Math.abs(hw * Math.sin(rad)) + Math.abs(hd * Math.cos(rad));
  return { minX: r.x - ex, maxX: r.x + ex, minY: r.y - ey, maxY: r.y + ey };
}

const lines = (min: number, max: number) => [min, (min + max) / 2, max];

interface Best {
  delta: number;
  pos: number;
  other: Box;
}

function bestOnAxis(moving: [number, number], others: Box[], axis: "x" | "y", threshold: number): Best | null {
  let best: Best | null = null;
  for (const other of others) {
    const targets = axis === "x" ? lines(other.minX, other.maxX) : lines(other.minY, other.maxY);
    for (const m of lines(moving[0], moving[1])) {
      for (const t of targets) {
        const delta = t - m;
        if (Math.abs(delta) <= threshold && (!best || Math.abs(delta) < Math.abs(best.delta))) {
          best = { delta, pos: t, other };
        }
      }
    }
  }
  return best;
}

/**
 * How far to nudge a box being dragged so its edges and centre line up with
 * other boxes. Each axis snaps to the closest candidate in reach.
 */
export function snapBox(moving: Box, others: Box[], opts: { thresholdFt: number }): SnapResult {
  const bx = bestOnAxis([moving.minX, moving.maxX], others, "x", opts.thresholdFt);
  const by = bestOnAxis([moving.minY, moving.maxY], others, "y", opts.thresholdFt);
  const dx = bx?.delta ?? 0;
  const dy = by?.delta ?? 0;
  const guides: SnapGuide[] = [];
  if (bx) {
    guides.push({
      axis: "x",
      pos: bx.pos,
      from: Math.min(moving.minY + dy, bx.other.minY),
      to: Math.max(moving.maxY + dy, bx.other.maxY),
    });
  }
  if (by) {
    guides.push({
      axis: "y",
      pos: by.pos,
      from: Math.min(moving.minX + dx, by.other.minX),
      to: Math.max(moving.maxX + dx, by.other.maxX),
    });
  }
  return { dx, dy, guides };
}
