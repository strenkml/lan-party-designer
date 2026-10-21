import { computePowerLoad, isCounted, type PowerInputs } from "./power";
import { VOLTAGE, type EventDoc, type Point } from "./schema";

export interface Unplaced {
  seatId: string;
  kind: "power" | "network";
  reason: string;
}

export interface AutoWireResult {
  event: EventDoc;
  unplaced: Unplaced[];
}

const NEAR_LIMIT = 0.8;
const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Fills in missing wiring: each unwired seat gets the nearest strip with room
 * and the nearest switch with a free port, whether or not a guest is seated there.
 * An empty seat reserves one socket and one port. Existing assignments are never changed.
 */
export function autoWire(inputs: PowerInputs): AutoWireResult {
  const { event, people, profiles } = inputs;
  const report = computePowerLoad(inputs);
  const unplaced: Unplaced[] = [];
  const seats = event.seats.map((s) => ({ ...s }));

  // Power: nearest strip with free sockets and headroom under 80% typical.
  const stripState = new Map<string, { sockets: number; typicalW: number }>(
    event.strips.map((strip) => {
      const r = report.strips.find((x) => x.id === strip.id)!;
      return [strip.id, { sockets: r.socketsTotal - r.socketsUsed, typicalW: r.typicalW }];
    }),
  );
  for (const seat of seats) {
    const load = report.seatLoads[seat.id];
    if (seat.stripId || !load) continue;
    // A seat with no devices still gets a socket reserved.
    const sockets = Math.max(load.deviceCount, 1);
    const candidates = event.strips
      .filter((strip) => {
        const state = stripState.get(strip.id)!;
        return (
          state.sockets >= sockets &&
          (state.typicalW + load.typicalW) / VOLTAGE <= strip.amps * NEAR_LIMIT
        );
      })
      .sort((a, b) => dist(seat, a) - dist(seat, b));
    const pick = candidates[0];
    if (!pick) {
      unplaced.push({ seatId: seat.id, kind: "power", reason: "No strip with free sockets and capacity" });
      continue;
    }
    seat.stripId = pick.id;
    const state = stripState.get(pick.id)!;
    state.sockets -= sockets;
    state.typicalW += load.typicalW;
  }

  // Network: nearest switch with a free port, lowest port number first.
  const profileById = new Map(profiles.map((p) => [p.id, p]));
  const personById = new Map(people.map((p) => [p.id, p]));
  const switches = event.devices
    .map((d) => ({ device: d, ports: d.ports ?? profileById.get(d.profileId)?.ports ?? 0 }))
    .filter((s) => s.ports > 0)
    .map(({ device, ports }) => {
      const uplinks = event.uplinks.filter(
        (u) => u.fromDeviceId === device.id || u.toDeviceId === device.id,
      ).length;
      const taken = new Set(
        seats.filter((s) => s.netDeviceId === device.id && s.netPort !== null).map((s) => s.netPort!),
      );
      return { device, capacity: Math.max(ports - uplinks, 0), taken };
    });

  const needsEthernet = new Map<string, boolean>();
  for (const a of event.attendance) {
    if (!a.seatId || !isCounted(a.rsvp, event.settings.rsvpMode)) continue;
    const person = personById.get(a.personId);
    if (person) needsEthernet.set(a.seatId, a.needsEthernet ?? person.needsEthernet);
  }

  for (const seat of seats) {
    // Only a seated guest who opted out skips the network. Empty seats are wired.
    if (seat.netDeviceId || needsEthernet.get(seat.id) === false) continue;
    const open = switches
      .map((s) => {
        let port = 0;
        while (port < s.capacity && s.taken.has(port)) port++;
        return { s, port };
      })
      .filter(({ s, port }) => port < s.capacity)
      .sort((a, b) => dist(seat, a.s.device) - dist(seat, b.s.device));
    const pick = open[0];
    if (!pick) {
      unplaced.push({ seatId: seat.id, kind: "network", reason: "No switch with a free port" });
      continue;
    }
    seat.netDeviceId = pick.s.device.id;
    seat.netPort = pick.port;
    pick.s.taken.add(pick.port);
  }

  return { event: { ...event, seats }, unplaced };
}
