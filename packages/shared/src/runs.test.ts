import { describe, expect, it } from "vitest";
import { cordRuns, ethernetRuns, powerRuns, shoppingSummary } from "./runs";
import { EventDoc, VenueDoc } from "./schema";
import type { VenueDoc as VenueDocT } from "./schema";

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
    // 8 ft run: 8 * 1.2 + 1 ft up the wall (outlet default 12 in) + 3 ft at the strip = 13.6
    expect(cords).toEqual([{ id: "c1", label: "Long", lengthFt: 14 }]);
    const summary = shoppingSummary(venue, event);
    expect(summary.ethernet).toEqual([{ lengthFt: 10, count: 1 }]); // 3 * 1.2 + 6 = 9.6
    expect(summary.cords).toEqual([{ lengthFt: 14, count: 1 }]);
    expect(summary.strips).toBe(1);
  });
});

describe("wall jacks", () => {
  const venueWithJack: VenueDocT = VenueDoc.parse({ jacks: [{ id: "j1", label: "North jack", x: 0, y: 0 }] });
  const event = EventDoc.parse({
    devices: [{ id: "rt", label: "Router", profileId: "router", x: 10, y: 0, jackId: "j1" }],
  });

  it("runs a cable from a router or switch to the wall jack it uplinks to", () => {
    const runs = ethernetRuns(event, venueWithJack);
    // 10 ft run: 10 * 1.2 + 1 ft jack height + 3 ft at the router = 16 ft, so a 25 ft cable
    expect(runs).toEqual([{ id: "jack-rt", key: "eth:jack-rt", from: "Router", to: "North jack", lengthFt: 25 }]);
  });

  it("leaves the jack out when the venue is not given or the jack no longer exists", () => {
    expect(ethernetRuns(event)).toEqual([]);
    expect(ethernetRuns(event, VenueDoc.parse({}))).toEqual([]);
  });

  it("counts the jack cable in the shopping list", () => {
    expect(shoppingSummary(venueWithJack, event).ethernet).toEqual([{ lengthFt: 25, count: 1 }]);
  });

  it("defaults a device to no jack", () => {
    expect(EventDoc.parse({ devices: [{ id: "a", profileId: "x", x: 0, y: 0 }] }).devices[0]!.jackId).toBeNull();
  });
});

describe("routed runs", () => {
  const venue = VenueDoc.parse({ outlets: [{ id: "o1", label: "North", x: 0, y: 0, heightIn: 18 }], jacks: [{ id: "j1", label: "Jack", x: 0, y: 10, heightIn: 48 }] });

  it("lengthens an ethernet run that follows a drawn route", () => {
    const straight = EventDoc.parse({
      seats: [{ id: "s1", label: "A1", x: 10, y: 0, netDeviceId: "sw", netPort: 0 }],
      devices: [{ id: "sw", label: "Core", profileId: "sw", x: 0, y: 0 }],
    });
    expect(ethernetRuns(straight)[0]).toMatchObject({ key: "eth:s1", lengthFt: 25 }); // 18 ft

    const routed = EventDoc.parse({ ...straight, routes: { "eth:s1": [{ x: 10, y: 12 }, { x: 0, y: 12 }] } });
    // 12 + 10 + 12 = 34 ft of floor: 34 * 1.2 + 6 = 46.8, rounds up to 50
    expect(ethernetRuns(routed)[0]).toMatchObject({ key: "eth:s1", lengthFt: 50 });
  });

  it("applies a route to the uplink between two switches", () => {
    const event = EventDoc.parse({
      devices: [{ id: "a", label: "A", profileId: "sw", x: 0, y: 0 }, { id: "b", label: "B", profileId: "sw", x: 10, y: 0 }],
      uplinks: [{ id: "u1", fromDeviceId: "a", toDeviceId: "b" }],
      routes: { "eth:u1": [{ x: 0, y: 6 }, { x: 10, y: 6 }] },
    });
    expect(ethernetRuns(event)[0]).toMatchObject({ key: "eth:u1", lengthFt: 50 }); // 6 + 10 + 6 = 22: 26.4 + 6 = 32.4
  });

  it("uses the jack's height off the floor for the wall end", () => {
    const event = EventDoc.parse({ devices: [{ id: "rt", label: "Router", profileId: "router", x: 0, y: 4, jackId: "j1" }] });
    // 6 ft run: 7.2 + 4 ft up to the jack + 3 ft at the router = 14.2, rounds up to 25
    expect(ethernetRuns(event, venue)[0]).toMatchObject({ lengthFt: 25 });
  });

  it("follows a drawn route for an extension cord", () => {
    const event = EventDoc.parse({
      cords: [{ id: "c1", label: "Cord", outletId: "o1" }],
      strips: [{ id: "st", x: 6, y: 0, pluggedInto: { kind: "cord", id: "c1" } }],
      routes: { "pwr:cord:c1": [{ x: 0, y: 5 }, { x: 6, y: 5 }] },
    });
    // 5 + 6 + 5 = 16 ft: 19.2 + 1.5 (outlet at 18 in) + 3 = 23.7, rounds up to 25
    expect(cordRuns(venue, event)).toEqual([{ id: "c1", label: "Cord", lengthFt: 25 }]);
  });

  it("lists the power cable for a strip plugged straight into an outlet, routed or not", () => {
    const base = {
      strips: [{ id: "st", label: "Strip 1", x: 4, y: 0, pluggedInto: { kind: "outlet", id: "o1" } }],
    };
    // 4 ft run: 4.8 + 1.5 (outlet) + 1 (strip) = 7.3, rounds up to 10
    expect(powerRuns(venue, EventDoc.parse(base))).toEqual([
      { id: "st", key: "pwr:strip:st", from: "Strip 1", to: "North", lengthFt: 10 },
    ]);
    const routed = EventDoc.parse({ ...base, routes: { "pwr:strip:st": [{ x: 4, y: 9 }, { x: 0, y: 9 }] } });
    // 9 + 4 + 9 = 22: 26.4 + 2.5 = 28.9, rounds up to 50
    expect(powerRuns(venue, routed)[0]).toMatchObject({ lengthFt: 50 });
  });

  it("does not list a strip that feeds from a cord, since the cord is the run", () => {
    const event = EventDoc.parse({
      cords: [{ id: "c1", outletId: "o1" }],
      strips: [{ id: "st", x: 6, y: 0, pluggedInto: { kind: "cord", id: "c1" } }],
    });
    expect(powerRuns(venue, event)).toEqual([]);
  });
});
