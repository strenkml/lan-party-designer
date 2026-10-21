import { describe, expect, it } from "vitest";
import { computePowerLoad } from "./power";
import {
  EventDoc,
  VenueDoc,
  type DeviceProfile,
  type EventDoc as EventDocT,
  type Person,
  type VenueDoc as VenueDocT,
} from "./schema";

const profiles: DeviceProfile[] = [
  { id: "pc", name: "Gaming PC", kind: "pc", typicalW: 360, peakW: 600, ports: 0 },
  { id: "mon", name: "Monitor", kind: "monitor", typicalW: 30, peakW: 40, ports: 0 },
  { id: "sw", name: "Switch", kind: "switch", typicalW: 15, peakW: 15, ports: 16 },
];

const person = (id: string, devices: string[] = ["pc"]): Person => ({
  id,
  name: id,
  handle: "",
  devices: devices.map((profileId) => ({ profileId })),
  needsEthernet: true,
  notes: "",
});

const venue = (v: Partial<VenueDocT> = {}): VenueDocT =>
  VenueDoc.parse({
    circuits: [{ id: "c1", label: "Breaker 1", amps: 15 }],
    outlets: [{ id: "o1", x: 0, y: 0, circuitId: "c1" }],
    ...v,
  });

const event = (e: Partial<EventDocT> = {}): EventDocT =>
  EventDoc.parse({
    seats: [{ id: "s1", x: 0, y: 0, stripId: "st1" }],
    strips: [{ id: "st1", x: 0, y: 0, pluggedInto: { kind: "outlet", id: "o1" } }],
    attendance: [{ personId: "ann", rsvp: "confirmed", seatId: "s1" }],
    ...e,
  });

describe("computePowerLoad", () => {
  it("rolls an attendee's devices up through seat, strip, outlet and circuit", () => {
    const report = computePowerLoad({
      venue: venue(),
      event: event(),
      people: [person("ann", ["pc", "mon"])],
      profiles,
    });

    // 360 + 30 = 390 W typical, 600 + 40 = 640 W peak
    expect(report.strips[0]).toMatchObject({ id: "st1", typicalW: 390, peakW: 640 });
    expect(report.outlets[0]).toMatchObject({ id: "o1", typicalW: 390, peakW: 640 });
    expect(report.circuits[0]).toMatchObject({ id: "c1", typicalW: 390, peakW: 640, ratingA: 15 });
    expect(report.circuits[0]?.typicalA).toBeCloseTo(3.25); // 390 / 120
    expect(report.circuits[0]?.level).toBe("ok");
  });

  // A 15A circuit allows 1800 W peak, and 80% of it (1440 W) typical.
  it.each([
    { typicalW: 1440, peakW: 1800, level: "ok" },
    { typicalW: 1441, peakW: 1800, level: "warn" },
    { typicalW: 1000, peakW: 1801, level: "danger" },
  ])("circuit at $typicalW W typical / $peakW W peak is $level", ({ typicalW, peakW, level }) => {
    const heavy: Person = { ...person("ann", []), devices: [{ profileId: "pc", typicalW, peakW }] };
    const report = computePowerLoad({ venue: venue(), event: event(), people: [heavy], profiles });
    expect(report.circuits[0]?.level).toBe(level);
  });

  it("reports load behind an unknown breaker as unverified instead of attributing it to a circuit", () => {
    const report = computePowerLoad({
      venue: venue({ outlets: [{ id: "o1", x: 0, y: 0, circuitId: null, amps: 15, label: "", sockets: 2, heightIn: 12 }] }),
      event: event(),
      people: [person("ann")],
      profiles,
    });
    expect(report.unverified).toEqual({ typicalW: 360, peakW: 600 });
    expect(report.circuits[0]).toMatchObject({ typicalW: 0, peakW: 0 });
    expect(report.warnings.map((w) => w.code)).toContain("unverified-circuit");
  });

  it("flags a strip plugged into another strip and sums both strips' loads at the outlet", () => {
    const report = computePowerLoad({
      venue: venue(),
      event: event({
        strips: [
          { id: "st1", x: 0, y: 0, sockets: 6, amps: 15, pluggedInto: { kind: "outlet", id: "o1" } },
          { id: "st2", x: 1, y: 0, sockets: 6, amps: 15, pluggedInto: { kind: "strip", id: "st1" } },
        ],
        seats: [
          { id: "s1", x: 0, y: 0, stripId: "st1" },
          { id: "s2", x: 1, y: 0, stripId: "st2" },
        ],
        attendance: [
          { personId: "ann", rsvp: "confirmed", seatId: "s1" },
          { personId: "bob", rsvp: "confirmed", seatId: "s2" },
        ],
      } as never),
      people: [person("ann"), person("bob")],
      profiles,
    });
    expect(report.warnings.map((w) => w.code)).toContain("daisy-chain");
    expect(report.outlets[0]).toMatchObject({ typicalW: 720, peakW: 1200 });
    expect(report.strips.find((s) => s.id === "st1")?.typicalW).toBe(720);
    expect(report.strips.find((s) => s.id === "st2")?.typicalW).toBe(360);
  });

  it("flags a strip with more devices than sockets", () => {
    const report = computePowerLoad({
      venue: venue(),
      event: event({
        strips: [{ id: "st1", x: 0, y: 0, sockets: 2, amps: 15, pluggedInto: { kind: "outlet", id: "o1" } }],
      } as never),
      people: [person("ann", ["mon", "mon", "mon"])],
      profiles,
    });
    expect(report.strips[0]).toMatchObject({ socketsUsed: 3, socketsTotal: 2 });
    expect(report.warnings).toContainEqual(expect.objectContaining({ code: "sockets", level: "danger" }));
  });

  it("checks extension cord ratings", () => {
    const report = computePowerLoad({
      venue: venue(),
      event: event({
        cords: [{ id: "cd1", gauge: 16, amps: 10, outletId: "o1" }],
        strips: [{ id: "st1", x: 0, y: 0, sockets: 6, amps: 15, pluggedInto: { kind: "cord", id: "cd1" } }],
      } as never),
      people: [person("ann", ["pc", "pc", "pc"])], // 1800 W peak is 15A on a 10A cord
      profiles,
    });
    expect(report.cords[0]).toMatchObject({ id: "cd1", peakW: 1800, level: "danger" });
    expect(report.circuits[0]).toMatchObject({ typicalW: 1080, peakW: 1800 });
  });

  it("ignores declined guests, and invited guests only in confirmed-only mode", () => {
    const base = {
      attendance: [
        { personId: "ann", rsvp: "confirmed", seatId: "s1" },
        { personId: "bob", rsvp: "invited", seatId: "s2" },
        { personId: "cy", rsvp: "declined", seatId: "s3" },
      ],
      seats: ["s1", "s2", "s3"].map((id) => ({ id, x: 0, y: 0, stripId: "st1" })),
    };
    const people = [person("ann"), person("bob"), person("cy")];
    const both = computePowerLoad({ venue: venue(), event: event(base as never), people, profiles });
    expect(both.total.typicalW).toBe(720);

    const confirmedOnly = computePowerLoad({
      venue: venue(),
      event: event({ ...base, settings: { rsvpMode: "confirmed" } } as never),
      people,
      profiles,
    });
    expect(confirmedOnly.total.typicalW).toBe(360);
  });

  it("fills empty seats with the placeholder profile when one is set", () => {
    const report = computePowerLoad({
      venue: venue(),
      event: event({
        attendance: [],
        settings: { placeholderProfileId: "pc" },
      } as never),
      people: [],
      profiles,
    });
    expect(report.seatLoads["s1"]).toMatchObject({ typicalW: 360, peakW: 600 });
  });

  it("warns when a seat has devices but no strip", () => {
    const report = computePowerLoad({
      venue: venue(),
      event: event({ seats: [{ id: "s1", x: 0, y: 0, stripId: null }] } as never),
      people: [person("ann")],
      profiles,
    });
    expect(report.warnings.map((w) => w.code)).toContain("unpowered-seat");
  });

  describe("outlet sockets", () => {
    const strip = (id: string, into: object) => ({ id, x: 0, y: 0, sockets: 6, amps: 15, pluggedInto: into });
    const plug = { kind: "outlet", id: "o1" };

    it("defaults to a duplex outlet with two sockets", () => {
      const report = computePowerLoad({ venue: venue(), event: event(), people: [person("ann")], profiles });
      expect(report.outlets[0]).toMatchObject({ socketsUsed: 1, socketsTotal: 2 });
    });

    it("allows as many things as the outlet has sockets and flags one more", () => {
      const three = [strip("st1", plug), strip("st2", plug), strip("st3", plug)];
      const full = computePowerLoad({
        venue: venue({ outlets: [{ id: "o1", x: 0, y: 0, circuitId: "c1", amps: 15, label: "", sockets: 3, heightIn: 12 }] }),
        event: event({ strips: three, seats: [], attendance: [] } as never),
        people: [],
        profiles,
      });
      expect(full.outlets[0]).toMatchObject({ socketsUsed: 3, socketsTotal: 3 });
      expect(full.warnings.map((w) => w.code)).not.toContain("sockets");

      const over = computePowerLoad({
        venue: venue(),
        event: event({ strips: three, seats: [], attendance: [] } as never),
        people: [],
        profiles,
      });
      expect(over.outlets[0]).toMatchObject({ socketsUsed: 3, socketsTotal: 2 });
      expect(over.warnings).toContainEqual(expect.objectContaining({ code: "sockets", level: "danger", refId: "o1" }));
    });

    it("counts an extension cord as one socket on its outlet", () => {
      const report = computePowerLoad({
        venue: venue(),
        event: event({
          cords: [{ id: "cd1", gauge: 14, amps: 15, outletId: "o1" }],
          strips: [strip("st1", { kind: "cord", id: "cd1" })],
          seats: [],
          attendance: [],
        } as never),
        people: [],
        profiles,
      });
      expect(report.outlets[0]).toMatchObject({ socketsUsed: 1, socketsTotal: 2 });
    });

    it("sums the load of everything sharing the outlet", () => {
      const report = computePowerLoad({
        venue: venue({ outlets: [{ id: "o1", x: 0, y: 0, circuitId: "c1", amps: 15, label: "", sockets: 4, heightIn: 12 }] }),
        event: event({
          strips: [strip("st1", plug), strip("st2", plug)],
          seats: [{ id: "s1", x: 0, y: 0, stripId: "st1" }, { id: "s2", x: 0, y: 0, stripId: "st2" }],
          attendance: [
            { personId: "ann", rsvp: "confirmed", seatId: "s1" },
            { personId: "bob", rsvp: "confirmed", seatId: "s2" },
          ],
        } as never),
        people: [person("ann"), person("bob")],
        profiles,
      });
      expect(report.outlets[0]).toMatchObject({ socketsUsed: 2, socketsTotal: 4, typicalW: 720 });
    });
  });
});
