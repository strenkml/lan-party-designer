import { newId } from "../lib/id";
import {
  layoutSeats,
  reconcileSeats,
  seatsPerSideFor,
  type DeviceProfile,
  type EventDoc,
  type InfraDevice,
  type Seat,
  type Strip,
  type Zone,
  type GroupMember,
  type Person,
  type Point,
  type Table,
  type TableSpec,
  type VenueDoc,
} from "@lpd/shared";

export interface TablePreset {
  id: string;
  label: string;
  shape: Table["shape"];
  width: number;
  depth: number;
}

export const TABLE_PRESETS: TablePreset[] = [
  { id: "folding-6", label: "6 ft folding", shape: "rect", width: 6, depth: 2.5 },
  { id: "folding-8", label: "8 ft folding", shape: "rect", width: 8, depth: 2.5 },
  { id: "round-5", label: "5 ft round", shape: "round", width: 5, depth: 5 },
  { id: "custom", label: "Custom 4 × 3 ft", shape: "rect", width: 4, depth: 3 },
];

/** Mutates the draft: table plus its seats. Takes a built-in preset id or a full spec (a custom preset). */
export function addTable(doc: EventDoc, preset: string | (TableSpec & { name?: string }), at: Point, id: string) {
  const builtin = typeof preset === "string" ? (TABLE_PRESETS.find((p) => p.id === preset) ?? TABLE_PRESETS[0]!) : null;
  const spec: TableSpec & { name?: string } = builtin
    ? {
        shape: builtin.shape,
        width: builtin.width,
        depth: builtin.depth,
        seats: builtin.shape === "round" ? 6 : seatsPerSideFor(builtin.width),
        seatWidthIn: 36,
        seatSides: "both",
      }
    : (preset as TableSpec & { name?: string });
  const table: Table = {
    id,
    label: spec.name || `Table ${doc.tables.length + 1}`,
    shape: spec.shape,
    x: at.x,
    y: at.y,
    width: spec.width,
    depth: spec.depth,
    rotation: 0,
    seats: spec.seats,
    seatWidthIn: spec.seatWidthIn,
    seatSides: spec.seatSides,
  };
  doc.tables.push(table);
  doc.seats.push(...reconcileSeats(table, []));
}

/** Applies a change to a table and recomputes its seats. */
export function resizeTable(doc: EventDoc, id: string, patch: Partial<Table>) {
  const table = doc.tables.find((t) => t.id === id);
  if (!table) return;
  Object.assign(table, patch);
  const mine = doc.seats.filter((s) => s.tableId === id);
  const next = reconcileSeats(table, mine);
  const kept = new Set(next.map((s) => s.id));
  for (const gone of mine.filter((s) => !kept.has(s.id))) {
    for (const a of doc.attendance) if (a.seatId === gone.id) a.seatId = null;
  }
  doc.seats = [...doc.seats.filter((s) => s.tableId !== id), ...next];
}

export function moveTable(doc: EventDoc, id: string, to: Point) {
  resizeTable(doc, id, to);
}

export function removeTable(doc: EventDoc, id: string) {
  const gone = new Set(doc.seats.filter((s) => s.tableId === id).map((s) => s.id));
  for (const a of doc.attendance) if (a.seatId && gone.has(a.seatId)) a.seatId = null;
  doc.seats = doc.seats.filter((s) => s.tableId !== id);
  doc.tables = doc.tables.filter((t) => t.id !== id);
  pruneGroups(doc);
}

export function resetSeat(doc: EventDoc, seatId: string) {
  const seat = doc.seats.find((s) => s.id === seatId);
  const table = doc.tables.find((t) => t.id === seat?.tableId);
  if (!seat || !table) return;
  const placed = layoutSeats(table).find((p) => p.id === seatId);
  if (placed) Object.assign(seat, { x: placed.x, y: placed.y, rotation: placed.rotation, manual: false });
}

/** Seats a guest. A seat holds one guest, so the previous occupant is unseated. */
export function assignSeat(doc: EventDoc, personId: string, seatId: string | null) {
  if (seatId) for (const a of doc.attendance) if (a.seatId === seatId) a.seatId = null;
  const entry = doc.attendance.find((a) => a.personId === personId);
  if (entry) entry.seatId = seatId;
}

export function removeStrip(doc: EventDoc, id: string) {
  doc.strips = doc.strips.filter((s) => s.id !== id);
  for (const s of doc.seats) if (s.stripId === id) s.stripId = null;
  for (const s of doc.strips) if (s.pluggedInto?.kind === "strip" && s.pluggedInto.id === id) s.pluggedInto = null;
  for (const d of doc.devices) if (d.pluggedInto?.kind === "strip" && d.pluggedInto.id === id) d.pluggedInto = null;
  pruneGroups(doc);
}

export function removeDevice(doc: EventDoc, id: string) {
  doc.devices = doc.devices.filter((d) => d.id !== id);
  doc.uplinks = doc.uplinks.filter((u) => u.fromDeviceId !== id && u.toDeviceId !== id);
  for (const s of doc.seats) {
    if (s.netDeviceId === id) {
      s.netDeviceId = null;
      s.netPort = null;
    }
  }
  pruneGroups(doc);
}

export function removeCord(doc: EventDoc, id: string) {
  doc.cords = doc.cords.filter((c) => c.id !== id);
  for (const s of doc.strips) if (s.pluggedInto?.kind === "cord" && s.pluggedInto.id === id) s.pluggedInto = null;
  for (const d of doc.devices) if (d.pluggedInto?.kind === "cord" && d.pluggedInto.id === id) d.pluggedInto = null;
}

export const devicePorts = (doc: EventDoc, deviceId: string, profiles: DeviceProfile[]) => {
  const d = doc.devices.find((x) => x.id === deviceId);
  return d ? (d.ports ?? profiles.find((p) => p.id === d.profileId)?.ports ?? 0) : 0;
};

/** Port numbers on a switch not yet used by a seat, with uplinks reserving the top ports. */
export function freePorts(doc: EventDoc, deviceId: string, totalPorts: number): number[] {
  const uplinks = doc.uplinks.filter((u) => u.fromDeviceId === deviceId || u.toDeviceId === deviceId).length;
  const taken = new Set(doc.seats.filter((s) => s.netDeviceId === deviceId && s.netPort !== null).map((s) => s.netPort!));
  const usable = Math.max(totalPorts - uplinks, 0);
  return Array.from({ length: usable }, (_, i) => i).filter((p) => !taken.has(p));
}

export const encodePlug = (p: { kind: string; id: string } | null) => (p ? `${p.kind}:${p.id}` : "");
export function decodePlug(value: string): { kind: "outlet" | "cord" | "strip"; id: string } | null {
  const [kind, ...rest] = value.split(":");
  return kind && rest.length && (kind === "outlet" || kind === "cord" || kind === "strip") ? { kind, id: rest.join(":") } : null;
}

export const personName = (people: Person[], id: string) => people.find((p) => p.id === id)?.name ?? "Unknown";
export const shortName = (p?: Person) => (p ? p.handle || p.name.split(" ")[0] || p.name : "");

export const outletName = (venue: VenueDoc, id: string) => {
  const o = venue.outlets.find((x) => x.id === id);
  if (!o) return id;
  return o.label || `Outlet ${venue.outlets.indexOf(o) + 1}`;
};

/** Human name for a seat, like "Table 2 A1". Seat ids end in side letter plus zero based index. */
export function seatName(doc: EventDoc, seatId: string | null): string {
  const seat = doc.seats.find((s) => s.id === seatId);
  if (!seat) return "No seat";
  const table = doc.tables.find((t) => t.id === seat.tableId);
  const m = /-([ab])(\d+)$/.exec(seat.id);
  const suffix = m ? `${m[1]!.toUpperCase()}${Number(m[2]) + 1}` : seat.label || seat.id;
  return `${table?.label || "Table"} ${suffix}`;
}


export function removeZone(doc: EventDoc, id: string) {
  doc.zones = doc.zones.filter((z) => z.id !== id);
  pruneGroups(doc);
}

// ----- groups -----

const sameMember = (a: GroupMember, b: GroupMember) => a.kind === b.kind && a.id === b.id;

export function groupOf(doc: EventDoc, kind: GroupMember["kind"], id: string) {
  return doc.groups.find((g) => g.members.some((m) => m.kind === kind && m.id === id));
}

const exists = (doc: EventDoc, m: GroupMember) =>
  m.kind === "table" ? doc.tables.some((x) => x.id === m.id)
  : m.kind === "strip" ? doc.strips.some((x) => x.id === m.id)
  : m.kind === "device" ? doc.devices.some((x) => x.id === m.id)
  : doc.zones.some((x) => x.id === m.id);

/** Drops members that no longer exist and groups with fewer than two objects left. */
export function pruneGroups(doc: EventDoc) {
  for (const g of doc.groups) g.members = g.members.filter((m) => exists(doc, m));
  doc.groups = doc.groups.filter((g) => g.members.length >= 2);
}

/** Groups objects so they move together. An object belongs to one group, so it leaves any earlier one. */
export function groupObjects(doc: EventDoc, members: GroupMember[], label = ""): string | null {
  const unique = members.filter((m, i) => members.findIndex((x) => sameMember(x, m)) === i && exists(doc, m));
  if (unique.length < 2) return null;
  for (const g of doc.groups) g.members = g.members.filter((m) => !unique.some((u) => sameMember(u, m)));
  const id = newId("group");
  doc.groups.push({ id, label, members: unique });
  pruneGroups(doc);
  return id;
}

export function ungroup(doc: EventDoc, groupId: string) {
  doc.groups = doc.groups.filter((g) => g.id !== groupId);
}

/** Moves objects by the same amount. A table takes all of its chairs along, including ones moved by hand. */
export function translateObjects(doc: EventDoc, members: GroupMember[], dx: number, dy: number) {
  const round = (n: number) => Math.round(n * 1e6) / 1e6;
  const shift = (o: { x: number; y: number }) => {
    o.x = round(o.x + dx);
    o.y = round(o.y + dy);
  };
  for (const m of members) {
    if (m.kind === "table") {
      const t = doc.tables.find((x) => x.id === m.id);
      if (!t) continue;
      shift(t);
      for (const seat of doc.seats) if (seat.tableId === t.id) shift(seat);
    }
    if (m.kind === "strip") doc.strips.filter((x) => x.id === m.id).forEach(shift);
    if (m.kind === "device") doc.devices.filter((x) => x.id === m.id).forEach(shift);
    if (m.kind === "zone") doc.zones.filter((x) => x.id === m.id).forEach(shift);
  }
}


// ----- disconnect everything -----

/** Forget hand-drawn routes for the given cable keys. */
const dropRoutes = (doc: EventDoc, keys: string[]) => {
  for (const k of keys) delete doc.routes[k];
};

/** Unplugs a switch or router from its seats, uplinks, wall jack and power. Returns how many connections went. */
export function disconnectDevice(doc: EventDoc, id: string): number {
  const dev = doc.devices.find((d) => d.id === id);
  if (!dev) return 0;
  let n = 0;
  const keys: string[] = [];
  for (const s of doc.seats) {
    if (s.netDeviceId === id) {
      s.netDeviceId = null;
      s.netPort = null;
      keys.push(`eth:${s.id}`);
      n++;
    }
  }
  const gone = doc.uplinks.filter((u) => u.fromDeviceId === id || u.toDeviceId === id);
  for (const u of gone) keys.push(`eth:${u.id}`);
  n += gone.length;
  doc.uplinks = doc.uplinks.filter((u) => !gone.includes(u));
  if (dev.jackId) {
    dev.jackId = null;
    keys.push(`eth:jack-${id}`);
    n++;
  }
  if (dev.pluggedInto) {
    dev.pluggedInto = null;
    keys.push(`pwr:dev:${id}`);
    n++;
  }
  dropRoutes(doc, keys);
  return n;
}

/** Unplugs a power strip from its outlet, from its seats, and anything chained to it. */
export function disconnectStrip(doc: EventDoc, id: string): number {
  const strip = doc.strips.find((s) => s.id === id);
  if (!strip) return 0;
  let n = 0;
  const keys: string[] = [];
  if (strip.pluggedInto) {
    strip.pluggedInto = null;
    keys.push(`pwr:strip:${id}`);
    n++;
  }
  for (const s of doc.seats) {
    if (s.stripId === id) {
      s.stripId = null;
      n++;
    }
  }
  for (const other of doc.strips) {
    if (other.pluggedInto?.kind === "strip" && other.pluggedInto.id === id) {
      other.pluggedInto = null;
      keys.push(`pwr:strip:${other.id}`);
      n++;
    }
  }
  for (const d of doc.devices) {
    if (d.pluggedInto?.kind === "strip" && d.pluggedInto.id === id) {
      d.pluggedInto = null;
      keys.push(`pwr:dev:${d.id}`);
      n++;
    }
  }
  dropRoutes(doc, keys);
  return n;
}

/** Unplugs everything from a wall outlet: strips, devices and extension cords. */
export function disconnectOutlet(doc: EventDoc, outletId: string): number {
  let n = 0;
  const keys: string[] = [];
  for (const s of doc.strips) {
    if (s.pluggedInto?.kind === "outlet" && s.pluggedInto.id === outletId) {
      s.pluggedInto = null;
      keys.push(`pwr:strip:${s.id}`);
      n++;
    }
  }
  for (const d of doc.devices) {
    if (d.pluggedInto?.kind === "outlet" && d.pluggedInto.id === outletId) {
      d.pluggedInto = null;
      keys.push(`pwr:dev:${d.id}`);
      n++;
    }
  }
  for (const c of doc.cords) {
    if (c.outletId === outletId) {
      c.outletId = null;
      keys.push(`pwr:cord:${c.id}`);
      n++;
    }
  }
  dropRoutes(doc, keys);
  return n;
}


// ----- copy, paste and rotate -----

export type ObjectSnapshot =
  | { kind: "table"; table: Table }
  | { kind: "strip"; strip: Strip }
  | { kind: "device"; device: InfraDevice }
  | { kind: "zone"; zone: Zone };

/** A detached copy of an object, so it can be pasted later even if the original is deleted. */
export function snapshotObject(doc: EventDoc, sel: { kind: string; id: string }): ObjectSnapshot | null {
  const grab = <T>(list: T[], pick: (x: T) => boolean) => {
    const item = list.find(pick);
    return item ? structuredClone(item) : null;
  };
  if (sel.kind === "table") {
    const table = grab(doc.tables, (x) => x.id === sel.id);
    return table && { kind: "table", table };
  }
  if (sel.kind === "strip") {
    const strip = grab(doc.strips, (x) => x.id === sel.id);
    return strip && { kind: "strip", strip };
  }
  if (sel.kind === "device") {
    const device = grab(doc.devices, (x) => x.id === sel.id);
    return device && { kind: "device", device };
  }
  if (sel.kind === "zone") {
    const zone = grab(doc.zones, (x) => x.id === sel.id);
    return zone && { kind: "zone", zone };
  }
  return null;
}

const copyLabel = (label: string, fallback: string) => `${label || fallback} copy`;

/**
 * Adds a copy of a snapshot centred on a point. Copies start disconnected: a table gets fresh chairs
 * with no guests or wiring, strips and switches are unplugged.
 */
export function pasteObject(doc: EventDoc, snap: ObjectSnapshot, at: Point): { kind: ObjectSnapshot["kind"]; id: string } {
  if (snap.kind === "table") {
    const id = newId("table");
    const table: Table = { ...structuredClone(snap.table), id, x: at.x, y: at.y, label: copyLabel(snap.table.label, "Table") };
    doc.tables.push(table);
    doc.seats.push(...reconcileSeats(table, []));
    return { kind: "table", id };
  }
  if (snap.kind === "strip") {
    const id = newId("strip");
    doc.strips.push({ ...structuredClone(snap.strip), id, x: at.x, y: at.y, label: copyLabel(snap.strip.label, "Strip"), pluggedInto: null });
    return { kind: "strip", id };
  }
  if (snap.kind === "device") {
    const id = newId("dev");
    doc.devices.push({ ...structuredClone(snap.device), id, x: at.x, y: at.y, label: copyLabel(snap.device.label, "Device"), jackId: null, pluggedInto: null });
    return { kind: "device", id };
  }
  const id = newId("zone");
  doc.zones.push({ ...structuredClone(snap.zone), id, x: at.x, y: at.y, label: copyLabel(snap.zone.label, "Zone") });
  return { kind: "zone", id };
}

/** Quarter turn clockwise. A table's chairs follow it. */
export function rotateObject(doc: EventDoc, sel: { kind: string; id: string }) {
  const next = (deg: number) => (((Math.round(deg) + 90) % 360) + 360) % 360;
  if (sel.kind === "table") {
    const t = doc.tables.find((x) => x.id === sel.id);
    if (t) resizeTable(doc, t.id, { rotation: next(t.rotation) });
    return;
  }
  const list = sel.kind === "strip" ? doc.strips : sel.kind === "device" ? doc.devices : sel.kind === "zone" ? doc.zones : [];
  const item = (list as { id: string; rotation: number }[]).find((x) => x.id === sel.id);
  if (item) item.rotation = next(item.rotation);
}


/** Removes one cable: unplugs that connection and forgets its drawn route. Returns false for an unknown key. */
export function deleteCable(doc: EventDoc, key: string): boolean {
  const [kind, ...rest] = key.split(":");
  const id = rest.join(":");
  let done = false;
  if (kind === "eth") {
    const seat = doc.seats.find((s) => s.id === id);
    if (seat?.netDeviceId) {
      seat.netDeviceId = null;
      seat.netPort = null;
      done = true;
    }
    if (doc.uplinks.some((u) => u.id === id)) {
      doc.uplinks = doc.uplinks.filter((u) => u.id !== id);
      done = true;
    }
    const jacked = doc.devices.find((d) => `jack-${d.id}` === id);
    if (jacked?.jackId) {
      jacked.jackId = null;
      done = true;
    }
  } else if (kind === "pwr") {
    const [what, ...more] = id.split(":");
    const target = more.join(":");
    if (what === "strip") {
      const s = doc.strips.find((x) => x.id === target);
      if (s?.pluggedInto) {
        s.pluggedInto = null;
        done = true;
      }
    } else if (what === "dev") {
      const d = doc.devices.find((x) => x.id === target);
      if (d?.pluggedInto) {
        d.pluggedInto = null;
        done = true;
      }
    } else if (what === "seat") {
      const seat = doc.seats.find((x) => x.id === target);
      if (seat?.stripId) {
        seat.stripId = null;
        done = true;
      }
    } else if (what === "cord" && doc.cords.some((c) => c.id === target)) {
      removeCord(doc, target);
      done = true;
    }
  }
  if (done) delete doc.routes[key];
  return done;
}
