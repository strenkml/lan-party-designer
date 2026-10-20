import type { Point } from "./schema";

export const STANDARD_LENGTHS_FT = [3, 6, 10, 14, 25, 50, 100] as const;

const SLACK_FACTOR = 1.2;
const DROP_FT_PER_END = 3;

export interface PlannedCable {
  estimatedFt: number;
  lengthFt: number;
}

export function planCable(from: Point, to: Point): PlannedCable {
  const manhattan = Math.abs(to.x - from.x) + Math.abs(to.y - from.y);
  const estimatedFt = manhattan * SLACK_FACTOR + DROP_FT_PER_END * 2;
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
