import { describe, expect, it } from "vitest";
import { EventDoc } from "@lpd/shared";
import { addTable, assignSeat, freePorts, removeTable, resizeTable } from "./eventOps";

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
});
