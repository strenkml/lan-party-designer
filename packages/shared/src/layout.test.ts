import { describe, expect, it } from "vitest";
import { layoutSeats, reconcileSeats } from "./layout";
import { Table, type Seat } from "./schema";

const table = (t: Partial<Table> = {}): Table =>
  Table.parse({ id: "t1", x: 10, y: 10, width: 6, depth: 2.5, seats: 2, ...t });

describe("layoutSeats", () => {
  it("places seats evenly along both long sides, facing the table", () => {
    const seats = layoutSeats(table());
    expect(seats).toHaveLength(4);
    // 6 ft table, 2 per side: centres at -1.5 and +1.5 ft from the table centre
    const xs = seats.map((s) => s.x).sort((a, b) => a - b);
    expect(xs).toEqual([8.5, 8.5, 11.5, 11.5]);
    // chairs sit 1.25 ft past the table edge: 10 -/+ (1.25 + 1.25)
    const ys = [...new Set(seats.map((s) => s.y))].sort((a, b) => a - b);
    expect(ys).toEqual([7.5, 12.5]);
    expect(seats.find((s) => s.y === 7.5)?.rotation).toBe(0);
    expect(seats.find((s) => s.y === 12.5)?.rotation).toBe(180);
  });

  it("rotates the whole arrangement with the table", () => {
    const seats = layoutSeats(table({ rotation: 90, seats: 1 }));
    // quarter turn: the two sides now sit at x = 10 -/+ 2.5
    const xs = seats.map((s) => Math.round(s.x * 100) / 100).sort((a, b) => a - b);
    expect(xs).toEqual([7.5, 12.5]);
  });

  it("spreads seats around a round table", () => {
    const seats = layoutSeats(table({ shape: "round", width: 5, depth: 5, seats: 4 }));
    expect(seats).toHaveLength(4);
    for (const s of seats) {
      expect(Math.hypot(s.x - 10, s.y - 10)).toBeCloseTo(2.5 + 1.25);
    }
  });
});

describe("reconcileSeats", () => {
  it("keeps hand-moved seats and their wiring while recomputing the rest", () => {
    const t = table();
    const existing: Seat[] = reconcileSeats(t, []).map((s, i) => ({
      ...s,
      stripId: "st1",
      manual: i === 0,
      x: i === 0 ? 99 : s.x,
    }));
    const wider = table({ width: 8, seats: 3 });
    const result = reconcileSeats(wider, existing);
    expect(result).toHaveLength(6);
    expect(result[0]).toMatchObject({ id: existing[0]!.id, x: 99, manual: true, stripId: "st1" });
    expect(result[1]).toMatchObject({ id: existing[1]!.id, stripId: "st1" });
    expect(result[1]!.x).not.toBe(existing[1]!.x);
  });

  it("drops seats beyond the new count", () => {
    const t = table();
    const existing = reconcileSeats(t, []);
    expect(reconcileSeats(table({ seats: 1 }), existing)).toHaveLength(2);
  });
});
