import { describe, expect, it } from "vitest";
import { EventDoc } from "@lpd/shared";
import { addTable, assignSeat, deleteCable, pasteObject, rotateObject, snapshotObject, disconnectDevice, disconnectOutlet, disconnectStrip, freePorts, groupObjects, groupOf, removeStrip, removeTable, removeZone, resizeTable, translateObjects, ungroup } from "./eventOps";

const empty = () => EventDoc.parse({});

describe("eventOps", () => {
  it("adds a table together with its seats", () => {
    const doc = empty();
    addTable(doc, "folding-6", { x: 5, y: 5 }, "t1");
    expect(doc.tables).toHaveLength(1);
    expect(doc.seats).toHaveLength(4);
    expect(doc.seats.every((s) => s.tableId === "t1")).toBe(true);
  });

  it("removing a table frees its guests and drops its seats", () => {
    const doc = empty();
    addTable(doc, "folding-6", { x: 0, y: 0 }, "t1");
    doc.attendance.push({ personId: "ann", rsvp: "confirmed", seatId: "t1-a0" });
    removeTable(doc, "t1");
    expect(doc.seats).toEqual([]);
    expect(doc.attendance[0]?.seatId).toBeNull();
  });

  it("growing a table adds seats and keeps existing wiring", () => {
    const doc = empty();
    addTable(doc, "folding-6", { x: 0, y: 0 }, "t1");
    doc.seats[0]!.stripId = "st1";
    resizeTable(doc, "t1", { seats: 3 });
    expect(doc.seats).toHaveLength(6);
    expect(doc.seats.find((s) => s.id === "t1-a0")?.stripId).toBe("st1");
  });

  it("moving a guest to a taken seat bumps the previous occupant", () => {
    const doc = empty();
    addTable(doc, "folding-6", { x: 0, y: 0 }, "t1");
    doc.attendance.push(
      { personId: "ann", rsvp: "confirmed", seatId: "t1-a0" },
      { personId: "bob", rsvp: "confirmed", seatId: null },
    );
    assignSeat(doc, "bob", "t1-a0");
    expect(doc.attendance.map((a) => a.seatId)).toEqual([null, "t1-a0"]);
  });

  it("lists only unused ports, leaving room for uplinks", () => {
    const doc = EventDoc.parse({
      seats: [{ id: "s1", x: 0, y: 0, netDeviceId: "sw", netPort: 0 }],
      devices: [
        { id: "sw", profileId: "x", x: 0, y: 0, ports: 4 },
        { id: "sw2", profileId: "x", x: 0, y: 0, ports: 4 },
      ],
      uplinks: [{ id: "u", fromDeviceId: "sw", toDeviceId: "sw2" }],
    });
    expect(freePorts(doc, "sw", 4)).toEqual([1, 2]);
  });

  it("moving seats to one side unseats guests on the side that goes away", () => {
    const doc = empty();
    addTable(doc, "folding-6", { x: 0, y: 0 }, "t1");
    doc.attendance.push(
      { personId: "ann", rsvp: "confirmed", seatId: "t1-a0" },
      { personId: "bob", rsvp: "confirmed", seatId: "t1-b0" },
    );
    resizeTable(doc, "t1", { seatSides: "far" });
    expect(doc.seats.map((s) => s.id)).toEqual(["t1-a0", "t1-a1"]);
    expect(doc.attendance.map((a) => a.seatId)).toEqual(["t1-a0", null]);
  });

  it("adds a custom named table from a saved spec", () => {
    const doc = empty();
    addTable(doc, { name: "Kitchen island", shape: "rect", width: 7, depth: 3, seats: 3, seatWidthIn: 30, seatSides: "far" }, { x: 4, y: 4 }, "t9");
    expect(doc.tables[0]).toMatchObject({ label: "Kitchen island", width: 7, depth: 3, seats: 3, seatSides: "far", seatWidthIn: 30 });
    expect(doc.seats.map((s) => s.id)).toEqual(["t9-a0", "t9-a1", "t9-a2"]);
  });

  describe("groups", () => {
    const setup = () => {
      const doc = EventDoc.parse({
        strips: [{ id: "st", x: 2, y: 2 }, { id: "st2", x: 9, y: 9 }],
        devices: [{ id: "sw", profileId: "x", x: 4, y: 4 }],
        zones: [{ id: "z", kind: "walkway", x: 20, y: 20, width: 4, depth: 4 }],
      });
      addTable(doc, "folding-6", { x: 10, y: 10 }, "t1");
      return doc;
    };

    it("groups two or more objects and finds the group from any member", () => {
      const doc = setup();
      const id = groupObjects(doc, [{ kind: "table", id: "t1" }, { kind: "strip", id: "st" }], "Pod A")!;
      expect(doc.groups).toHaveLength(1);
      expect(doc.groups[0]).toMatchObject({ id, label: "Pod A" });
      expect(groupOf(doc, "strip", "st")?.id).toBe(id);
      expect(groupOf(doc, "device", "sw")).toBeUndefined();
    });

    it("needs at least two objects", () => {
      const doc = setup();
      expect(groupObjects(doc, [{ kind: "table", id: "t1" }])).toBeNull();
      expect(doc.groups).toEqual([]);
    });

    it("moves an object to the new group when it was already in another", () => {
      const doc = setup();
      groupObjects(doc, [{ kind: "table", id: "t1" }, { kind: "strip", id: "st" }, { kind: "device", id: "sw" }]);
      const second = groupObjects(doc, [{ kind: "strip", id: "st" }, { kind: "strip", id: "st2" }])!;
      expect(groupOf(doc, "strip", "st")?.id).toBe(second);
      expect(doc.groups).toHaveLength(2);
      expect(doc.groups[0]!.members.map((m) => m.id).sort()).toEqual(["sw", "t1"]);
    });

    it("disbands a group that is left with a single object", () => {
      const doc = setup();
      groupObjects(doc, [{ kind: "table", id: "t1" }, { kind: "strip", id: "st" }]);
      removeStrip(doc, "st");
      expect(doc.groups).toEqual([]);
    });

    it("drops a deleted table or zone from its group", () => {
      const doc = setup();
      groupObjects(doc, [{ kind: "table", id: "t1" }, { kind: "strip", id: "st" }, { kind: "zone", id: "z" }]);
      removeTable(doc, "t1");
      expect(doc.groups[0]!.members.map((m) => m.id).sort()).toEqual(["st", "z"]);
      removeZone(doc, "z");
      expect(doc.groups).toEqual([]);
    });

    it("ungroups without touching the objects", () => {
      const doc = setup();
      const id = groupObjects(doc, [{ kind: "table", id: "t1" }, { kind: "strip", id: "st" }])!;
      ungroup(doc, id);
      expect(doc.groups).toEqual([]);
      expect(doc.strips).toHaveLength(2);
    });

    it("moves every member together, taking a table's chairs along even if one was moved by hand", () => {
      const doc = setup();
      doc.seats.find((s) => s.id === "t1-a0")!.x = 99;
      doc.seats.find((s) => s.id === "t1-a0")!.manual = true;
      translateObjects(doc, [{ kind: "table", id: "t1" }, { kind: "strip", id: "st" }, { kind: "zone", id: "z" }], 5, -2);
      expect(doc.tables[0]).toMatchObject({ x: 15, y: 8 });
      expect(doc.strips.find((s) => s.id === "st")).toMatchObject({ x: 7, y: 0 });
      expect(doc.zones[0]).toMatchObject({ x: 25, y: 18 });
      expect(doc.seats.find((s) => s.id === "t1-a0")!.x).toBe(104);
      expect(doc.seats.find((s) => s.id === "t1-a1")!.y).toBeCloseTo(10 - 2 - 2.5);
    });

    it("does not let floating point noise build up in saved coordinates", () => {
      const doc = setup();
      for (let i = 0; i < 10; i++) translateObjects(doc, [{ kind: "strip", id: "st" }, { kind: "table", id: "t1" }], 0.1, 0.1);
      expect(doc.strips.find((s) => s.id === "st")).toMatchObject({ x: 3, y: 3 });
      expect(doc.tables[0]).toMatchObject({ x: 11, y: 11 });
    });

    it("leaves objects outside the group where they are", () => {
      const doc = setup();
      translateObjects(doc, [{ kind: "strip", id: "st" }], 3, 3);
      expect(doc.strips.find((s) => s.id === "st2")).toMatchObject({ x: 9, y: 9 });
      expect(doc.devices[0]).toMatchObject({ x: 4, y: 4 });
    });
  });

  describe("disconnect everything", () => {
    const wired = () =>
      EventDoc.parse({
        seats: [
          { id: "s1", x: 0, y: 0, stripId: "st", netDeviceId: "sw", netPort: 0 },
          { id: "s2", x: 1, y: 0, stripId: "st", netDeviceId: "sw", netPort: 1 },
          { id: "s3", x: 2, y: 0, stripId: "st2", netDeviceId: "sw2", netPort: 0 },
        ],
        strips: [
          { id: "st", x: 0, y: 0, pluggedInto: { kind: "outlet", id: "o1" } },
          { id: "st2", x: 5, y: 0, pluggedInto: { kind: "strip", id: "st" } },
        ],
        devices: [
          { id: "sw", profileId: "x", x: 0, y: 3, jackId: "j1", pluggedInto: { kind: "strip", id: "st" } },
          { id: "sw2", profileId: "x", x: 5, y: 3, pluggedInto: { kind: "outlet", id: "o1" } },
        ],
        uplinks: [{ id: "u1", fromDeviceId: "sw", toDeviceId: "sw2" }],
        cords: [{ id: "c1", outletId: "o1" }],
        routes: { "eth:s1": [{ x: 1, y: 1 }], "eth:u1": [{ x: 2, y: 2 }], "eth:s3": [{ x: 9, y: 9 }], "pwr:strip:st": [{ x: 3, y: 3 }], "pwr:dev:sw2": [{ x: 4, y: 4 }] },
      });

    it("unplugs a switch from its seats, uplinks, wall jack and power, and reports how many", () => {
      const doc = wired();
      const n = disconnectDevice(doc, "sw");
      // two seats, one uplink, one jack, one power plug
      expect(n).toBe(5);
      expect(doc.seats.map((s) => [s.netDeviceId, s.netPort])).toEqual([[null, null], [null, null], ["sw2", 0]]);
      expect(doc.uplinks).toEqual([]);
      const sw = doc.devices.find((d) => d.id === "sw")!;
      expect(sw).toMatchObject({ jackId: null, pluggedInto: null });
      expect(doc.devices).toHaveLength(2); // the device itself stays
    });

    it("forgets the drawn routes of the cables it removed and keeps the others", () => {
      const doc = wired();
      disconnectDevice(doc, "sw");
      expect(Object.keys(doc.routes).sort()).toEqual(["eth:s3", "pwr:dev:sw2", "pwr:strip:st"]);
    });

    it("unplugs a strip from its outlet, its guests' seats and anything chained to it", () => {
      const doc = wired();
      const n = disconnectStrip(doc, "st");
      // its own plug, two seats, a daisy chained strip, a switch plugged into it
      expect(n).toBe(5);
      expect(doc.strips.find((s) => s.id === "st")!.pluggedInto).toBeNull();
      expect(doc.strips.find((s) => s.id === "st2")!.pluggedInto).toBeNull();
      expect(doc.seats.map((s) => s.stripId)).toEqual([null, null, "st2"]);
      expect(doc.devices.find((d) => d.id === "sw")!.pluggedInto).toBeNull();
      expect(doc.devices.find((d) => d.id === "sw2")!.pluggedInto).toEqual({ kind: "outlet", id: "o1" });
    });

    it("unplugs everything from an outlet, cords included", () => {
      const doc = wired();
      const n = disconnectOutlet(doc, "o1");
      // strip st, switch sw2, cord c1
      expect(n).toBe(3);
      expect(doc.strips.find((s) => s.id === "st")!.pluggedInto).toBeNull();
      expect(doc.devices.find((d) => d.id === "sw2")!.pluggedInto).toBeNull();
      expect(doc.cords[0]!.outletId).toBeNull();
      expect(doc.cords).toHaveLength(1);
      expect(doc.strips.find((s) => s.id === "st2")!.pluggedInto).toEqual({ kind: "strip", id: "st" });
    });

    it("does nothing, and says so, when there is nothing connected", () => {
      const doc = EventDoc.parse({ strips: [{ id: "st", x: 0, y: 0 }], devices: [{ id: "sw", profileId: "x", x: 0, y: 0 }] });
      expect(disconnectStrip(doc, "st")).toBe(0);
      expect(disconnectDevice(doc, "sw")).toBe(0);
      expect(disconnectOutlet(doc, "o1")).toBe(0);
    });
  });

  describe("copy, paste and rotate", () => {
    const setup = () => {
      const doc = EventDoc.parse({
        strips: [{ id: "st", label: "Strip 1", x: 2, y: 2, sockets: 8, amps: 20, rotation: 90, pluggedInto: { kind: "outlet", id: "o1" } }],
        devices: [{ id: "sw", label: "Core", profileId: "switch-16", x: 4, y: 4, ports: 24, jackId: "j1", pluggedInto: { kind: "strip", id: "st" } }],
        zones: [{ id: "z", label: "Walkway", kind: "walkway", x: 20, y: 20, width: 4, depth: 12 }],
        attendance: [{ personId: "ann", rsvp: "confirmed", seatId: "t1-a0" }],
      });
      addTable(doc, "folding-6", { x: 10, y: 10 }, "t1");
      doc.tables[0]!.label = "Table 1";
      doc.seats[0]!.stripId = "st";
      doc.seats[0]!.netDeviceId = "sw";
      return doc;
    };

    it("pastes a table with fresh chairs: no guests, no wiring, at the chosen spot", () => {
      const doc = setup();
      const snap = snapshotObject(doc, { kind: "table", id: "t1" })!;
      const made = pasteObject(doc, snap, { x: 30, y: 12 });
      const copy = doc.tables.find((t) => t.id === made.id)!;
      expect(made.kind).toBe("table");
      expect(copy).toMatchObject({ x: 30, y: 12, label: "Table 1 copy", width: 6, seats: 2 });
      expect(doc.tables).toHaveLength(2);
      const seats = doc.seats.filter((s) => s.tableId === copy.id);
      expect(seats).toHaveLength(4);
      expect(seats.every((s) => s.stripId === null && s.netDeviceId === null && s.id.startsWith(copy.id))).toBe(true);
      expect(doc.attendance[0]!.seatId).toBe("t1-a0"); // the original guest stays put
    });

    it("pastes a strip unplugged, keeping its size and rating", () => {
      const doc = setup();
      const made = pasteObject(doc, snapshotObject(doc, { kind: "strip", id: "st" })!, { x: 8, y: 8 });
      const copy = doc.strips.find((s) => s.id === made.id)!;
      expect(copy).toMatchObject({ x: 8, y: 8, label: "Strip 1 copy", sockets: 8, amps: 20, rotation: 90, pluggedInto: null });
      expect(copy.id).not.toBe("st");
    });

    it("pastes a switch with its ports but without its jack or power connection", () => {
      const doc = setup();
      const made = pasteObject(doc, snapshotObject(doc, { kind: "device", id: "sw" })!, { x: 1, y: 1 });
      expect(doc.devices.find((d) => d.id === made.id)).toMatchObject({ ports: 24, jackId: null, pluggedInto: null, label: "Core copy" });
    });

    it("pastes a zone", () => {
      const doc = setup();
      const made = pasteObject(doc, snapshotObject(doc, { kind: "zone", id: "z" })!, { x: 5, y: 5 });
      expect(doc.zones.find((z) => z.id === made.id)).toMatchObject({ x: 5, y: 5, width: 4, depth: 12, kind: "walkway", label: "Walkway copy" });
    });

    it("can paste the same copy more than once, even after the original is gone", () => {
      const doc = setup();
      const snap = snapshotObject(doc, { kind: "zone", id: "z" })!;
      doc.zones = [];
      pasteObject(doc, snap, { x: 1, y: 1 });
      pasteObject(doc, snap, { x: 2, y: 2 });
      expect(doc.zones).toHaveLength(2);
      expect(new Set(doc.zones.map((z) => z.id)).size).toBe(2);
    });

    it("returns nothing to copy for a missing object", () => {
      expect(snapshotObject(setup(), { kind: "strip", id: "nope" })).toBeNull();
    });

    it("rotates strips, switches and zones a quarter turn and wraps at 360", () => {
      const doc = setup();
      rotateObject(doc, { kind: "strip", id: "st" });
      expect(doc.strips[0]!.rotation).toBe(180);
      rotateObject(doc, { kind: "strip", id: "st" });
      rotateObject(doc, { kind: "strip", id: "st" });
      expect(doc.strips[0]!.rotation).toBe(0);
      rotateObject(doc, { kind: "device", id: "sw" });
      expect(doc.devices[0]!.rotation).toBe(90);
      rotateObject(doc, { kind: "zone", id: "z" });
      expect(doc.zones[0]!.rotation).toBe(90);
    });

    it("rotates a table and its chairs go around with it", () => {
      const doc = setup();
      const before = doc.seats.find((s) => s.id === "t1-a0")!;
      const x0 = before.x;
      rotateObject(doc, { kind: "table", id: "t1" });
      expect(doc.tables[0]!.rotation).toBe(90);
      expect(doc.seats.find((s) => s.id === "t1-a0")!.x).not.toBeCloseTo(x0);
    });
  });

  describe("deleteCable", () => {
    const wired = () =>
      EventDoc.parse({
        seats: [{ id: "s1", x: 0, y: 0, stripId: "st", netDeviceId: "sw", netPort: 3 }],
        strips: [{ id: "st", x: 1, y: 1, pluggedInto: { kind: "outlet", id: "o1" } }, { id: "st2", x: 2, y: 2, pluggedInto: { kind: "cord", id: "c1" } }],
        devices: [{ id: "sw", profileId: "x", x: 3, y: 3, jackId: "j1", pluggedInto: { kind: "strip", id: "st" } }, { id: "sw2", profileId: "x", x: 4, y: 4 }],
        uplinks: [{ id: "u1", fromDeviceId: "sw", toDeviceId: "sw2" }],
        cords: [{ id: "c1", outletId: "o1" }],
        routes: { "eth:s1": [{ x: 1, y: 1 }], "pwr:strip:st": [{ x: 2, y: 2 }] },
      });

    it("unplugs a seat from its switch port and forgets the route", () => {
      const doc = wired();
      expect(deleteCable(doc, "eth:s1")).toBe(true);
      expect(doc.seats[0]).toMatchObject({ netDeviceId: null, netPort: null, stripId: "st" });
      expect(doc.routes["eth:s1"]).toBeUndefined();
    });

    it("removes a switch uplink", () => {
      const doc = wired();
      deleteCable(doc, "eth:u1");
      expect(doc.uplinks).toEqual([]);
      expect(doc.devices).toHaveLength(2);
    });

    it("unplugs a switch from its wall jack", () => {
      const doc = wired();
      deleteCable(doc, "eth:jack-sw");
      expect(doc.devices.find((d) => d.id === "sw")).toMatchObject({ jackId: null });
    });

    it("unplugs a strip from its outlet but keeps its seats", () => {
      const doc = wired();
      deleteCable(doc, "pwr:strip:st");
      expect(doc.strips.find((s) => s.id === "st")!.pluggedInto).toBeNull();
      expect(doc.seats[0]!.stripId).toBe("st");
      expect(doc.routes["pwr:strip:st"]).toBeUndefined();
    });

    it("unplugs a switch from its strip, and a seat from its strip", () => {
      const doc = wired();
      deleteCable(doc, "pwr:dev:sw");
      expect(doc.devices.find((d) => d.id === "sw")!.pluggedInto).toBeNull();
      deleteCable(doc, "pwr:seat:s1");
      expect(doc.seats[0]!.stripId).toBeNull();
    });

    it("removes an extension cord and frees what was plugged into it", () => {
      const doc = wired();
      deleteCable(doc, "pwr:cord:c1");
      expect(doc.cords).toEqual([]);
      expect(doc.strips.find((s) => s.id === "st2")!.pluggedInto).toBeNull();
    });

    it("says so when there is no such cable", () => {
      expect(deleteCable(wired(), "eth:nope")).toBe(false);
    });
  });
});

