import {
  VOLTAGE,
  type DeviceProfile,
  type DeviceRef,
  type EventDoc,
  type Person,
  type PluggedInto,
  type Rsvp,
  type EventSettings,
  type VenueDoc,
} from "./schema";

export type Level = "ok" | "warn" | "danger";

export interface PowerInputs {
  venue: VenueDoc;
  event: EventDoc;
  people: Person[];
  profiles: DeviceProfile[];
}

export interface Watts {
  typicalW: number;
  peakW: number;
}

export interface NodeReport extends Watts {
  id: string;
  label: string;
  ratingA: number;
  typicalA: number;
  peakA: number;
  level: Level;
}

export interface StripReport extends NodeReport {
  socketsUsed: number;
  socketsTotal: number;
}

export interface OutletReport extends NodeReport {
  socketsUsed: number;
  socketsTotal: number;
}

export interface CircuitReport extends NodeReport {
  outletIds: string[];
}

export type WarningCode =
  | "overload"
  | "near-limit"
  | "sockets"
  | "daisy-chain"
  | "unverified-circuit"
  | "unplugged-strip"
  | "unpowered-seat"
  | "cycle";

export interface PowerWarning {
  level: Level;
  code: WarningCode;
  message: string;
  refId: string;
}

export interface PowerReport {
  strips: StripReport[];
  cords: NodeReport[];
  outlets: OutletReport[];
  circuits: CircuitReport[];
  /** Load on outlets whose breaker is not known. */
  unverified: Watts;
  seatLoads: Record<string, Watts & { deviceCount: number }>;
  total: Watts;
  warnings: PowerWarning[];
}

const NEAR_LIMIT = 0.8;

/** Monitor added next to a placeholder PC, matching the starter gear for a new guest. */
export const PLACEHOLDER_MONITOR_ID = "monitor-27";

/** Whether a guest with this RSVP counts toward planning under the event's mode. */
export function isCounted(rsvp: Rsvp, mode: EventSettings["rsvpMode"]): boolean {
  return rsvp === "confirmed" || (rsvp === "invited" && mode === "confirmedInvited");
}

export function levelFor(w: Watts, ratingA: number): Level {
  const peakA = w.peakW / VOLTAGE;
  const typicalA = w.typicalW / VOLTAGE;
  if (peakA > ratingA) return "danger";
  if (typicalA > ratingA * NEAR_LIMIT) return "warn";
  return "ok";
}

const ZERO: Watts = { typicalW: 0, peakW: 0 };
const add = (a: Watts, b: Watts): Watts => ({
  typicalW: a.typicalW + b.typicalW,
  peakW: a.peakW + b.peakW,
});

function refWatts(ref: DeviceRef, profiles: Map<string, DeviceProfile>): Watts {
  const profile = profiles.get(ref.profileId);
  return {
    typicalW: ref.typicalW ?? profile?.typicalW ?? 0,
    peakW: ref.peakW ?? ref.typicalW ?? profile?.peakW ?? 0,
  };
}

function nodeReport(
  id: string,
  label: string,
  ratingA: number,
  w: Watts,
): NodeReport {
  return {
    id,
    label,
    ratingA,
    ...w,
    typicalA: w.typicalW / VOLTAGE,
    peakA: w.peakW / VOLTAGE,
    level: levelFor(w, ratingA),
  };
}

const key = (kind: string, id: string) => `${kind}:${id}`;

export function computePowerLoad({ venue, event, people, profiles }: PowerInputs): PowerReport {
  const profileById = new Map(profiles.map((p) => [p.id, p]));
  const personById = new Map(people.map((p) => [p.id, p]));
  const warnings: PowerWarning[] = [];

  // Who sits where, honouring RSVP filtering.
  const sitting = new Map<string, DeviceRef[]>();
  for (const a of event.attendance) {
    if (!a.seatId || !isCounted(a.rsvp, event.settings.rsvpMode)) continue;
    const person = personById.get(a.personId);
    if (!person) continue;
    sitting.set(a.seatId, a.devices ?? person.devices);
  }

  const placeholder = event.settings.placeholderProfileId
    ? profileById.get(event.settings.placeholderProfileId)
    : undefined;
  // A placeholder PC comes with a monitor; a laptop does not.
  const placeholderGear = placeholder
    ? [placeholder, ...(placeholder.kind === "pc" ? [profileById.get(PLACEHOLDER_MONITOR_ID)] : [])].filter(
        (p): p is DeviceProfile => !!p,
      )
    : [];

  // Load per seat.
  const seatLoads: PowerReport["seatLoads"] = {};
  for (const seat of event.seats) {
    const refs = sitting.get(seat.id);
    if (refs) {
      const watts = refs.reduce((sum, r) => add(sum, refWatts(r, profileById)), ZERO);
      seatLoads[seat.id] = { ...watts, deviceCount: refs.length };
    } else if (placeholderGear.length > 0) {
      seatLoads[seat.id] = {
        typicalW: placeholderGear.reduce((n, p) => n + p.typicalW, 0),
        peakW: placeholderGear.reduce((n, p) => n + p.peakW, 0),
        deviceCount: placeholderGear.length,
      };
    } else {
      seatLoads[seat.id] = { ...ZERO, deviceCount: 0 };
    }
  }

  // Children of each power node, keyed "kind:id".
  interface Child extends Watts {
    sockets: number;
    /** Strip or cord whose own subtree must be added on top. */
    node?: string;
  }
  const children = new Map<string, Child[]>();
  const addChild = (parent: string, child: Child) => {
    const list = children.get(parent) ?? [];
    list.push(child);
    children.set(parent, list);
  };

  for (const seat of event.seats) {
    const load = seatLoads[seat.id]!;
    if (seat.stripId) {
      addChild(key("strip", seat.stripId), {
        typicalW: load.typicalW,
        peakW: load.peakW,
        sockets: load.deviceCount,
      });
    } else if (load.deviceCount > 0) {
      warnings.push({
        level: "warn",
        code: "unpowered-seat",
        message: `${seat.label || seat.id} (seat) has devices but no power strip`,
        refId: seat.id,
      });
    }
  }
  for (const device of event.devices) {
    if (!device.pluggedInto) continue;
    const w = refWatts(
      { profileId: device.profileId, typicalW: device.typicalW, peakW: device.peakW },
      profileById,
    );
    addChild(key(device.pluggedInto.kind, device.pluggedInto.id), { ...w, sockets: 1 });
  }
  for (const strip of event.strips) {
    if (strip.pluggedInto) {
      addChild(key(strip.pluggedInto.kind, strip.pluggedInto.id), {
        ...ZERO,
        sockets: 1,
        node: key("strip", strip.id),
      });
    }
  }
  for (const cord of event.cords) {
    if (cord.outletId) {
      addChild(key("outlet", cord.outletId), {
        ...ZERO,
        sockets: 1,
        node: key("cord", cord.id),
      });
    }
  }

  const memo = new Map<string, Watts>();
  const visiting = new Set<string>();
  const cyclic = new Set<string>();
  function total(nodeKey: string): Watts {
    const cached = memo.get(nodeKey);
    if (cached) return cached;
    if (visiting.has(nodeKey)) {
      cyclic.add(nodeKey);
      return ZERO;
    }
    visiting.add(nodeKey);
    let sum = ZERO;
    for (const child of children.get(nodeKey) ?? []) {
      sum = add(sum, child);
      if (child.node) sum = add(sum, total(child.node));
    }
    visiting.delete(nodeKey);
    memo.set(nodeKey, sum);
    return sum;
  }

  const socketsUsed = (nodeKey: string) =>
    (children.get(nodeKey) ?? []).reduce((n, c) => n + c.sockets, 0);

  const strips: StripReport[] = event.strips.map((strip) => {
    const k = key("strip", strip.id);
    const w = total(k);
    const report = nodeReport(strip.id, strip.label || strip.id, strip.amps, w);
    const used = socketsUsed(k);
    return { ...report, socketsUsed: used, socketsTotal: strip.sockets };
  });

  const cords = event.cords.map((cord) =>
    nodeReport(cord.id, cord.label || cord.id, cord.amps, total(key("cord", cord.id))),
  );

  const outlets: OutletReport[] = venue.outlets.map((outlet) => ({
    ...nodeReport(outlet.id, outlet.label || outlet.id, outlet.amps, total(key("outlet", outlet.id))),
    socketsUsed: socketsUsed(key("outlet", outlet.id)),
    socketsTotal: outlet.sockets,
  }));

  const circuits: CircuitReport[] = venue.circuits.map((circuit) => {
    const members = venue.outlets.filter((o) => o.circuitId === circuit.id);
    const w = members.reduce((sum, o) => add(sum, total(key("outlet", o.id))), ZERO);
    return {
      ...nodeReport(circuit.id, circuit.label, circuit.amps, w),
      outletIds: members.map((o) => o.id),
    };
  });

  const knownCircuits = new Set(venue.circuits.map((c) => c.id));
  let unverified = ZERO;
  for (const outlet of venue.outlets) {
    if (outlet.circuitId && knownCircuits.has(outlet.circuitId)) continue;
    const w = total(key("outlet", outlet.id));
    if (w.typicalW > 0 || w.peakW > 0) {
      unverified = add(unverified, w);
      warnings.push({
        level: "warn",
        code: "unverified-circuit",
        message: `${outlet.label || outlet.id} (outlet) has load but its breaker is unknown`,
        refId: outlet.id,
      });
    }
  }

  // Per-node limit warnings.
  const limitWarning = (kind: string, r: NodeReport) => {
    if (r.level === "danger") {
      warnings.push({
        level: "danger",
        code: "overload",
        message: `${r.label} (${kind}) peaks at ${r.peakA.toFixed(1)}A on a ${r.ratingA}A rating`,
        refId: r.id,
      });
    } else if (r.level === "warn") {
      warnings.push({
        level: "warn",
        code: "near-limit",
        message: `${r.label} (${kind}) draws ${r.typicalA.toFixed(1)}A, over 80% of ${r.ratingA}A`,
        refId: r.id,
      });
    }
  };
  strips.forEach((r) => limitWarning("power strip", r));
  cords.forEach((r) => limitWarning("extension cord", r));
  outlets.forEach((r) => limitWarning("outlet", r));
  circuits.forEach((r) => limitWarning("breaker", r));

  const socketCheck = (kind: string, items: { id: string; label: string; socketsUsed: number; socketsTotal: number }[]) => {
    for (const s of items) {
      if (s.socketsUsed > s.socketsTotal) {
        warnings.push({
          level: "danger",
          code: "sockets",
          message: `${s.label} (${kind}) needs ${s.socketsUsed} sockets but has ${s.socketsTotal}`,
          refId: s.id,
        });
      }
    }
  };
  socketCheck("power strip", strips);
  socketCheck("outlet", outlets);
  for (const strip of event.strips) {
    const target: PluggedInto | null = strip.pluggedInto;
    if (!target) {
      warnings.push({
        level: "warn",
        code: "unplugged-strip",
        message: `${strip.label || strip.id} (power strip) is not plugged into anything`,
        refId: strip.id,
      });
    } else if (target.kind === "strip") {
      warnings.push({
        level: "warn",
        code: "daisy-chain",
        message: `${strip.label || strip.id} (power strip) is plugged into another strip`,
        refId: strip.id,
      });
    }
  }
  for (const nodeKey of cyclic) {
    warnings.push({
      level: "danger",
      code: "cycle",
      message: `Power chain loops back on itself at ${nodeKey}`,
      refId: nodeKey.split(":")[1] ?? nodeKey,
    });
  }

  const totalLoad = Object.values(seatLoads).reduce<Watts>((s, w) => add(s, w), ZERO);
  const infra = event.devices.reduce<Watts>(
    (s, d) => add(s, refWatts({ profileId: d.profileId, typicalW: d.typicalW, peakW: d.peakW }, profileById)),
    ZERO,
  );

  return {
    strips,
    cords,
    outlets,
    circuits,
    unverified,
    seatLoads,
    total: add(totalLoad, infra),
    warnings,
  };
}
