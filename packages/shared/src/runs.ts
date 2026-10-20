import { planCable, shoppingList, type ShoppingLine } from "./cables";
import type { EventDoc, Point, VenueDoc } from "./schema";

export interface Run {
  id: string;
  from: string;
  to: string;
  lengthFt: number;
}

const name = (label: string | undefined, id: string) => label || id;

export function ethernetRuns(event: EventDoc): Run[] {
  const devices = new Map(event.devices.map((d) => [d.id, d]));
  const runs: Run[] = [];
  for (const seat of event.seats) {
    const target = seat.netDeviceId ? devices.get(seat.netDeviceId) : undefined;
    if (!target) continue;
    runs.push({
      id: seat.id,
      from: name(seat.label, seat.id),
      to: name(target.label, target.id),
      lengthFt: seat.cableOverrideFt ?? planCable(seat, target).lengthFt,
    });
  }
  for (const uplink of event.uplinks) {
    const a = devices.get(uplink.fromDeviceId);
    const b = devices.get(uplink.toDeviceId);
    if (!a || !b) continue;
    runs.push({
      id: uplink.id,
      from: name(a.label, a.id),
      to: name(b.label, b.id),
      lengthFt: uplink.overrideFt ?? planCable(a, b).lengthFt,
    });
  }
  return runs;
}

export interface CordRun {
  id: string;
  label: string;
  lengthFt: number;
}

/** Cords run from their outlet to the first strip or device plugged into them. */
export function cordRuns(venue: VenueDoc, event: EventDoc): CordRun[] {
  const outlets = new Map(venue.outlets.map((o) => [o.id, o]));
  return event.cords.map((cord) => {
    const outlet = cord.outletId ? outlets.get(cord.outletId) : undefined;
    const feeds: Point[] = [
      ...event.strips.filter((s) => s.pluggedInto?.kind === "cord" && s.pluggedInto.id === cord.id),
      ...event.devices.filter((d) => d.pluggedInto?.kind === "cord" && d.pluggedInto.id === cord.id),
    ];
    const end = feeds[0];
    const lengthFt =
      cord.overrideFt ?? (outlet && end ? planCable(outlet, end).lengthFt : 0);
    return { id: cord.id, label: name(cord.label, cord.id), lengthFt };
  });
}

export interface ShoppingSummary {
  ethernet: ShoppingLine[];
  cords: ShoppingLine[];
  strips: number;
}

const asCables = (runs: { lengthFt: number }[]) =>
  runs.filter((r) => r.lengthFt > 0).map((r) => ({ estimatedFt: r.lengthFt, lengthFt: r.lengthFt }));

export function shoppingSummary(venue: VenueDoc, event: EventDoc): ShoppingSummary {
  return {
    ethernet: shoppingList(asCables(ethernetRuns(event))),
    cords: shoppingList(asCables(cordRuns(venue, event))),
    strips: event.strips.length,
  };
}
