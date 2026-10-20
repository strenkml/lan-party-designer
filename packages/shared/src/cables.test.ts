import { describe, expect, it } from "vitest";
import { planCable, shoppingList } from "./cables";

describe("planCable", () => {
  it("adds 20% slack and 3 ft drop at each end to the Manhattan distance, then rounds up to a standard length", () => {
    // 10 ft run: 10 * 1.2 + 6 = 18 ft, next standard length is 25
    const cable = planCable({ x: 0, y: 0 }, { x: 10, y: 0 });
    expect(cable.estimatedFt).toBe(18);
    expect(cable.lengthFt).toBe(25);
  });

  it("sums both axes, not the straight line", () => {
    // 3 ft over and 4 ft up: Manhattan 7, so 7 * 1.2 + 6 = 14.4 ft, rounds up past 14 to 25
    const cable = planCable({ x: 1, y: 1 }, { x: 4, y: 5 });
    expect(cable.estimatedFt).toBeCloseTo(14.4);
    expect(cable.lengthFt).toBe(25);
  });

  it("uses only the end drops for seats right next to the switch", () => {
    const cable = planCable({ x: 2, y: 2 }, { x: 2, y: 2 });
    expect(cable.estimatedFt).toBe(6);
    expect(cable.lengthFt).toBe(6);
  });
});

describe("shoppingList", () => {
  it("groups cables by standard length, longest first, using manual overrides when set", () => {
    const list = shoppingList([
      { estimatedFt: 9, lengthFt: 10 },
      { estimatedFt: 12, lengthFt: 14 },
      { estimatedFt: 8, lengthFt: 10 },
      { estimatedFt: 9, lengthFt: 10, overrideFt: 25 },
    ]);
    expect(list).toEqual([
      { lengthFt: 25, count: 1 },
      { lengthFt: 14, count: 1 },
      { lengthFt: 10, count: 2 },
    ]);
  });
});
