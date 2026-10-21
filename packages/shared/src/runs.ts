import { DROP_FT_PER_END, planCable, shoppingList, type ShoppingLine } from "./cables";
import type { EventDoc, Point, VenueDoc } from "./schema";

export interface Run {
  id: string;
  /** Key for a hand-drawn route in the event's routes. */
  key: string;
  from: string;
  to: string;
  lengthFt: number;
}

const name = (label: string | undefined, id: string) => label || id;

/** Cable runs for seats, switch uplinks and, when the venue is given, wall jack uplinks. */
export function ethernetRuns(event: EventDoc, venue?: VenueDoc): Run[] {
  const devices = new Map(event.devices.map((d) => [d.id, d]));
  const runs: Run[] = [];
  for (const seat of event.seats) {
    const target = seat.netDeviceId ? devices.get(seat.netDeviceId) : undefined;
    if (!target) continue;
    const key = `eth:${seat.id}`;
    runs.push({
      id: seat.id,
      key,
      from: name(seat.label, seat.id),
      to: name(target.label, target.id),
      lengthFt: seat.cableOverrideFt ?? planCable(seat, target, { waypoints: event.routes[key] }).lengthFt,
    });
  }
  for (const uplink of event.uplinks) {
    const a = devices.get(uplink.fromDeviceId);
    const b = devices.get(uplink.toDeviceId);
    if (!a || !b) continue;
    const key = `eth:${uplink.id}`;
    runs.push({
      id: uplink.id,
      key,
      from: name(a.label, a.id),
      to: name(b.label, b.id),
      lengthFt: uplink.overrideFt ?? planCable(a, b, { waypoints: event.routes[key] }).lengthFt,
    });
  }
  const jacks = new Map((venue?.jacks ?? []).map((j) => [j.id, j]));
  for (const device of event.devices) {
    const jack = device.jackId ? jacks.get(device.jackId) : undefined;
    if (!jack) continue;
    const key = `eth:jack-${device.id}`;
    runs.push({
      id: `jack-${device.id}`,
      key,
      from: name(device.label, device.id),
      to: name(jack.label, "Wall jack"),
      lengthFt: planCable(device, jack, { waypoints: event.routes[key], toDropFt: jack.heightIn / 12 }).lengthFt,
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
      cord.overrideFt ??
      (outlet && end
        ? planCable(outlet, end, { waypoints: event.routes[`pwr:cord:${cord.id}`], fromDropFt: outlet.heightIn / 12 }).lengthFt
        : 0);
    return { id: cord.id, label: name(cord.label, cord.id), lengthFt };
  });
}

export interface PowerRun {
  id: string;
  key: string;
  from: string;
  to: string;
  lengthFt: number;
}

const STRIP_DROP_FT = 1;

/**
 * Power cables for strips and devices that plug straight into an outlet or another strip.
 * Strips fed by an extension cord are covered by the cord's own run.
 */
export function powerRuns(venue: VenueDoc, event: EventDoc): PowerRun[] {
  const outlets = new Map(venue.outlets.map((o) => [o.id, o]));
  const strips = new Map(event.strips.map((s) => [s.id, s]));
  const runs: PowerRun[] = [];
  const add = (
    item: { id: string; label: string; x: number; y: number; pluggedInto: { kind: string; id: string } | null },
    key: string,
    fromDropFt: number,
  ) => {
    const target = item.pluggedInto;
    if (!target) return;
    const outlet = target.kind === "outlet" ? outlets.get(target.id) : undefined;
    const strip = target.kind === "strip" ? strips.get(target.id) : undefined;
    const end = outlet ?? strip;
    if (!end) return;
    const toDropFt = outlet ? outlet.heightIn / 12 : STRIP_DROP_FT;
    runs.push({
      id: item.id,
      key,
      from: name(item.label, item.id),
      to: name(end.label, end.id),
      lengthFt: planCable(item, end, { waypoints: event.routes[key], fromDropFt, toDropFt }).lengthFt,
    });
  };
  for (const strip of event.strips) add(strip, `pwr:strip:${strip.id}`, STRIP_DROP_FT);
  for (const device of event.devices) add(device, `pwr:dev:${device.id}`, DROP_FT_PER_END);
  return runs;
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
    ethernet: shoppingList(asCables(ethernetRuns(event, venue))),
    cords: shoppingList(asCables(cordRuns(venue, event))),
    strips: event.strips.length,
  };
}
