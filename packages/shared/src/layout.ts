import type { Seat, Table } from "./schema";

/** Distance from a table edge to the centre of a chair. */
export const CHAIR_OFFSET_FT = 1.25;

export const seatsPerSideFor = (widthFt: number, seatWidthIn = 36) =>
  Math.max(1, Math.floor((widthFt * 12) / seatWidthIn));

type Placed = Pick<Seat, "id" | "tableId" | "x" | "y" | "rotation">;

function rotate(x: number, y: number, deg: number) {
  if (deg === 0) return { x, y };
  const r = (deg * Math.PI) / 180;
  return { x: x * Math.cos(r) - y * Math.sin(r), y: x * Math.sin(r) + y * Math.cos(r) };
}

/** Seat positions for a table. Side "a" is the far edge, side "b" the near edge. */
export function layoutSeats(table: Table): Placed[] {
  const place = (id: string, lx: number, ly: number, facing: number): Placed => {
    const p = rotate(lx, ly, table.rotation);
    return {
      id,
      tableId: table.id,
      x: table.x + p.x,
      y: table.y + p.y,
      rotation: (facing + table.rotation) % 360,
    };
  };

  if (table.shape === "round") {
    const radius = table.width / 2 + CHAIR_OFFSET_FT;
    return Array.from({ length: table.seats }, (_, i) => {
      const angle = (2 * Math.PI * i) / table.seats - Math.PI / 2;
      const facing = (angle * 180) / Math.PI + 90;
      return place(`${table.id}-a${i}`, radius * Math.cos(angle), radius * Math.sin(angle), facing);
    });
  }

  const offsetY = table.depth / 2 + CHAIR_OFFSET_FT;
  const step = table.width / Math.max(table.seats, 1);
  const lx = (i: number) => (i + 0.5) * step - table.width / 2;
  const far = Array.from({ length: table.seats }, (_, i) => place(`${table.id}-a${i}`, lx(i), -offsetY, 0));
  const near = Array.from({ length: table.seats }, (_, i) => place(`${table.id}-b${i}`, lx(i), offsetY, 180));
  return [...far, ...near];
}

/**
 * Recomputes a table's seats after it changed. Seats keep their id and wiring;
 * hand-moved seats also keep their position.
 */
export function reconcileSeats(table: Table, existing: Seat[]): Seat[] {
  const byId = new Map(existing.map((s) => [s.id, s]));
  return layoutSeats(table).map((placed) => {
    const old = byId.get(placed.id);
    if (!old) {
      return {
        ...placed,
        label: "",
        manual: false,
        stripId: null,
        netDeviceId: null,
        netPort: null,
        cableOverrideFt: null,
      };
    }
    return old.manual ? old : { ...old, x: placed.x, y: placed.y, rotation: placed.rotation };
  });
}
