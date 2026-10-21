import { describe, expect, it } from "vitest";
import { applyWire, wireOptions, type Endpoint } from "./wiring";
import { EventDoc, VenueDoc, type DeviceProfile } from "./schema";

const profiles: DeviceProfile[] = [
  { id: "sw", name: "Switch", kind: "switch", typicalW: 15, peakW: 25, ports: 4 },
  { id: "rt", name: "Router", kind: "router", typicalW: 12, peakW: 20, ports: 2 },
  { id: "tv", name: "TV", kind: "display", typicalW: 90, peakW: 150, ports: 0 },
];

const venue = VenueDoc.parse({
  outlets: [
    { id: "o1", label: "North", x: 0, y: 0, sockets: 2 },
    { id: "o2", label: "East", x: 20, y: 0, sockets: 1 },
  ],
  jacks: [{ id: "j1", label: "Closet", x: 0, y: 10 }],
});

const base = () =>
  EventDoc.parse({
    seats: [
      { id: "s1", label: "A1", x: 5, y: 5 },
      { id: "s2", label: "A2", x: 6, y: 5 },
    ],
    strips: [
      { id: "st1", label: "Strip 1", x: 4, y: 4, sockets: 2 },
      { id: "st2", label: "Strip 2", x: 12, y: 4, sockets: 2 },
    ],
    devices: [
      { id: "sw1", label: "Switch 1", profileId: "sw", x: 3, y: 3 },
      { id: "sw2", label: "Switch 2", profileId: "sw", x: 15, y: 3 },
      { id: "tv1", label: "TV", profileId: "tv", x: 9, y: 9 },
    ],
    cords: [{ id: "c1", label: "Cord 1" }],
  });

const ep = (kind: Endpoint["kind"], id: string): Endpoint => ({ kind, id });
const opts = (doc: ReturnType<typeof base>, source: Endpoint) => wireOptions(venue, doc, profiles, source);
const ids = (list: { target: Endpoint }[]) => list.map((o) => `${o.target.kind}:${o.target.id}`);
const enabled = (list: { disabledReason?: string }[]) => list.filter((o) => !o.disabledReason);

describe("what a seat can be wired to", () => {
  const list = opts(base(), ep("seat", "s1"));

  it("offers switches for ethernet and strips for power", () => {
    expect(ids(list.filter((o) => o.group === "Ethernet")).sort()).toEqual(["device:sw1", "device:sw2"]);
    expect(ids(list.filter((o) => o.group === "Power")).sort()).toEqual(["strip:st1", "strip:st2"]);
  });

  it("never offers another seat, a device with no network ports, an outlet or a jack", () => {
    const all = ids(list);
    expect(all.some((t) => t.startsWith("seat:"))).toBe(false);
    expect(all).not.toContain("device:tv1");
    expect(all.some((t) => t.startsWith("outlet:") || t.startsWith("jack:"))).toBe(false);
  });

  it("sorts the nearest target first", () => {
    const eth = list.filter((o) => o.group === "Ethernet");
    expect(eth[0]!.target.id).toBe("sw1"); // 2.8 ft away, against 10 ft
  });

  it("does not offer the switch the seat is already on", () => {
    const doc = base();
    doc.seats[0]!.netDeviceId = "sw1";
    doc.seats[0]!.netPort = 0;
    expect(ids(opts(doc, ep("seat", "s1")).filter((o) => o.group === "Ethernet"))).toEqual(["device:sw2"]);
  });

  it("shows a full switch as unavailable, counting seats and uplinks against its ports", () => {
    const doc = base();
    // sw1 has 4 ports: one uplink, three seats
    doc.uplinks.push({ id: "u1", fromDeviceId: "sw1", toDeviceId: "sw2", overrideFt: null, mbps: null });
    doc.seats.push(
      { ...doc.seats[0]!, id: "x1", netDeviceId: "sw1", netPort: 0 },
      { ...doc.seats[0]!, id: "x2", netDeviceId: "sw1", netPort: 1 },
      { ...doc.seats[0]!, id: "x3", netDeviceId: "sw1", netPort: 2 },
    );
    const sw1 = opts(doc, ep("seat", "s1")).find((o) => o.target.id === "sw1")!;
    expect(sw1.disabledReason).toMatch(/no free port/i);
  });

  it("shows a strip with every socket used as unavailable", () => {
    const doc = base();
    doc.seats.push({ ...doc.seats[0]!, id: "x1", stripId: "st1" }, { ...doc.seats[0]!, id: "x2", stripId: "st1" });
    const st1 = opts(doc, ep("seat", "s1")).find((o) => o.target.id === "st1")!;
    expect(st1.disabledReason).toMatch(/no free socket/i);
  });
});

describe("what a switch can be wired to", () => {
  const list = opts(base(), ep("device", "sw1"));

  it("offers other network devices for an uplink and wall jacks, but not itself or the TV", () => {
    const eth = ids(list.filter((o) => o.group === "Ethernet"));
    expect(eth).toContain("device:sw2");
    expect(eth).toContain("jack:j1");
    expect(eth).not.toContain("device:sw1");
    expect(eth).not.toContain("device:tv1");
  });

  it("offers outlets, strips and cords for power", () => {
    const power = ids(list.filter((o) => o.group === "Power"));
    expect(power).toEqual(expect.arrayContaining(["outlet:o1", "outlet:o2", "strip:st1", "strip:st2", "cord:c1"]));
  });

  it("stops offering an uplink that already exists", () => {
    const doc = base();
    doc.uplinks.push({ id: "u1", fromDeviceId: "sw2", toDeviceId: "sw1", overrideFt: null, mbps: null });
    expect(ids(opts(doc, ep("device", "sw1")))).not.toContain("device:sw2");
  });

  it("marks a wall jack that another device already uses", () => {
    const doc = base();
    doc.devices[1]!.jackId = "j1";
    const j = opts(doc, ep("device", "sw1")).find((o) => o.target.id === "j1")!;
    expect(j.disabledReason).toMatch(/in use/i);
  });

  it("a TV can be plugged in but has no ethernet options", () => {
    const tv = opts(base(), ep("device", "tv1"));
    expect(tv.filter((o) => o.group === "Ethernet")).toEqual([]);
    expect(tv.filter((o) => o.group === "Power").length).toBeGreaterThan(0);
  });
});

describe("what a power strip can be wired to", () => {
  it("can plug into outlets, other strips and cords, but not into itself", () => {
    const power = ids(opts(base(), ep("strip", "st1")).filter((o) => o.verb.startsWith("Plug into")));
    expect(power).toEqual(expect.arrayContaining(["outlet:o1", "strip:st2", "cord:c1"]));
    expect(power).not.toContain("strip:st1");
  });

  it("will not plug into a strip that is plugged into it, which would be a loop", () => {
    const doc = base();
    doc.strips[1]!.pluggedInto = { kind: "strip", id: "st1" };
    const into = ids(opts(doc, ep("strip", "st1")).filter((o) => o.verb.startsWith("Plug into")));
    expect(into).not.toContain("strip:st2");
    // a longer chain is a loop too: st1 -> st3 -> st2 -> st1
    const chain = base();
    chain.strips.push({ ...chain.strips[0]!, id: "st3", label: "Strip 3" });
    chain.strips[1]!.pluggedInto = { kind: "strip", id: "st3" };
    chain.strips[2]!.pluggedInto = { kind: "strip", id: "st1" };
    expect(ids(opts(chain, ep("strip", "st1")).filter((o) => o.verb.startsWith("Plug into")))).not.toContain("strip:st2");
  });

  it("shows an outlet with no free plug as unavailable", () => {
    const doc = base();
    doc.strips[1]!.pluggedInto = { kind: "outlet", id: "o2" }; // o2 has one plug
    const o2 = opts(doc, ep("strip", "st1")).find((o) => o.target.id === "o2")!;
    expect(o2.disabledReason).toMatch(/no free plug/i);
  });

  it("can have seats, switches and other strips plugged into it", () => {
    const feeds = ids(opts(base(), ep("strip", "st1")).filter((o) => o.verb.includes("into this") || o.verb.startsWith("Power")));
    expect(feeds).toEqual(expect.arrayContaining(["seat:s1", "device:sw1", "device:tv1", "strip:st2"]));
  });
});

describe("what an outlet and a wall jack can be wired to", () => {
  it("an outlet offers only things that are not plugged in yet", () => {
    const doc = base();
    doc.strips[0]!.pluggedInto = { kind: "outlet", id: "o1" };
    const targets = ids(opts(doc, ep("outlet", "o1")));
    expect(targets).not.toContain("strip:st1");
    expect(targets).toEqual(expect.arrayContaining(["strip:st2", "device:sw1", "cord:c1"]));
    expect(targets.some((t) => t.startsWith("seat:") || t.startsWith("outlet:") || t.startsWith("jack:"))).toBe(false);
  });

  it("a jack offers network devices only", () => {
    expect(ids(opts(base(), ep("jack", "j1"))).sort()).toEqual(["device:sw1", "device:sw2"]);
  });

  it("a table or a zone has nothing to wire", () => {
    expect(opts(base(), ep("table", "t1"))).toEqual([]);
    expect(opts(base(), ep("zone", "z"))).toEqual([]);
  });
});

describe("applyWire", () => {
  it("wires a seat to the lowest free port and replaces its old connection", () => {
    const doc = base();
    doc.seats[1]!.netDeviceId = "sw1";
    doc.seats[1]!.netPort = 0;
    expect(applyWire(doc, venue, profiles, ep("seat", "s1"), ep("device", "sw1"))).toBe("eth:s1");
    expect(doc.seats[0]).toMatchObject({ netDeviceId: "sw1", netPort: 1 });
    // moving it somewhere else frees the old port
    applyWire(doc, venue, profiles, ep("seat", "s1"), ep("device", "sw2"));
    expect(doc.seats[0]).toMatchObject({ netDeviceId: "sw2", netPort: 0 });
  });

  it("wires from either end", () => {
    const doc = base();
    expect(applyWire(doc, venue, profiles, ep("device", "sw1"), ep("seat", "s2"))).toBe("eth:s2");
    expect(doc.seats[1]).toMatchObject({ netDeviceId: "sw1", netPort: 0 });
    expect(applyWire(doc, venue, profiles, ep("outlet", "o1"), ep("strip", "st1"))).toBe("pwr:strip:st1");
    expect(doc.strips[0]!.pluggedInto).toEqual({ kind: "outlet", id: "o1" });
  });

  it("adds an uplink between two switches and a jack link", () => {
    const doc = base();
    const key = applyWire(doc, venue, profiles, ep("device", "sw1"), ep("device", "sw2"))!;
    expect(doc.uplinks).toHaveLength(1);
    expect(key).toBe(`eth:${doc.uplinks[0]!.id}`);
    expect(applyWire(doc, venue, profiles, ep("device", "sw1"), ep("jack", "j1"))).toBe("eth:jack-sw1");
    expect(doc.devices[0]!.jackId).toBe("j1");
  });

  it("plugs strips and devices into outlets, strips and cords, and a cord into an outlet", () => {
    const doc = base();
    applyWire(doc, venue, profiles, ep("strip", "st1"), ep("strip", "st2"));
    expect(doc.strips[0]!.pluggedInto).toEqual({ kind: "strip", id: "st2" });
    expect(applyWire(doc, venue, profiles, ep("device", "tv1"), ep("strip", "st1"))).toBe("pwr:dev:tv1");
    expect(doc.devices[2]!.pluggedInto).toEqual({ kind: "strip", id: "st1" });
    expect(applyWire(doc, venue, profiles, ep("outlet", "o1"), ep("cord", "c1"))).toBe("pwr:cord:c1");
    expect(doc.cords[0]!.outletId).toBe("o1");
    applyWire(doc, venue, profiles, ep("strip", "st2"), ep("cord", "c1"));
    expect(doc.strips[1]!.pluggedInto).toEqual({ kind: "cord", id: "c1" });
  });

  it("wires a seat to a strip", () => {
    const doc = base();
    expect(applyWire(doc, venue, profiles, ep("seat", "s1"), ep("strip", "st1"))).toBe("pwr:seat:s1");
    expect(doc.seats[0]!.stripId).toBe("st1");
  });

  it("refuses connections the rules do not allow and leaves the plan unchanged", () => {
    const doc = base();
    const before = JSON.stringify(doc);
    expect(applyWire(doc, venue, profiles, ep("seat", "s1"), ep("seat", "s2"))).toBeNull();
    expect(applyWire(doc, venue, profiles, ep("seat", "s1"), ep("device", "tv1"))).toBeNull();
    expect(applyWire(doc, venue, profiles, ep("strip", "st1"), ep("strip", "st1"))).toBeNull();
    expect(applyWire(doc, venue, profiles, ep("table", "t"), ep("strip", "st1"))).toBeNull();
    expect(JSON.stringify(doc)).toBe(before);
  });

  it("refuses a full target even if asked directly", () => {
    const doc = base();
    doc.strips[1]!.pluggedInto = { kind: "outlet", id: "o2" };
    expect(applyWire(doc, venue, profiles, ep("strip", "st1"), ep("outlet", "o2"))).toBeNull();
    expect(doc.strips[0]!.pluggedInto).toBeNull();
  });

  it("refuses a loop of strips", () => {
    const doc = base();
    doc.strips[1]!.pluggedInto = { kind: "strip", id: "st1" };
    expect(applyWire(doc, venue, profiles, ep("strip", "st1"), ep("strip", "st2"))).toBeNull();
  });
});
