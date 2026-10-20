import {
  layoutSeats,
  reconcileSeats,
  seatsPerSideFor,
  type DeviceProfile,
  type EventDoc,
  type Person,
  type Point,
  type Table,
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

/** Mutates the draft: table plus its seats. */
export function addTable(doc: EventDoc, presetId: string, at: Point, id: string) {
  const preset = TABLE_PRESETS.find((p) => p.id === presetId) ?? TABLE_PRESETS[0]!;
  const table: Table = {
    id,
    label: `Table ${doc.tables.length + 1}`,
    shape: preset.shape,
    x: at.x,
    y: at.y,
    width: preset.width,
    depth: preset.depth,
    rotation: 0,
    seats: preset.shape === "round" ? 6 : seatsPerSideFor(preset.width),
    seatWidthIn: 36,
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
