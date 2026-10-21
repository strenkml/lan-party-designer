import type { Level } from "./power";
import type { EventDoc } from "./schema";

/** What a wired seat can pull at most, before its switch's port speed is taken into account. */
export const SEAT_LINK_MBPS = 1000;
const WARN_OVERSUBSCRIPTION = 10;
const DANGER_OVERSUBSCRIPTION = 30;
const THIN_INTERNET_MBPS_PER_SEAT = 25;
const VERY_THIN_INTERNET_MBPS_PER_SEAT = 5;

export interface UplinkLoad {
  id: string;
  upstream: string;
  downstream: string;
  /** Wired seats on the downstream side, including switches chained below it. */
  seats: number;
  demandMbps: number;
  capacityMbps: number;
  /** Capacity divided among the seats if all pull at once. */
  perSeatMbps: number;
  level: Level;
}

export interface InternetShare {
  internetMbps: number;
  seats: number;
  perSeatMbps: number;
}

export interface NetworkWarning {
  level: Level;
  message: string;
}

export interface NetworkLoad {
  uplinks: UplinkLoad[];
  internet: InternetShare | null;
  warnings: NetworkWarning[];
}

const mbps = (n: number) => (n >= 1000 ? `${+(n / 1000).toFixed(1)} Gbps` : `${Math.round(n)} Mbps`);

/**
 * How many seats share each uplink and the internet connection. The side of an uplink nearer the wall jack
 * (or a router, or failing both the switch with most seats) is upstream.
 * `profileKinds` maps profile ids to their kind so routers can be spotted.
 */
export function networkLoad(event: EventDoc, profileKinds: Map<string, string> = new Map()): NetworkLoad {
  const devices = new Map(event.devices.map((d) => [d.id, d]));
  const name = (id: string) => devices.get(id)?.label || id;
  const seatsOn = new Map<string, number>();
  const demandOn = new Map<string, number>();
  for (const s of event.seats) {
    const dev = s.netDeviceId ? devices.get(s.netDeviceId) : undefined;
    if (!dev) continue;
    seatsOn.set(dev.id, (seatsOn.get(dev.id) ?? 0) + 1);
    demandOn.set(dev.id, (demandOn.get(dev.id) ?? 0) + Math.min(SEAT_LINK_MBPS, dev.portMbps));
  }

  const links = event.uplinks.filter((u) => devices.has(u.fromDeviceId) && devices.has(u.toDeviceId));
  const neighbours = new Map<string, { link: (typeof links)[number]; other: string }[]>();
  for (const l of links) {
    neighbours.set(l.fromDeviceId, [...(neighbours.get(l.fromDeviceId) ?? []), { link: l, other: l.toDeviceId }]);
    neighbours.set(l.toDeviceId, [...(neighbours.get(l.toDeviceId) ?? []), { link: l, other: l.fromDeviceId }]);
  }

  // connected components of switches
  const seen = new Set<string>();
  const parentLink = new Map<string, { id: string; parent: string }>();
  const order: string[] = [];
  for (const start of event.devices) {
    if (seen.has(start.id)) continue;
    const comp: string[] = [];
    const queue = [start.id];
    seen.add(start.id);
    while (queue.length) {
      const id = queue.shift()!;
      comp.push(id);
      for (const n of neighbours.get(id) ?? []) if (!seen.has(n.other)) { seen.add(n.other); queue.push(n.other); }
    }
    const pick = (f: (id: string) => boolean) => comp.find(f);
    const root =
      pick((id) => !!devices.get(id)!.jackId) ??
      pick((id) => profileKinds.get(devices.get(id)!.profileId) === "router") ??
      comp.reduce((best, id) => ((seatsOn.get(id) ?? 0) > (seatsOn.get(best) ?? 0) ? id : best), comp[0]!);

    const visited = new Set([root]);
    const bfs = [root];
    while (bfs.length) {
      const id = bfs.shift()!;
      order.push(id);
      for (const n of neighbours.get(id) ?? []) {
        if (visited.has(n.other)) continue;
        visited.add(n.other);
        parentLink.set(n.other, { id: n.link.id, parent: id });
        bfs.push(n.other);
      }
    }
  }

  // add each device's totals into its parent, deepest first
  const subSeats = new Map(seatsOn);
  const subDemand = new Map(demandOn);
  for (const id of [...order].reverse()) {
    const p = parentLink.get(id);
    if (!p) continue;
    subSeats.set(p.parent, (subSeats.get(p.parent) ?? 0) + (subSeats.get(id) ?? 0));
    subDemand.set(p.parent, (subDemand.get(p.parent) ?? 0) + (subDemand.get(id) ?? 0));
  }

  const warnings: NetworkWarning[] = [];
  const uplinks: UplinkLoad[] = [];
  for (const [child, p] of parentLink) {
    const link = links.find((l) => l.id === p.id)!;
    const seats = subSeats.get(child) ?? 0;
    const demandMbps = subDemand.get(child) ?? 0;
    const capacityMbps = link.mbps ?? Math.min(devices.get(link.fromDeviceId)!.portMbps, devices.get(link.toDeviceId)!.portMbps);
    const ratio = demandMbps / capacityMbps;
    const level: Level = ratio > DANGER_OVERSUBSCRIPTION ? "danger" : ratio > WARN_OVERSUBSCRIPTION ? "warn" : "ok";
    const perSeatMbps = capacityMbps / Math.max(seats, 1);
    uplinks.push({ id: link.id, upstream: name(p.parent), downstream: name(child), seats, demandMbps, capacityMbps, perSeatMbps, level });
    if (level !== "ok") {
      warnings.push({
        level,
        message: `${seats} seats behind ${name(child)} share a ${mbps(capacityMbps)} link to ${name(p.parent)}, about ${mbps(perSeatMbps)} each if all are busy`,
      });
    }
  }

  const wired = event.seats.filter((s) => s.netDeviceId && devices.has(s.netDeviceId)).length;
  let internet: InternetShare | null = null;
  const speed = event.settings.internetMbps;
  if (speed && wired > 0) {
    internet = { internetMbps: speed, seats: wired, perSeatMbps: speed / wired };
    if (internet.perSeatMbps < THIN_INTERNET_MBPS_PER_SEAT) {
      warnings.push({
        level: internet.perSeatMbps < VERY_THIN_INTERNET_MBPS_PER_SEAT ? "danger" : "warn",
        message: `A ${mbps(speed)} internet connection leaves about ${mbps(internet.perSeatMbps)} for each of ${wired} seats. Game downloads will crawl. Consider a LAN cache (such as LANcache) on a server, or have everyone pre-download.`,
      });
    }
  }
  return { uplinks, internet, warnings };
}
