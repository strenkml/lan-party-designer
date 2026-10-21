import type { Point } from "./schema";

export const STANDARD_LENGTHS_FT = [3, 6, 10, 14, 25, 50, 100] as const;

const SLACK_FACTOR = 1.2;
export const DROP_FT_PER_END = 3;

export interface PlannedCable {
  estimatedFt: number;
  lengthFt: number;
}

export interface PlanOptions {
  /** Bend points between the two ends, for a cable run around furniture instead of straight across. */
  waypoints?: Point[];
  /** Vertical run at the start: up a wall to an outlet, or from the floor to a table. */
  fromDropFt?: number;
  toDropFt?: number;
}

/** Floor distance along a path, counting each leg across and then along (cables follow edges, not diagonals). */
export function pathLengthFt(points: Point[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.abs(points[i]!.x - points[i - 1]!.x) + Math.abs(points[i]!.y - points[i - 1]!.y);
  }
  return total;
}

export function planCable(from: Point, to: Point, opts: PlanOptions = {}): PlannedCable {
  const path = [from, ...(opts.waypoints ?? []), to];
  const drops = (opts.fromDropFt ?? DROP_FT_PER_END) + (opts.toDropFt ?? DROP_FT_PER_END);
  const estimatedFt = pathLengthFt(path) * SLACK_FACTOR + drops;
  const lengthFt = STANDARD_LENGTHS_FT.find((l) => l >= estimatedFt) ?? Math.ceil(estimatedFt);
  return { estimatedFt, lengthFt };
}

export interface ListedCable extends PlannedCable {
  overrideFt?: number;
}

export interface ShoppingLine {
  lengthFt: number;
  count: number;
}

export function shoppingList(cables: ListedCable[]): ShoppingLine[] {
  const counts = new Map<number, number>();
  for (const cable of cables) {
    const length = cable.overrideFt ?? cable.lengthFt;
    counts.set(length, (counts.get(length) ?? 0) + 1);
  }
  return [...counts]
    .map(([lengthFt, count]) => ({ lengthFt, count }))
    .sort((a, b) => b.lengthFt - a.lengthFt);
}
