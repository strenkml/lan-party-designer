import type { EventDoc, Point, VenueDoc } from "./schema";

export interface CableConnection {
  /** Same key the event's routes use. */
  key: string;
  kind: "ethernet" | "power";
  fromName: string;
  toName: string;
  from: Point;
  to: Point;
  /** Hand-drawn bend points between the two ends. */
  waypoints: Point[];
}

const name = (label: string | undefined, id: string) => label || id;

/** Every ethernet and power cable that can be drawn around furniture, with its current route. */
export function cableConnections(venue: VenueDoc, event: EventDoc): CableConnection[] {
  const out: CableConnection[] = [];
  const devices = new Map(event.devices.map((d) => [d.id, d]));
  const strips = new Map(event.strips.map((s) => [s.id, s]));
  const outlets = new Map(venue.outlets.map((o) => [o.id, o]));
  const jacks = new Map(venue.jacks.map((j) => [j.id, j]));
  const add = (key: string, kind: CableConnection["kind"], a: { label?: string; id: string } & Point, b: { label?: string; id: string } & Point) =>
    out.push({
      key,
      kind,
      fromName: name(a.label, a.id),
      toName: name(b.label, b.id),
      from: { x: a.x, y: a.y },
      to: { x: b.x, y: b.y },
      waypoints: event.routes[key] ?? [],
    });

  for (const seat of event.seats) {
    const d = seat.netDeviceId ? devices.get(seat.netDeviceId) : undefined;
    if (d) add(`eth:${seat.id}`, "ethernet", seat, d);
  }
  for (const u of event.uplinks) {
    const a = devices.get(u.fromDeviceId);
    const b = devices.get(u.toDeviceId);
    if (a && b) add(`eth:${u.id}`, "ethernet", a, b);
  }
  for (const d of event.devices) {
    const jack = d.jackId ? jacks.get(d.jackId) : undefined;
    if (jack) add(`eth:jack-${d.id}`, "ethernet", d, jack);
  }

  const powerTarget = (p: { kind: string; id: string } | null) =>
    p?.kind === "outlet" ? outlets.get(p.id) : p?.kind === "strip" ? strips.get(p.id) : undefined;
  for (const s of event.strips) {
    const t = powerTarget(s.pluggedInto);
    if (t) add(`pwr:strip:${s.id}`, "power", s, t);
  }
  for (const d of event.devices) {
    const t = powerTarget(d.pluggedInto);
    if (t) add(`pwr:dev:${d.id}`, "power", d, t);
  }
  for (const c of event.cords) {
    const outlet = c.outletId ? outlets.get(c.outletId) : undefined;
    const feed = [...event.strips, ...event.devices].find((x) => x.pluggedInto?.kind === "cord" && x.pluggedInto.id === c.id);
    if (outlet && feed) add(`pwr:cord:${c.id}`, "power", { ...outlet, label: c.label, id: c.id }, feed);
  }
  return out;
}
