import { describe, expect, it } from "vitest";
import { nearestSegment } from "./segments";

const path = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }];

describe("nearestSegment", () => {
  it("finds the leg of a path closest to a point", () => {
    expect(nearestSegment(path, { x: 5, y: 1 })).toBe(0);
    expect(nearestSegment(path, { x: 11, y: 6 })).toBe(1);
  });

  it("works for a straight two-point cable", () => {
    expect(nearestSegment([{ x: 0, y: 0 }, { x: 8, y: 0 }], { x: 3, y: 4 })).toBe(0);
  });

  it("measures to the end of a leg, not its extension", () => {
    // (14, 0) is beyond the end of leg 0 but only 4 from its end; leg 1 starts at that same corner
    expect(nearestSegment(path, { x: 14, y: -1 })).toBe(0);
    expect(nearestSegment(path, { x: 12, y: 9 })).toBe(1);
  });

  it("returns 0 for a path with no legs", () => {
    expect(nearestSegment([{ x: 1, y: 1 }], { x: 3, y: 3 })).toBe(0);
  });
});
