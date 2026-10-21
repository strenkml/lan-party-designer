import { cableConnections } from "./connections";
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

function pointInPolygon(p: Point, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

function segmentsCross(a: Point, b: Point, c: Point, d: Point): boolean {
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/** Whether a straight segment passes through, or ends inside, a polygon. Touching an edge does not count. */
export function segmentCrossesPolygon(a: Point, b: Point, poly: Point[]): boolean {
  if (pointInPolygon(a, poly) || pointInPolygon(b, poly)) return true;
  return poly.some((p, i) => segmentsCross(a, b, p, poly[(i + 1) % poly.length]!));
}

export interface LayoutWarning {
  level: "warn";
  code: "walkway" | "cable-walkway";
  message: string;
  refId: string;
}

/** Furniture and equipment standing in a walkway zone. */
export function layoutWarnings(venue: VenueDoc, event: EventDoc): LayoutWarning[] {
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

  // Cables are drawn as straight legs through their bend points.
  for (const cn of cableConnections(venue, event)) {
    const path = [cn.from, ...cn.waypoints, cn.to];
    const zone = walkways.find((z) => {
      const poly = rectCorners(z);
      return path.slice(1).some((p, i) => segmentCrossesPolygon(path[i]!, p, poly));
    });
    if (zone) {
      const kind = cn.kind === "ethernet" ? "Ethernet cable" : "Power cable";
      out.push({ level: "warn", code: "cable-walkway", message: `${kind} from ${cn.fromName} to ${cn.toName} crosses ${zoneName(zone)}`, refId: cn.key });
    }
  }
  return out;
}
