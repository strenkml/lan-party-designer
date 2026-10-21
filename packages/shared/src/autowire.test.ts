import { describe, expect, it } from "vitest";
import { autoWire } from "./autowire";
import { EventDoc, VenueDoc, type DeviceProfile, type Person } from "./schema";

const profiles: DeviceProfile[] = [
  { id: "pc", name: "PC", kind: "pc", typicalW: 360, peakW: 600, ports: 0 },
  { id: "sw", name: "Switch", kind: "switch", typicalW: 15, peakW: 15, ports: 4 },
];
const person = (id: string, needsEthernet = true): Person => ({
  id,
  name: id,
  handle: "",
  devices: [{ profileId: "pc" }],
  needsEthernet,
  notes: "",
});
const venue = VenueDoc.parse({
  circuits: [{ id: "c1", label: "B1", amps: 20 }],
  outlets: [{ id: "o1", x: 0, y: 0, circuitId: "c1" }],
});
const plugged = { kind: "outlet", id: "o1" };
const seat = (id: string, x: number, extra = {}) => ({ id, x, y: 0, ...extra });
const sit = (personId: string, seatId: string) => ({ personId, rsvp: "confirmed", seatId });

describe("autoWire power", () => {
  it("plugs each seat into the nearest strip", () => {
    const event = EventDoc.parse({
      seats: [seat("s1", 1), seat("s2", 19)],
      strips: [
        { id: "left", x: 0, y: 0, pluggedInto: plugged },
        { id: "right", x: 20, y: 0, pluggedInto: plugged },
      ],
      attendance: [sit("ann", "s1"), sit("bob", "s2")],
    });
    const { event: wired, unplaced } = autoWire({ venue, event, people: [person("ann", false), person("bob", false)], profiles });
    expect(wired.seats.map((s) => s.stripId)).toEqual(["left", "right"]);
    expect(unplaced).toEqual([]);
  });

  it("skips a strip with no free sockets and falls back to the next nearest", () => {
    const event = EventDoc.parse({
      seats: [seat("s1", 1), seat("s2", 2)],
      strips: [
        { id: "near", x: 0, y: 0, sockets: 1, pluggedInto: plugged },
        { id: "far", x: 20, y: 0, sockets: 4, pluggedInto: plugged },
      ],
      attendance: [sit("ann", "s1"), sit("bob", "s2")],
    });
    const { event: wired } = autoWire({ venue, event, people: [person("ann", false), person("bob", false)], profiles });
    expect(wired.seats.map((s) => s.stripId)).toEqual(["near", "far"]);
  });

  it("never changes seats that are already wired and reports what it could not place", () => {
    const event = EventDoc.parse({
      seats: [seat("s1", 1, { stripId: "far" }), seat("s2", 2)],
      strips: [{ id: "far", x: 20, y: 0, sockets: 1, pluggedInto: plugged }],
      attendance: [sit("ann", "s1"), sit("bob", "s2")],
    });
    const { event: wired, unplaced } = autoWire({ venue, event, people: [person("ann", false), person("bob", false)], profiles });
    expect(wired.seats[0]?.stripId).toBe("far");
    expect(wired.seats[1]?.stripId).toBeNull();
    expect(unplaced).toEqual([{ seatId: "s2", kind: "power", reason: expect.any(String) }]);
  });

  it("stops filling a strip once it would pass 80% of its rating", () => {
    // 15A strip: 12A = 1440 W typical, so four 360 W PCs fit and a fifth does not
    const event = EventDoc.parse({
      seats: [1, 2, 3, 4, 5].map((n) => seat(`s${n}`, n)),
      strips: [{ id: "st", x: 0, y: 0, sockets: 8, amps: 15, pluggedInto: plugged }],
      attendance: [1, 2, 3, 4, 5].map((n) => sit(`p${n}`, `s${n}`)),
    });
    const people = [1, 2, 3, 4, 5].map((n) => person(`p${n}`, false));
    const { event: wired, unplaced } = autoWire({ venue, event, people, profiles });
    expect(wired.seats.filter((s) => s.stripId === "st")).toHaveLength(4);
    expect(unplaced.map((u) => u.seatId)).toEqual(["s5"]);
  });
});

describe("autoWire network", () => {
  const withSwitch = (extra = {}) =>
    EventDoc.parse({
      seats: [seat("s1", 1, { stripId: "st" }), seat("s2", 18, { stripId: "st" }), seat("s3", 2, { stripId: "st" })],
      strips: [{ id: "st", x: 0, y: 0, sockets: 8, amps: 20, pluggedInto: plugged }],
      devices: [
        { id: "swA", profileId: "sw", x: 0, y: 0, ports: 1 },
        { id: "swB", profileId: "sw", x: 20, y: 0 },
      ],
      attendance: [sit("ann", "s1"), sit("bob", "s2"), sit("cy", "s3")],
      ...extra,
    });

  it("gives each seat the lowest free port on the nearest switch with room", () => {
    const { event: wired, unplaced } = autoWire({
      venue,
      event: withSwitch(),
      people: [person("ann"), person("bob"), person("cy")],
      profiles,
    });
    const net = wired.seats.map((s) => [s.netDeviceId, s.netPort]);
    // seats are handled in order: ann fills swA's only port, then bob and cy go to swB
    expect(net).toEqual([
      ["swA", 0],
      ["swB", 0],
      ["swB", 1],
    ]);
    expect(unplaced).toEqual([]);
  });

  it("ignores people who do not need ethernet", () => {
    const { event: wired } = autoWire({
      venue,
      event: withSwitch(),
      people: [person("ann", false), person("bob"), person("cy", false)],
      profiles,
    });
    expect(wired.seats.map((s) => s.netDeviceId)).toEqual([null, "swB", null]);
  });

  it("counts uplinks as used ports", () => {
    const { event: wired } = autoWire({
      venue,
      event: withSwitch({ uplinks: [{ id: "u", fromDeviceId: "swA", toDeviceId: "swB" }] }),
      people: [person("ann"), person("bob"), person("cy")],
      profiles,
    });
    // swA's single port is taken by the uplink, so ann also goes to swB
    expect(wired.seats[0]?.netDeviceId).toBe("swB");
  });
});

describe("autoWire empty seats", () => {
  const sw = { id: "sw", profileId: "sw", x: 0, y: 0, ports: 4 };

  it("wires seats with no guest to a strip and a switch port", () => {
    const event = EventDoc.parse({
      seats: [seat("s1", 1), seat("s2", 2)],
      strips: [{ id: "st", x: 0, y: 0, sockets: 6, pluggedInto: plugged }],
      devices: [sw],
    });
    const { event: wired, unplaced } = autoWire({ venue, event, people: [], profiles });
    expect(wired.seats.map((s) => [s.stripId, s.netDeviceId, s.netPort])).toEqual([
      ["st", "sw", 0],
      ["st", "sw", 1],
    ]);
    expect(unplaced).toEqual([]);
  });

  it("also wires seats whose guest is unseated, declined or not in the event", () => {
    const event = EventDoc.parse({
      seats: [seat("s1", 1), seat("s2", 2)],
      strips: [{ id: "st", x: 0, y: 0, pluggedInto: plugged }],
      devices: [sw],
      attendance: [
        { personId: "ann", rsvp: "confirmed", seatId: null },
        { personId: "bob", rsvp: "declined", seatId: "s2" },
      ],
    });
    const { event: wired } = autoWire({ venue, event, people: [person("ann"), person("bob")], profiles });
    expect(wired.seats.every((s) => s.stripId === "st" && s.netDeviceId === "sw")).toBe(true);
  });

  it("reserves one socket per empty seat and no power budget", () => {
    // a 15A strip with 1 socket left is full of PCs by watts, but an empty seat only needs the socket
    const event = EventDoc.parse({
      seats: [seat("s1", 1, { stripId: "st" }), seat("s2", 2)],
      strips: [{ id: "st", x: 0, y: 0, sockets: 2, amps: 15, pluggedInto: plugged }],
      attendance: [sit("ann", "s1")],
    });
    const heavy = { ...person("ann", false), devices: [{ profileId: "pc", typicalW: 1430, peakW: 1500 }] };
    const { event: wired } = autoWire({ venue, event, people: [heavy], profiles });
    expect(wired.seats[1]?.stripId).toBe("st");
  });

  it("reports an empty seat that has nowhere to plug in", () => {
    const event = EventDoc.parse({ seats: [seat("s1", 1)] });
    const { unplaced } = autoWire({ venue, event, people: [], profiles });
    expect(unplaced.map((u) => [u.seatId, u.kind])).toEqual([["s1", "power"], ["s1", "network"]]);
  });

  it("still leaves a seated guest who needs no ethernet off the network", () => {
    const event = EventDoc.parse({
      seats: [seat("s1", 1, { stripId: "st" }), seat("s2", 2, { stripId: "st" })],
      strips: [{ id: "st", x: 0, y: 0, pluggedInto: plugged }],
      devices: [sw],
      attendance: [sit("ann", "s1")],
    });
    const { event: wired } = autoWire({ venue, event, people: [person("ann", false)], profiles });
    expect(wired.seats.map((s) => s.netDeviceId)).toEqual([null, "sw"]);
  });
});
