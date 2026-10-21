import type { DeviceProfile, EventDoc, VenueDoc } from "./schema";

export interface Endpoint {
  kind: string;
  id: string;
}

export interface WireOption {
  group: "Ethernet" | "Power";
  /** The other end, as seen from the object that was right-clicked. */
  target: Endpoint;
  targetName: string;
  /** What choosing this does, for the menu: "Ethernet to Switch 1", "Plug into North". */
  verb: string;
  /** Allowed in principle but not right now, such as a switch with no free port. */
  disabledReason?: string;
  distanceFt: number;
  /** The connection in the direction applyWire understands: the client plugs into the supplier. */
  apply: { source: Endpoint; target: Endpoint };
}

const MAX_PER_GROUP = 14;
const same = (a: Endpoint, b: Endpoint) => a.kind === b.kind && a.id === b.id;
const rid = (prefix: string) => `${prefix}-${Math.random().toString(16).slice(2, 10)}`;

/** Read-only view of what is already connected to what. */
function model(venue: VenueDoc, doc: EventDoc, profiles: DeviceProfile[]) {
  const profileById = new Map(profiles.map((p) => [p.id, p]));
  const outlets = new Map(venue.outlets.map((o) => [o.id, o]));
  const jacks = new Map(venue.jacks.map((j) => [j.id, j]));
  const seats = new Map(doc.seats.map((s) => [s.id, s]));
  const devices = new Map(doc.devices.map((d) => [d.id, d]));
  const strips = new Map(doc.strips.map((s) => [s.id, s]));
  const cords = new Map(doc.cords.map((c) => [c.id, c]));

  const portsOf = (d: EventDoc["devices"][number]) => d.ports ?? profileById.get(d.profileId)?.ports ?? 0;
  const usedPorts = (deviceId: string, exceptSeat?: string) =>
    doc.seats.filter((s) => s.netDeviceId === deviceId && s.id !== exceptSeat).length +
    doc.uplinks.filter((u) => u.fromDeviceId === deviceId || u.toDeviceId === deviceId).length;
  const outletUsed = (id: string) =>
    doc.strips.filter((s) => s.pluggedInto?.kind === "outlet" && s.pluggedInto.id === id).length +
    doc.devices.filter((d) => d.pluggedInto?.kind === "outlet" && d.pluggedInto.id === id).length +
    doc.cords.filter((c) => c.outletId === id).length;
  const stripUsed = (id: string) =>
    doc.seats.filter((s) => s.stripId === id).length +
    doc.devices.filter((d) => d.pluggedInto?.kind === "strip" && d.pluggedInto.id === id).length +
    doc.strips.filter((s) => s.pluggedInto?.kind === "strip" && s.pluggedInto.id === id).length;
  const cordUsed = (id: string) =>
    doc.strips.filter((s) => s.pluggedInto?.kind === "cord" && s.pluggedInto.id === id).length +
    doc.devices.filter((d) => d.pluggedInto?.kind === "cord" && d.pluggedInto.id === id).length;
  /** Plugging `plug` into `socket` would loop if `plug` is already upstream of `socket`. */
  const loops = (plug: string, socket: string) => {
    let cur: string | undefined = socket;
    for (let guard = 0; cur && guard < 100; guard++) {
      if (cur === plug) return true;
      const next: { kind: string; id: string } | null | undefined = strips.get(cur)?.pluggedInto;
      cur = next?.kind === "strip" ? next.id : undefined;
    }
    return false;
  };
  const posOf = (e: Endpoint): { x: number; y: number } | null => {
    if (e.kind === "seat") return seats.get(e.id) ?? null;
    if (e.kind === "device") return devices.get(e.id) ?? null;
    if (e.kind === "strip") return strips.get(e.id) ?? null;
    if (e.kind === "outlet") return outlets.get(e.id) ?? null;
    if (e.kind === "jack") return jacks.get(e.id) ?? null;
    if (e.kind === "cord") {
      const o = outlets.get(cords.get(e.id)?.outletId ?? "");
      return o ?? null;
    }
    return null;
  };
  const nameOf = (e: Endpoint) => {
    const item =
      e.kind === "seat" ? seats.get(e.id)
      : e.kind === "device" ? devices.get(e.id)
      : e.kind === "strip" ? strips.get(e.id)
      : e.kind === "outlet" ? outlets.get(e.id)
      : e.kind === "jack" ? jacks.get(e.id)
      : cords.get(e.id);
    return (item as { label?: string } | undefined)?.label || e.id;
  };
  return { outlets, jacks, seats, devices, strips, cords, portsOf, usedPorts, outletUsed, stripUsed, cordUsed, loops, posOf, nameOf };
}

/**
 * Everything the given object could legally be wired to, nearest first. Impossible pairings
 * (a seat to a seat, a TV with no ports to a switch, a strip into itself) are never offered.
 * Valid but full targets come back with a disabledReason.
 */
export function wireOptions(
  venue: VenueDoc,
  doc: EventDoc,
  profiles: DeviceProfile[],
  source: Endpoint,
  names?: (e: Endpoint) => string | undefined,
): WireOption[] {
  const m = model(venue, doc, profiles);
  const origin = m.posOf(source);
  if (!origin) return [];
  const name = (e: Endpoint) => names?.(e) ?? m.nameOf(e);
  const out: WireOption[] = [];

  const add = (
    group: WireOption["group"],
    target: Endpoint,
    verb: (n: string) => string,
    apply: WireOption["apply"],
    disabledReason?: string,
  ) => {
    const at = m.posOf(target);
    const n = name(target);
    out.push({
      group,
      target,
      targetName: n,
      verb: verb(n),
      disabledReason,
      distanceFt: at ? Math.hypot(at.x - origin.x, at.y - origin.y) : 9999,
      apply,
    });
  };

  const networkDevices = doc.devices.filter((d) => m.portsOf(d) > 0);
  const e = (kind: string, id: string): Endpoint => ({ kind, id });

  if (source.kind === "seat") {
    const seat = m.seats.get(source.id)!;
    for (const d of networkDevices) {
      if (seat.netDeviceId === d.id) continue;
      const full = m.usedPorts(d.id, seat.id) >= m.portsOf(d);
      add("Ethernet", e("device", d.id), (n) => `Ethernet to ${n}`, { source, target: e("device", d.id) }, full ? "No free ports" : undefined);
    }
    for (const st of doc.strips) {
      if (seat.stripId === st.id) continue;
      add("Power", e("strip", st.id), (n) => `Power from ${n}`, { source, target: e("strip", st.id) }, m.stripUsed(st.id) >= st.sockets ? "No free sockets" : undefined);
    }
  }

  if (source.kind === "device") {
    const dev = m.devices.get(source.id)!;
    const myFull = m.usedPorts(dev.id) >= m.portsOf(dev);
    if (m.portsOf(dev) > 0) {
      for (const d of networkDevices) {
        if (d.id === dev.id) continue;
        if (doc.uplinks.some((u) => (u.fromDeviceId === dev.id && u.toDeviceId === d.id) || (u.fromDeviceId === d.id && u.toDeviceId === dev.id))) continue;
        const reason = myFull ? "No free port on this device" : m.usedPorts(d.id) >= m.portsOf(d) ? "No free ports" : undefined;
        add("Ethernet", e("device", d.id), (n) => `Uplink to ${n}`, { source, target: e("device", d.id) }, reason);
      }
      for (const j of venue.jacks) {
        if (dev.jackId === j.id) continue;
        const taken = doc.devices.some((x) => x.id !== dev.id && x.jackId === j.id);
        add("Ethernet", e("jack", j.id), (n) => `Uplink to wall jack ${n}`, { source, target: e("jack", j.id) }, taken ? "Jack in use" : undefined);
      }
      for (const s of doc.seats) {
        if (s.netDeviceId === dev.id) continue;
        add("Ethernet", e("seat", s.id), (n) => `Ethernet to seat ${n}`, { source: e("seat", s.id), target: e("device", dev.id) }, myFull ? "No free ports" : undefined);
      }
    }
    const cur = dev.pluggedInto;
    for (const o of venue.outlets) {
      if (cur?.kind === "outlet" && cur.id === o.id) continue;
      add("Power", e("outlet", o.id), (n) => `Plug into ${n}`, { source, target: e("outlet", o.id) }, m.outletUsed(o.id) >= o.sockets ? "No free plug" : undefined);
    }
    for (const st of doc.strips) {
      if (cur?.kind === "strip" && cur.id === st.id) continue;
      add("Power", e("strip", st.id), (n) => `Plug into ${n}`, { source, target: e("strip", st.id) }, m.stripUsed(st.id) >= st.sockets ? "No free sockets" : undefined);
    }
    for (const c of doc.cords) {
      if (cur?.kind === "cord" && cur.id === c.id) continue;
      add("Power", e("cord", c.id), (n) => `Plug into ${n}`, { source, target: e("cord", c.id) }, m.cordUsed(c.id) >= 1 ? "Cord already feeds something" : undefined);
    }
  }

  if (source.kind === "strip") {
    const strip = m.strips.get(source.id)!;
    const cur = strip.pluggedInto;
    for (const o of venue.outlets) {
      if (cur?.kind === "outlet" && cur.id === o.id) continue;
      add("Power", e("outlet", o.id), (n) => `Plug into ${n}`, { source, target: e("outlet", o.id) }, m.outletUsed(o.id) >= o.sockets ? "No free plug" : undefined);
    }
    for (const other of doc.strips) {
      if (other.id === strip.id) continue;
      // this strip into the other one
      if (!(cur?.kind === "strip" && cur.id === other.id) && !m.loops(strip.id, other.id)) {
        add("Power", e("strip", other.id), (n) => `Plug into ${n}`, { source, target: e("strip", other.id) }, m.stripUsed(other.id) >= other.sockets ? "No free sockets" : undefined);
      }
      // the other strip into this one
      const already = other.pluggedInto?.kind === "strip" && other.pluggedInto.id === strip.id;
      if (!already && !m.loops(other.id, strip.id)) {
        add("Power", e("strip", other.id), (n) => `Plug ${n} into this`, { source: e("strip", other.id), target: source }, m.stripUsed(strip.id) >= strip.sockets ? "No free sockets" : undefined);
      }
    }
    for (const c of doc.cords) {
      if (cur?.kind === "cord" && cur.id === c.id) continue;
      add("Power", e("cord", c.id), (n) => `Plug into ${n}`, { source, target: e("cord", c.id) }, m.cordUsed(c.id) >= 1 ? "Cord already feeds something" : undefined);
    }
    const full = m.stripUsed(strip.id) >= strip.sockets ? "No free sockets" : undefined;
    for (const s of doc.seats) {
      if (s.stripId === strip.id) continue;
      add("Power", e("seat", s.id), (n) => `Power seat ${n} from this`, { source: e("seat", s.id), target: source }, full);
    }
    for (const d of doc.devices) {
      if (d.pluggedInto?.kind === "strip" && d.pluggedInto.id === strip.id) continue;
      add("Power", e("device", d.id), (n) => `Plug ${n} into this`, { source: e("device", d.id), target: source }, full);
    }
  }

  if (source.kind === "outlet") {
    const o = m.outlets.get(source.id)!;
    const full = m.outletUsed(o.id) >= o.sockets ? "No free plug" : undefined;
    for (const st of doc.strips) if (!st.pluggedInto) add("Power", e("strip", st.id), (n) => `Plug ${n} into this`, { source: e("strip", st.id), target: source }, full);
    for (const d of doc.devices) if (!d.pluggedInto) add("Power", e("device", d.id), (n) => `Plug ${n} into this`, { source: e("device", d.id), target: source }, full);
    for (const c of doc.cords) if (!c.outletId) add("Power", e("cord", c.id), (n) => `Plug ${n} into this`, { source: e("cord", c.id), target: source }, full);
  }

  if (source.kind === "jack") {
    const j = m.jacks.get(source.id)!;
    const holder = doc.devices.find((d) => d.jackId === j.id);
    for (const d of networkDevices) {
      if (d.jackId === j.id) continue;
      add("Ethernet", e("device", d.id), (n) => `Uplink ${n} to this jack`, { source: e("device", d.id), target: source }, holder ? "Jack in use" : undefined);
    }
  }

  // enabled first, nearest first, and a sane length for a menu
  const rank = (a: WireOption, b: WireOption) => Number(!!a.disabledReason) - Number(!!b.disabledReason) || a.distanceFt - b.distanceFt;
  const result: WireOption[] = [];
  for (const group of ["Ethernet", "Power"] as const) result.push(...out.filter((o) => o.group === group).sort(rank).slice(0, MAX_PER_GROUP));
  return result;
}

/**
 * Makes a connection if the rules allow it and returns the key of the new cable, or null and
 * leaves the plan untouched. For two strips the source is the one that plugs into the other.
 */
export function applyWire(doc: EventDoc, venue: VenueDoc, profiles: DeviceProfile[], source: Endpoint, target: Endpoint): string | null {
  const candidates = [
    ...wireOptions(venue, doc, profiles, source).filter((o) => same(o.target, target)),
    ...wireOptions(venue, doc, profiles, target).filter((o) => same(o.target, source)),
  ].filter((o) => !o.disabledReason);
  const option = candidates.find((o) => same(o.apply.source, source)) ?? candidates[0];
  if (!option) return null;
  const { source: a, target: b } = option.apply;
  const m = model(venue, doc, profiles);
  let key: string | null = null;

  if (a.kind === "seat" && b.kind === "device") {
    const seat = doc.seats.find((s) => s.id === a.id)!;
    const dev = m.devices.get(b.id)!;
    const taken = new Set(doc.seats.filter((s) => s.netDeviceId === dev.id && s.id !== seat.id && s.netPort !== null).map((s) => s.netPort!));
    const capacity = m.portsOf(dev) - doc.uplinks.filter((u) => u.fromDeviceId === dev.id || u.toDeviceId === dev.id).length;
    let port = 0;
    while (port < capacity && taken.has(port)) port++;
    if (port >= capacity) return null;
    seat.netDeviceId = dev.id;
    seat.netPort = port;
    key = `eth:${seat.id}`;
  } else if (a.kind === "device" && b.kind === "device") {
    const up = { id: rid("up"), fromDeviceId: a.id, toDeviceId: b.id, overrideFt: null };
    doc.uplinks.push(up);
    key = `eth:${up.id}`;
  } else if (a.kind === "device" && b.kind === "jack") {
    const dev = m.devices.get(a.id)!;
    dev.jackId = b.id;
    key = `eth:jack-${dev.id}`;
  } else if (a.kind === "seat" && b.kind === "strip") {
    doc.seats.find((s) => s.id === a.id)!.stripId = b.id;
    key = `pwr:seat:${a.id}`;
  } else if (a.kind === "strip" && ["outlet", "strip", "cord"].includes(b.kind)) {
    doc.strips.find((s) => s.id === a.id)!.pluggedInto = { kind: b.kind as "outlet" | "strip" | "cord", id: b.id };
    key = `pwr:strip:${a.id}`;
  } else if (a.kind === "device" && ["outlet", "strip", "cord"].includes(b.kind)) {
    doc.devices.find((d) => d.id === a.id)!.pluggedInto = { kind: b.kind as "outlet" | "strip" | "cord", id: b.id };
    key = `pwr:dev:${a.id}`;
  } else if (a.kind === "cord" && b.kind === "outlet") {
    doc.cords.find((c) => c.id === a.id)!.outletId = b.id;
    key = `pwr:cord:${a.id}`;
  }
  // a changed connection starts straight, so an old drawn route no longer applies
  if (key) delete doc.routes[key];
  return key;
}
