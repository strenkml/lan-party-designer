import { VenueDoc } from "@lpd/shared";
import { describe, expect, it } from "vitest";
import { cloneVenueItem } from "./venueOps";

// 20 x 10 ft room; the top wall runs along y = 0 and its items face into the room (rotation 0)
const room = [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }, { x: 0, y: 10 }];
const venue = (extra: object) => VenueDoc.parse({ room, ...extra });

describe("cloneVenueItem", () => {
  it("puts a copy of a door beside it on the same wall, keeping its settings", () => {
    const doc = venue({ doors: [{ id: "d1", x: 5, y: 0, width: 3, rotation: 0, flipSwing: true, flipHinge: true }] });
    const made = cloneVenueItem(doc, { kind: "door", id: "d1" });
    expect(made).toMatchObject({ kind: "door" });
    expect(doc.doors).toHaveLength(2);
    const copy = doc.doors.find((d) => d.id === made!.id)!;
    expect(copy).toMatchObject({ x: 8, y: 0, width: 3, rotation: 0, flipSwing: true, flipHinge: true });
    expect(copy.id).not.toBe("d1");
  });

  it("moves windows and garage doors by their own width", () => {
    const doc = venue({
      windows: [{ id: "w1", x: 2, y: 0, width: 4, rotation: 0 }],
      garageDoors: [{ id: "g1", x: 2, y: 0, width: 9, rotation: 0 }],
    });
    const w = cloneVenueItem(doc, { kind: "window", id: "w1" })!;
    const g = cloneVenueItem(doc, { kind: "garage", id: "g1" })!;
    expect(doc.windows.find((x) => x.id === w.id)!.x).toBe(6);
    expect(doc.garageDoors.find((x) => x.id === g.id)!.x).toBe(11);
  });

  it("copies an outlet with its breaker, plugs and height, two feet along the wall", () => {
    const doc = venue({ circuits: [{ id: "c1", label: "Kitchen", amps: 20 }], outlets: [{ id: "o1", label: "North", x: 4, y: 0, circuitId: "c1", amps: 20, sockets: 4, heightIn: 40 }] });
    const made = cloneVenueItem(doc, { kind: "outlet", id: "o1" })!;
    const copy = doc.outlets.find((o) => o.id === made.id)!;
    expect(copy).toMatchObject({ x: 6, y: 0, circuitId: "c1", amps: 20, sockets: 4, heightIn: 40, label: "North copy" });
  });

  it("copies a network jack, and leaves a blank label blank", () => {
    const doc = venue({ jacks: [{ id: "j1", label: "", x: 4, y: 0, rotation: 0, heightIn: 18 }] });
    const made = cloneVenueItem(doc, { kind: "jack", id: "j1" })!;
    expect(doc.jacks.find((j) => j.id === made.id)).toMatchObject({ x: 6, y: 0, heightIn: 18, label: "" });
  });

  it("goes the other way when there is no wall left in front", () => {
    const doc = venue({ doors: [{ id: "d1", x: 19, y: 0, width: 3, rotation: 0 }] });
    const made = cloneVenueItem(doc, { kind: "door", id: "d1" })!;
    expect(doc.doors.find((d) => d.id === made.id)!.x).toBe(16);
  });

  it("follows the wall when it runs sideways", () => {
    // right wall: local +x runs down the wall (rotation 90)
    const right = venue({ jacks: [{ id: "j1", label: "", x: 20, y: 2, rotation: 90, heightIn: 12 }] });
    const made = cloneVenueItem(right, { kind: "jack", id: "j1" })!;
    expect(right.jacks.find((j) => j.id === made.id)).toMatchObject({ x: 20, y: 4, rotation: 90 });
  });

  it("returns null for something that is not there or cannot be cloned here", () => {
    const doc = venue({});
    expect(cloneVenueItem(doc, { kind: "door", id: "nope" })).toBeNull();
    expect(cloneVenueItem(doc, { kind: "table", id: "t" })).toBeNull();
  });
});

describe("cloneVenueItem inside an editor update", () => {
  it("works on an immer draft, which is how the venue editor calls it", async () => {
    const { produce } = await import("immer");
    const doc = venue({ doors: [{ id: "d1", x: 5, y: 0, width: 3, rotation: 0 }] });
    const next = produce(doc, (d) => void cloneVenueItem(d, { kind: "door", id: "d1" }));
    expect(next.doors).toHaveLength(2);
  });
});
