import { describe, expect, it } from "vitest";
import { EventDoc } from "@lpd/shared";
import { addTable, assignSeat, freePorts, groupObjects, groupOf, removeStrip, removeTable, removeZone, resizeTable, translateObjects, ungroup } from "./eventOps";

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
});

