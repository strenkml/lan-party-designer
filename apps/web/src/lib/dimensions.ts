import type { Door, Point } from "@lpd/shared";
import { pointInPolygon, snapToWall } from "./walls";

export interface Span {
  kind: "wall" | "door";
  lengthFt: number;
  startFt: number;
  endFt: number;
  /** Centre of the span on the wall line. */
  mid: Point;
}

export interface WallDim {
  index: number;
  a: Point;
  b: Point;
  lengthFt: number;
  /** Unit vector pointing out of the room, for placing labels. */
  outward: Point;
  spans: Span[];
}

const tenth = (n: number) => Math.round(n * 10) / 10;
const clean = (n: number) => Math.round(n * 1e6) / 1e6 + 0;
const MIN_GAP_FT = 0.05;

/** Each wall split into stretches of plain wall and doors, with lengths in feet. */
export function wallDimensions(room: Point[], doors: Pick<Door, "x" | "y" | "width">[]): WallDim[] {
  if (room.length < 3) return [];
  const onWall = new Map<number, { s: number; width: number }[]>();
  for (const d of doors) {
    const snap = snapToWall(room, d, { maxDistFt: 0.5 });
    if (!snap) continue;
    const a = room[snap.wallIndex]!;
    const b = room[(snap.wallIndex + 1) % room.length]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const s = ((d.x - a.x) * (b.x - a.x) + (d.y - a.y) * (b.y - a.y)) / len;
    onWall.set(snap.wallIndex, [...(onWall.get(snap.wallIndex) ?? []), { s, width: d.width }]);
  }

  return room.map((a, index) => {
    const b = room[(index + 1) % room.length]!;
    const lengthRaw = Math.hypot(b.x - a.x, b.y - a.y);
    const dir = { x: (b.x - a.x) / lengthRaw, y: (b.y - a.y) / lengthRaw };
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const inwardFirst = pointInPolygon(room, { x: mid.x - dir.y * 0.5, y: mid.y + dir.x * 0.5 });
    const outward = inwardFirst ? { x: clean(dir.y), y: clean(-dir.x) } : { x: clean(-dir.y), y: clean(dir.x) };

    const at = (ft: number): Point => ({ x: clean(a.x + dir.x * ft), y: clean(a.y + dir.y * ft) });
    const span = (kind: Span["kind"], start: number, end: number): Span => ({
      kind,
      lengthFt: tenth(end - start),
      startFt: start,
      endFt: end,
      mid: at((start + end) / 2),
    });

    const spans: Span[] = [];
    let cursor = 0;
    for (const door of (onWall.get(index) ?? []).sort((p, q) => p.s - q.s)) {
      const start = Math.max(cursor, door.s - door.width / 2);
      const end = Math.min(lengthRaw, door.s + door.width / 2);
      if (start - cursor > MIN_GAP_FT) spans.push(span("wall", cursor, start));
      spans.push(span("door", start, end));
      cursor = end;
    }
    if (lengthRaw - cursor > MIN_GAP_FT) spans.push(span("wall", cursor, lengthRaw));
    return { index, a, b, lengthFt: tenth(lengthRaw), outward, spans };
  });
}
