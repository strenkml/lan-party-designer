import { describe, expect, it } from "vitest";
import { EventBundle } from "./bundle";
import { EventDoc, VenueDoc } from "./schema";

/** Documents exactly as earlier releases saved them, before outlets had plugs, doors could flip, and so on. */
const oldVenue = {
  room: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }, { x: 0, y: 10 }],
  doors: [{ id: "d1", x: 5, y: 0, width: 3, rotation: 0 }],
  obstacles: [],
  outlets: [{ id: "o1", label: "", x: 1, y: 0, circuitId: "c1", amps: 15 }],
  circuits: [{ id: "c1", label: "Kitchen", amps: 15 }],
  background: null,
};
const oldEvent = {
  tables: [{ id: "t1", label: "T1", shape: "rect", x: 5, y: 5, width: 6, depth: 2.5, rotation: 0, seats: 2, seatWidthIn: 36 }],
  seats: [{ id: "t1-a0", tableId: "t1", label: "", x: 4, y: 3, rotation: 0, manual: false, stripId: null, netDeviceId: null, netPort: null, cableOverrideFt: null }],
  strips: [], cords: [], devices: [], uplinks: [], attendance: [], checklist: {},
  settings: { rsvpMode: "confirmedInvited", placeholderProfileId: null },
};

describe("documents saved by older releases", () => {
  it("load with sensible defaults for everything added since", () => {
    const venue = VenueDoc.parse(oldVenue);
    expect(venue.outlets[0]).toMatchObject({ sockets: 2, circuitId: "c1" });
    expect(venue.doors[0]).toMatchObject({ flipSwing: false, flipHinge: false });
    expect(venue.windows).toEqual([]);
    expect(venue.garageDoors).toEqual([]);

    const event = EventDoc.parse(oldEvent);
    expect(event.tables[0]).toMatchObject({ seatSides: "both", seats: 2 });
    expect(event.seats).toHaveLength(1);
  });

  it("give strips and switches saved before rotation existed a rotation of zero", () => {
    const event = EventDoc.parse({
      ...oldEvent,
      strips: [{ id: "st1", label: "S", x: 1, y: 1, sockets: 6, amps: 15, pluggedInto: null }],
      devices: [{ id: "sw1", label: "Sw", profileId: "switch-16", x: 2, y: 2, pluggedInto: null }],
    });
    expect([event.strips[0]!.rotation, event.devices[0]!.rotation]).toEqual([0, 0]);
  });

  it("get no owned gear, unknown internet speed and gigabit ports when saved before those existed", () => {
    const event = EventDoc.parse({
      ...oldEvent,
      devices: [{ id: "sw1", label: "Sw", profileId: "switch-16", x: 2, y: 2, rotation: 0, jackId: null, pluggedInto: null }],
      uplinks: [{ id: "u1", fromDeviceId: "sw1", toDeviceId: "sw2", overrideFt: null }],
    });
    expect(event.settings.owned).toEqual({ ethernet: {}, cords: {}, strips: 0, switches: 0 });
    expect(event.settings.internetMbps).toBeNull();
    expect(event.devices[0]!.portMbps).toBe(1000);
    expect(event.uplinks[0]!.mbps).toBeNull();
  });

  it("keep their data when the exported file is imported into a newer release", () => {
    const bundle = EventBundle.parse({
      version: 1,
      event: { name: "Old LAN", doc: oldEvent },
      venue: { name: "Old basement", doc: oldVenue },
    });
    expect(bundle.presets).toEqual([]);
    expect(bundle.venue.doc.outlets[0]!.sockets).toBe(2);
    expect(bundle.event.doc.tables[0]!.seatSides).toBe("both");
  });
});
