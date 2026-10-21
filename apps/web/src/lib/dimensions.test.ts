import { describe, expect, it } from "vitest";
import { wallDimensions } from "./dimensions";

const room = [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }, { x: 0, y: 10 }];
const door = (x: number, y: number, width = 3) => ({ id: `d${x}${y}`, x, y, width, rotation: 0, flipSwing: false, flipHinge: false });

describe("wallDimensions", () => {
  it("gives one span per wall when there are no doors", () => {
    const walls = wallDimensions(room, []);
    expect(walls.map((w) => w.spans.map((s) => s.lengthFt))).toEqual([[20], [10], [20], [10]]);
    expect(walls.every((w) => w.spans.every((s) => s.kind === "wall"))).toBe(true);
  });

  it("splits a wall at a door into the gap before it, the door, and the gap after it", () => {
    // 3 ft door centred 7 ft along the 20 ft top wall: 5.5 | 3 | 11.5
    const top = wallDimensions(room, [door(7, 0)])[0]!;
    expect(top.spans.map((s) => [s.kind, s.lengthFt])).toEqual([["wall", 5.5], ["door", 3], ["wall", 11.5]]);
  });

  it("measures from the wall's own start, whichever way the outline was drawn", () => {
    // right wall runs top to bottom (0 to 10); door centred 4 ft down
    const right = wallDimensions(room, [door(20, 4, 2)])[1]!;
    expect(right.spans.map((s) => s.lengthFt)).toEqual([3, 2, 5]);
  });

  it("puts several doors on one wall in order", () => {
    const top = wallDimensions(room, [door(15, 0), door(5, 0)])[0]!;
    expect(top.spans.map((s) => [s.kind, s.lengthFt])).toEqual([
      ["wall", 3.5], ["door", 3], ["wall", 7], ["door", 3], ["wall", 3.5],
    ]);
  });

  it("drops empty gaps when a door sits in a corner", () => {
    const top = wallDimensions(room, [door(1.5, 0)])[0]!;
    expect(top.spans.map((s) => [s.kind, s.lengthFt])).toEqual([["door", 3], ["wall", 17]]);
  });

  it("ignores doors that are not on any wall", () => {
    const walls = wallDimensions(room, [door(10, 5)]);
    expect(walls.every((w) => w.spans.every((s) => s.kind === "wall"))).toBe(true);
  });

  it("rounds to a tenth of a foot", () => {
    const top = wallDimensions(room, [door(7.04, 0)])[0]!;
    expect(top.spans[0]!.lengthFt).toBe(5.5);
  });

  it("reports where each span sits, for placing labels", () => {
    const top = wallDimensions(room, [door(7, 0)])[0]!;
    expect(top.spans[0]!.mid).toEqual({ x: 2.75, y: 0 });
    expect(top.outward).toEqual({ x: 0, y: -1 });
  });
});
