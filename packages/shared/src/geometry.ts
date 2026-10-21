import type { EventDoc, Point, VenueDoc } from "./schema";

export interface RectShape {
  x: number;
  y: number;
  width: number;
  depth: number;
  rotation: number;
}

/** Corners of a rectangle turned about its centre: top left, top right, bottom right, bottom left. */
export function rectCorners(r: RectShape): Point[] {
  const rad = (r.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const hw = r.width / 2;
  const hd = r.depth / 2;
  return [
    [-hw, -hd],
    [hw, -hd],
    [hw, hd],
    [-hw, hd],
  ].map(([lx, ly]) => ({ x: r.x + lx! * cos - ly! * sin, y: r.y + lx! * sin + ly! * cos }));
}

const EPS = 1e-9;

function project(poly: Point[], axis: Point): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const p of poly) {
    const d = p.x * axis.x + p.y * axis.y;
    if (d < min) min = d;
    if (d > max) max = d;
  }
  return [min, max];
}

/** Separating axis test for convex polygons. Shapes that only touch do not overlap. */
export function polygonsOverlap(a: Point[], b: Point[]): boolean {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i]!;
      const q = poly[(i + 1) % poly.length]!;
      const axis = { x: -(q.y - p.y), y: q.x - p.x };
      const [aMin, aMax] = project(a, axis);
      const [bMin, bMax] = project(b, axis);
      if (aMax <= bMin + EPS || bMax <= aMin + EPS) return false;
    }
  }
  return true;
}

const SEAT_FT = 1.4;
const STRIP_SIZE = { width: 2.4, depth: 0.8 };
const DEVICE_SIZE = { width: 3.2, depth: 1.1 };

export function tablePolygon(t: EventDoc["tables"][number]): Point[] {
  if (t.shape === "round") {
    return Array.from({ length: 16 }, (_, i) => {
      const a = (i / 16) * Math.PI * 2;
      return { x: t.x + Math.cos(a) * (t.width / 2), y: t.y + Math.sin(a) * (t.width / 2) };
    });
  }
  return rectCorners(t);
}

export interface LayoutWarning {
  level: "warn";
  code: "walkway";
  message: string;
  refId: string;
}

/** Furniture and equipment standing in a walkway zone. */
export function layoutWarnings(_venue: VenueDoc, event: EventDoc): LayoutWarning[] {
  const out: LayoutWarning[] = [];
  const walkways = event.zones.filter((z) => z.kind === "walkway");
  if (walkways.length === 0) return out;

  const seatsOf = (tableId: string) => event.seats.filter((s) => s.tableId === tableId);
  const seatPoly = (s: { x: number; y: number; rotation: number }) =>
    rectCorners({ x: s.x, y: s.y, width: SEAT_FT, depth: SEAT_FT, rotation: s.rotation });
  const zoneName = (z: { label: string; id: string }) => z.label || "a walkway";

  const check = (id: string, name: string, polys: Point[][]) => {
    for (const z of walkways) {
      const zone = rectCorners(z);
      if (polys.some((p) => polygonsOverlap(p, zone))) {
        out.push({ level: "warn", code: "walkway", message: `${name} is in the way of ${zoneName(z)}`, refId: id });
        return;
      }
    }
  };

  for (const t of event.tables) {
    check(t.id, t.label || t.id, [tablePolygon(t), ...seatsOf(t.id).map(seatPoly)]);
  }
  for (const s of event.seats.filter((x) => !x.tableId)) check(s.id, s.label || s.id, [seatPoly(s)]);
  for (const st of event.strips) check(st.id, st.label || st.id, [rectCorners({ ...st, ...STRIP_SIZE })]);
  for (const d of event.devices) check(d.id, d.label || d.id, [rectCorners({ ...d, ...DEVICE_SIZE })]);
  return out;
}
