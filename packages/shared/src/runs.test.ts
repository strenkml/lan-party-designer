import { describe, expect, it } from "vitest";
import { cordRuns, ethernetRuns, shoppingSummary } from "./runs";
import { EventDoc, VenueDoc } from "./schema";

const venue = VenueDoc.parse({ outlets: [{ id: "o1", x: 0, y: 0 }] });

describe("ethernetRuns", () => {
  const event = EventDoc.parse({
    seats: [
      { id: "s1", label: "A1", x: 10, y: 0, netDeviceId: "sw", netPort: 0 },
      { id: "s2", label: "A2", x: 0, y: 0, netDeviceId: "sw", netPort: 1, cableOverrideFt: 50 },
      { id: "s3", x: 5, y: 5 },
    ],
    devices: [
      { id: "sw", label: "Core", profileId: "sw", x: 0, y: 0 },
      { id: "sw2", label: "Edge", profileId: "sw", x: 20, y: 0 },
    ],
    uplinks: [{ id: "u1", fromDeviceId: "sw", toDeviceId: "sw2" }],
  });

  it("makes one run per wired seat and uplink, honouring overrides", () => {
    const runs = ethernetRuns(event);
    expect(runs.map((r) => [r.from, r.to, r.lengthFt])).toEqual([
      ["A1", "Core", 25], // 10 * 1.2 + 6 = 18
      ["A2", "Core", 50], // override beats the 6 ft estimate
      ["Core", "Edge", 50], // 20 * 1.2 + 6 = 30
    ]);
  });
});

describe("cordRuns and shoppingSummary", () => {
  it("measures cords from the outlet to what they feed and lists everything to buy", () => {
    const event = EventDoc.parse({
      cords: [{ id: "c1", label: "Long", outletId: "o1" }],
      strips: [{ id: "st", x: 8, y: 0, pluggedInto: { kind: "cord", id: "c1" } }],
      seats: [{ id: "s1", x: 3, y: 0, netDeviceId: "sw", netPort: 0 }],
      devices: [{ id: "sw", profileId: "sw", x: 0, y: 0 }],
    });
    const cords = cordRuns(venue, event);
    expect(cords).toEqual([{ id: "c1", label: "Long", lengthFt: 25 }]); // 8 * 1.2 + 6 = 15.6
    const summary = shoppingSummary(venue, event);
    expect(summary.ethernet).toEqual([{ lengthFt: 10, count: 1 }]); // 3 * 1.2 + 6 = 9.6
    expect(summary.cords).toEqual([{ lengthFt: 25, count: 1 }]);
    expect(summary.strips).toBe(1);
  });
});
