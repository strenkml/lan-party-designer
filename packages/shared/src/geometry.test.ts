import { describe, expect, it } from "vitest";
import { layoutWarnings } from "./geometry";
import { polygonsOverlap, rectCorners } from "./geometry";
import { EventDoc, VenueDoc } from "./schema";

describe("rectCorners", () => {
  it("returns the four corners of an unrotated rectangle", () => {
    expect(rectCorners({ x: 10, y: 5, width: 4, depth: 2, rotation: 0 })).toEqual([
      { x: 8, y: 4 }, { x: 12, y: 4 }, { x: 12, y: 6 }, { x: 8, y: 6 },
    ]);
  });

  it("turns the corners around the centre", () => {
    const [a, b] = rectCorners({ x: 0, y: 0, width: 4, depth: 2, rotation: 90 });
    expect(a!.x).toBeCloseTo(1);
    expect(a!.y).toBeCloseTo(-2);
    expect(b!.x).toBeCloseTo(1);
    expect(b!.y).toBeCloseTo(2);
  });
});

describe("polygonsOverlap", () => {
  const sq = (x: number, y: number, size = 2) => rectCorners({ x, y, width: size, depth: size, rotation: 0 });

  it("sees overlapping and separate shapes", () => {
    expect(polygonsOverlap(sq(0, 0), sq(1, 1))).toBe(true);
    expect(polygonsOverlap(sq(0, 0), sq(5, 0))).toBe(false);
  });

  it("treats shapes that only touch along an edge as not overlapping", () => {
    expect(polygonsOverlap(sq(0, 0), sq(2, 0))).toBe(false);
  });

  it("handles rotated shapes whose boxes overlap but whose edges do not", () => {
    const diamond = rectCorners({ x: 0, y: 0, width: 4, depth: 4, rotation: 45 });
    // the box of the diamond reaches 2.83, but its corner at the top-right is empty
    expect(polygonsOverlap(diamond, sq(2.4, 2.4, 1))).toBe(false);
    expect(polygonsOverlap(diamond, sq(1, 0, 1))).toBe(true);
  });

  it("finds a small shape fully inside a big one", () => {
    expect(polygonsOverlap(sq(0, 0, 10), sq(0, 0, 1))).toBe(true);
  });
});

describe("layoutWarnings", () => {
  const venue = VenueDoc.parse({});
  const walkway = { id: "z1", label: "Main walkway", kind: "walkway", x: 10, y: 5, width: 4, depth: 12 };

  it("flags a table that sits in a walkway", () => {
    const event = EventDoc.parse({
      zones: [walkway],
      tables: [{ id: "t1", label: "Table 1", x: 10, y: 5, width: 6, depth: 2.5, seats: 2 }],
    });
    expect(layoutWarnings(venue, event)).toEqual([
      { level: "warn", code: "walkway", message: "Table 1 is in the way of Main walkway", refId: "t1" },
    ]);
  });

  it("flags a table whose chairs reach into a walkway even when the table does not", () => {
    const event = EventDoc.parse({
      zones: [{ ...walkway, x: 10, width: 1, depth: 20 }],
      tables: [{ id: "t1", label: "Table 1", x: 6, y: 5, width: 6, depth: 2.5, seats: 2 }],
      seats: [{ id: "t1-a0", tableId: "t1", x: 9.8, y: 5 }],
    });
    expect(layoutWarnings(venue, event).map((w) => w.refId)).toEqual(["t1"]);
  });

  it("flags strips and switches in a walkway", () => {
    const event = EventDoc.parse({
      zones: [walkway],
      strips: [{ id: "st", label: "Strip 1", x: 10, y: 2 }],
      devices: [{ id: "sw", label: "Switch 1", profileId: "x", x: 10, y: 8 }],
    });
    expect(layoutWarnings(venue, event).map((w) => w.refId).sort()).toEqual(["st", "sw"]);
  });

  it("ignores zones that are not walkways and things outside the walkway", () => {
    const event = EventDoc.parse({
      zones: [{ ...walkway, kind: "food" }, { ...walkway, id: "z2", x: 40 }],
      tables: [{ id: "t1", label: "Table 1", x: 10, y: 5, width: 6, depth: 2.5, seats: 2 }],
    });
    expect(layoutWarnings(venue, event)).toEqual([]);
  });
});
