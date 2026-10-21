import { describe, expect, it } from "vitest";
import { heatLoad } from "./heat";

describe("heatLoad", () => {
  it("converts watts to BTU per hour", () => {
    const h = heatLoad({ typicalW: 1000, peakW: 2000 });
    expect(h.typicalBtu).toBeCloseTo(3412, 0);
    expect(h.peakBtu).toBeCloseTo(6824, 0);
  });

  it("expresses the peak as tons of cooling and 5000 BTU window units", () => {
    const h = heatLoad({ typicalW: 3517, peakW: 7034 });
    expect(h.peakTons).toBeCloseTo(2, 1);
    expect(h.peakWindowUnits).toBe(Math.ceil(h.peakBtu / 5000));
  });

  it("needs no cooling for no load", () => {
    expect(heatLoad({ typicalW: 0, peakW: 0 })).toMatchObject({ typicalBtu: 0, peakBtu: 0, peakWindowUnits: 0 });
  });
});
