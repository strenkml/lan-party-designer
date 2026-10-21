import { describe, expect, it } from "vitest";
import { networkLoad } from "./bandwidth";
import { EventDoc } from "./schema";

const dev = (id: string, extra: object = {}) => ({ id, label: id, profileId: "switch-24", x: 0, y: 0, ...extra });
const seats = (device: string, n: number, from = 0) =>
  Array.from({ length: n }, (_, i) => ({ id: `${device}-s${from + i}`, x: 0, y: 0, netDeviceId: device, netPort: i }));

describe("networkLoad", () => {
  it("counts the seats behind each uplink, away from the wall jack", () => {
    const event = EventDoc.parse({
      devices: [dev("core", { jackId: "j1" }), dev("edge")],
      uplinks: [{ id: "u1", fromDeviceId: "core", toDeviceId: "edge" }],
      seats: [...seats("core", 2), ...seats("edge", 5)],
    });
    const { uplinks } = networkLoad(event);
    expect(uplinks).toHaveLength(1);
    expect(uplinks[0]).toMatchObject({ downstream: "edge", upstream: "core", seats: 5, capacityMbps: 1000 });
  });

  it("works out which side is upstream whichever way the uplink was drawn", () => {
    const event = EventDoc.parse({
      devices: [dev("core", { jackId: "j1" }), dev("edge")],
      uplinks: [{ id: "u1", fromDeviceId: "edge", toDeviceId: "core" }],
      seats: seats("edge", 3),
    });
    expect(networkLoad(event).uplinks[0]).toMatchObject({ downstream: "edge", seats: 3 });
  });

  it("includes switches chained further down", () => {
    const event = EventDoc.parse({
      devices: [dev("core", { jackId: "j1" }), dev("mid"), dev("far")],
      uplinks: [
        { id: "u1", fromDeviceId: "core", toDeviceId: "mid" },
        { id: "u2", fromDeviceId: "mid", toDeviceId: "far" },
      ],
      seats: [...seats("mid", 2), ...seats("far", 4)],
    });
    const byId = Object.fromEntries(networkLoad(event).uplinks.map((u) => [u.id, u.seats]));
    expect(byId).toEqual({ u1: 6, u2: 4 });
  });

  it("uses the slower port speed unless the uplink sets its own", () => {
    const event = EventDoc.parse({
      devices: [dev("core", { jackId: "j1", portMbps: 10000 }), dev("edge", { portMbps: 100 }), dev("fast")],
      uplinks: [
        { id: "u1", fromDeviceId: "core", toDeviceId: "edge" },
        { id: "u2", fromDeviceId: "core", toDeviceId: "fast", mbps: 10000 },
      ],
      seats: [],
    });
    const cap = Object.fromEntries(networkLoad(event).uplinks.map((u) => [u.id, u.capacityMbps]));
    expect(cap).toEqual({ u1: 100, u2: 10000 });
  });

  it("falls back to a router, then to the busier switch, when no jack is set", () => {
    const withRouter = EventDoc.parse({
      devices: [dev("a"), dev("r", { profileId: "router" })],
      uplinks: [{ id: "u1", fromDeviceId: "r", toDeviceId: "a" }],
      seats: seats("a", 1),
    });
    expect(networkLoad(withRouter, new Map([["router", "router"]])).uplinks[0]!.downstream).toBe("a");
    const noHints = EventDoc.parse({
      devices: [dev("a"), dev("b")],
      uplinks: [{ id: "u1", fromDeviceId: "a", toDeviceId: "b" }],
      seats: [...seats("a", 6), ...seats("b", 2)],
    });
    expect(networkLoad(noHints).uplinks[0]!.downstream).toBe("b");
  });

  it("rates the per seat share of an uplink", () => {
    const mk = (n: number) =>
      EventDoc.parse({
        devices: [dev("core", { jackId: "j1" }), dev("edge")],
        uplinks: [{ id: "u1", fromDeviceId: "core", toDeviceId: "edge" }],
        seats: seats("edge", n),
      });
    const level = (n: number) => networkLoad(mk(n)).uplinks[0]!.level;
    expect(level(8)).toBe("ok");
    expect(level(16)).toBe("warn");
    expect(level(50)).toBe("danger");
    expect(networkLoad(mk(16)).uplinks[0]!.perSeatMbps).toBeCloseTo(62.5);
  });

  it("limits what a seat can pull by its switch's port speed", () => {
    const event = EventDoc.parse({
      devices: [dev("core", { jackId: "j1" }), dev("old", { portMbps: 100 })],
      uplinks: [{ id: "u1", fromDeviceId: "core", toDeviceId: "old" }],
      seats: seats("old", 4),
    });
    expect(networkLoad(event).uplinks[0]).toMatchObject({ demandMbps: 400, capacityMbps: 100, level: "ok" });
  });

  it("splits the internet connection across wired seats and suggests a cache when it is thin", () => {
    const event = EventDoc.parse({
      devices: [dev("core")],
      seats: seats("core", 10),
      settings: { internetMbps: 100 },
    });
    const { internet, warnings } = networkLoad(event);
    expect(internet).toMatchObject({ internetMbps: 100, seats: 10, perSeatMbps: 10 });
    expect(warnings.some((w) => /cache/i.test(w.message))).toBe(true);
  });

  it("says nothing about the internet when its speed is unknown or plenty", () => {
    const base = { devices: [dev("core")], seats: seats("core", 10) };
    expect(networkLoad(EventDoc.parse(base)).internet).toBeNull();
    const fast = networkLoad(EventDoc.parse({ ...base, settings: { internetMbps: 1000 } }));
    expect(fast.internet!.perSeatMbps).toBe(100);
    expect(fast.warnings).toEqual([]);
  });
});
