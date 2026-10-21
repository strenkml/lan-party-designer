import { describe, expect, it } from "vitest";
import { cableConnections } from "./connections";
import { EventDoc, VenueDoc } from "./schema";

const venue = VenueDoc.parse({
  outlets: [{ id: "o1", label: "North", x: 0, y: 0 }],
  jacks: [{ id: "j1", label: "Closet", x: 0, y: 9 }],
});
const event = EventDoc.parse({
  seats: [{ id: "s1", label: "A1", x: 10, y: 4, netDeviceId: "sw", netPort: 0, stripId: "st" }, { id: "s2", x: 12, y: 4 }],
  devices: [
    { id: "sw", label: "Core", profileId: "sw", x: 5, y: 5, jackId: "j1", pluggedInto: { kind: "strip", id: "st" } },
    { id: "sw2", label: "Edge", profileId: "sw", x: 15, y: 5 },
  ],
  uplinks: [{ id: "u1", fromDeviceId: "sw", toDeviceId: "sw2" }],
  strips: [
    { id: "st", label: "Strip 1", x: 3, y: 3, pluggedInto: { kind: "outlet", id: "o1" } },
    { id: "st2", label: "Strip 2", x: 8, y: 3, pluggedInto: { kind: "cord", id: "c1" } },
  ],
  cords: [{ id: "c1", label: "Cord", outletId: "o1" }],
  routes: { "eth:s1": [{ x: 10, y: 8 }] },
});

describe("cableConnections", () => {
  const all = cableConnections(venue, event);
  const byKey = (k: string) => all.find((c) => c.key === k)!;

  it("lists every cable that can be routed, with a stable key", () => {
    expect(all.map((c) => c.key).sort()).toEqual([
      "eth:jack-sw",
      "eth:s1",
      "eth:u1",
      "pwr:cord:c1",
      "pwr:dev:sw",
      "pwr:seat:s1",
      "pwr:strip:st",
    ]);
  });

  it("tells ethernet from power and names both ends", () => {
    expect(byKey("eth:s1")).toMatchObject({ kind: "ethernet", fromName: "A1", toName: "Core" });
    expect(byKey("pwr:strip:st")).toMatchObject({ kind: "power", fromName: "Strip 1", toName: "North" });
  });

  it("places each end where the connected things are", () => {
    expect(byKey("eth:s1")).toMatchObject({ from: { x: 10, y: 4 }, to: { x: 5, y: 5 } });
    expect(byKey("eth:jack-sw")).toMatchObject({ from: { x: 5, y: 5 }, to: { x: 0, y: 9 } });
    // a cord runs from its outlet to whatever it feeds
    expect(byKey("pwr:cord:c1")).toMatchObject({ from: { x: 0, y: 0 }, to: { x: 8, y: 3 } });
  });

  it("includes the power link from a seat to its strip", () => {
    expect(byKey("pwr:seat:s1")).toMatchObject({ kind: "power", fromName: "A1", toName: "Strip 1", from: { x: 10, y: 4 }, to: { x: 3, y: 3 } });
  });

  it("carries the drawn route, empty when there is none", () => {
    expect(byKey("eth:s1").waypoints).toEqual([{ x: 10, y: 8 }]);
    expect(byKey("eth:u1").waypoints).toEqual([]);
  });

  it("leaves out seats with no switch and strips that plug into a cord", () => {
    expect(all.some((c) => c.key === "eth:s2")).toBe(false);
    expect(all.some((c) => c.key === "pwr:strip:st2")).toBe(false);
  });
});
