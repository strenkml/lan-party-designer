import { z } from "zod";

export const Point = z.object({ x: z.number(), y: z.number() });
export type Point = z.infer<typeof Point>;

export const Id = z.string().min(1);

export const Rsvp = z.enum(["invited", "confirmed", "declined"]);
export type Rsvp = z.infer<typeof Rsvp>;

export const ProfileKind = z.enum([
  "pc",
  "laptop",
  "monitor",
  "console",
  "switch",
  "router",
  "server",
  "display",
  "other",
]);
export type ProfileKind = z.infer<typeof ProfileKind>;

export const DeviceProfile = z.object({
  id: Id,
  name: z.string(),
  kind: ProfileKind,
  typicalW: z.number().nonnegative(),
  peakW: z.number().nonnegative(),
  ports: z.number().int().nonnegative().default(0),
});
export type DeviceProfile = z.infer<typeof DeviceProfile>;

/** A device referenced from a profile, with optional wattage overrides. */
export const DeviceRef = z.object({
  profileId: Id,
  typicalW: z.number().nonnegative().optional(),
  peakW: z.number().nonnegative().optional(),
});
export type DeviceRef = z.infer<typeof DeviceRef>;

export const Person = z.object({
  id: Id,
  name: z.string(),
  handle: z.string().default(""),
  devices: z.array(DeviceRef).default([]),
  needsEthernet: z.boolean().default(true),
  notes: z.string().default(""),
});
export type Person = z.infer<typeof Person>;

// ---------- Venue ----------

export const Circuit = z.object({
  id: Id,
  label: z.string(),
  amps: z.union([z.literal(15), z.literal(20)]).default(15),
});
export type Circuit = z.infer<typeof Circuit>;

export const Outlet = z.object({
  id: Id,
  label: z.string().default(""),
  x: z.number(),
  y: z.number(),
  /** Null means the breaker is not known yet. */
  circuitId: Id.nullable().default(null),
  amps: z.number().positive().default(15),
  /** Plugs on this outlet. A standard duplex has 2. */
  sockets: z.number().int().positive().default(2),
  /** Height of the outlet above the floor, in inches. Cables drop this far at the wall end. */
  heightIn: z.number().nonnegative().default(12),
});
export type Outlet = z.infer<typeof Outlet>;

export const Door = z.object({
  id: Id,
  x: z.number(),
  y: z.number(),
  width: z.number().positive().default(3),
  rotation: z.number().default(0),
  /** Swing out of the room instead of into it. */
  flipSwing: z.boolean().default(false),
  /** Hinge on the other side of the opening. */
  flipHinge: z.boolean().default(false),
});
export type Door = z.infer<typeof Door>;

/** An ethernet wall plate. A switch or router can uplink to it. */
export const NetworkJack = z.object({
  id: Id,
  label: z.string().default(""),
  x: z.number(),
  y: z.number(),
  rotation: z.number().default(0),
  /** Height above the floor, in inches. */
  heightIn: z.number().nonnegative().default(12),
});
export type NetworkJack = z.infer<typeof NetworkJack>;

/** Cut into a wall like a door, but it does not swing. */
export const WallWindow = z.object({
  id: Id,
  x: z.number(),
  y: z.number(),
  width: z.number().positive().default(4),
  rotation: z.number().default(0),
});
export type WallWindow = z.infer<typeof WallWindow>;

export const GarageDoor = z.object({
  id: Id,
  x: z.number(),
  y: z.number(),
  /** 9 ft is a single car door, 16 ft a double. */
  width: z.number().positive().default(9),
  rotation: z.number().default(0),
});
export type GarageDoor = z.infer<typeof GarageDoor>;

export const Obstacle = z.object({
  id: Id,
  label: z.string().default(""),
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  depth: z.number().positive(),
  rotation: z.number().default(0),
});
export type Obstacle = z.infer<typeof Obstacle>;

export const Background = z.object({
  /** File name under the uploads directory. */
  file: z.string(),
  x: z.number().default(0),
  y: z.number().default(0),
  /** Real feet represented by one image pixel. */
  feetPerPixel: z.number().positive(),
  opacity: z.number().min(0).max(1).default(0.5),
});
export type Background = z.infer<typeof Background>;

export const VenueDoc = z.object({
  room: z.array(Point).default([]),
  doors: z.array(Door).default([]),
  windows: z.array(WallWindow).default([]),
  garageDoors: z.array(GarageDoor).default([]),
  obstacles: z.array(Obstacle).default([]),
  outlets: z.array(Outlet).default([]),
  jacks: z.array(NetworkJack).default([]),
  circuits: z.array(Circuit).default([]),
  background: Background.nullable().default(null),
});
export type VenueDoc = z.infer<typeof VenueDoc>;

// ---------- Event ----------

export const Table = z.object({
  id: Id,
  label: z.string().default(""),
  shape: z.enum(["rect", "round"]).default("rect"),
  x: z.number(),
  y: z.number(),
  /** Length along the table's x axis (diameter for round tables). */
  width: z.number().positive(),
  depth: z.number().positive(),
  rotation: z.number().default(0),
  /** Seats per long side (rect) or total seats (round). */
  seats: z.number().int().nonnegative(),
  seatWidthIn: z.number().positive().default(36),
  /** Which long edges get seats. "far" is the top edge before rotation, "near" the bottom. Round tables ignore this. */
  seatSides: z.enum(["both", "far", "near"]).default("both"),
});
export type Table = z.infer<typeof Table>;

export const PluggedInto = z.object({
  kind: z.enum(["outlet", "cord", "strip"]),
  id: Id,
});
export type PluggedInto = z.infer<typeof PluggedInto>;

export const Seat = z.object({
  id: Id,
  tableId: Id.nullable().default(null),
  label: z.string().default(""),
  x: z.number(),
  y: z.number(),
  rotation: z.number().default(0),
  /** Seat was dragged by hand, so table layout changes leave it alone. */
  manual: z.boolean().default(false),
  stripId: Id.nullable().default(null),
  netDeviceId: Id.nullable().default(null),
  netPort: z.number().int().nonnegative().nullable().default(null),
  cableOverrideFt: z.number().positive().nullable().default(null),
});
export type Seat = z.infer<typeof Seat>;

export const Strip = z.object({
  id: Id,
  label: z.string().default(""),
  x: z.number(),
  y: z.number(),
  sockets: z.number().int().positive().default(6),
  amps: z.number().positive().default(15),
  rotation: z.number().default(0),
  pluggedInto: PluggedInto.nullable().default(null),
});
export type Strip = z.infer<typeof Strip>;

export const Cord = z.object({
  id: Id,
  label: z.string().default(""),
  gauge: z.number().int().default(14),
  amps: z.number().positive().default(15),
  outletId: Id.nullable().default(null),
  overrideFt: z.number().positive().nullable().default(null),
});
export type Cord = z.infer<typeof Cord>;

/** Infrastructure device: switch, router, server, TV. */
export const InfraDevice = z.object({
  id: Id,
  label: z.string().default(""),
  profileId: Id,
  x: z.number(),
  y: z.number(),
  typicalW: z.number().nonnegative().optional(),
  peakW: z.number().nonnegative().optional(),
  /** Overrides the profile's port count. */
  ports: z.number().int().nonnegative().optional(),
  rotation: z.number().default(0),
  /** Wall jack this device uplinks to, if any. */
  jackId: Id.nullable().default(null),
  /** Speed of each port in Mbps. */
  portMbps: z.number().positive().default(1000),
  pluggedInto: PluggedInto.nullable().default(null),
});
export type InfraDevice = z.infer<typeof InfraDevice>;

export const Uplink = z.object({
  id: Id,
  fromDeviceId: Id,
  toDeviceId: Id,
  overrideFt: z.number().positive().nullable().default(null),
  /** Link speed in Mbps. Null means the slower of the two devices' port speeds. */
  mbps: z.number().positive().nullable().default(null),
});
export type Uplink = z.infer<typeof Uplink>;

export const Attendance = z.object({
  personId: Id,
  rsvp: Rsvp.default("invited"),
  seatId: Id.nullable().default(null),
  /** Replaces the person's default devices for this event. */
  devices: z.array(DeviceRef).optional(),
  needsEthernet: z.boolean().optional(),
});
export type Attendance = z.infer<typeof Attendance>;

export const ZoneKind = z.enum(["walkway", "food", "storage", "stage", "other"]);
export type ZoneKind = z.infer<typeof ZoneKind>;

/** A marked-out area of the room, like a walkway to keep clear or a food table. */
export const Zone = z.object({
  id: Id,
  label: z.string().default(""),
  kind: ZoneKind.default("other"),
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  depth: z.number().positive(),
  rotation: z.number().default(0),
});
export type Zone = z.infer<typeof Zone>;

export const GroupMember = z.object({
  kind: z.enum(["table", "strip", "device", "zone"]),
  id: Id,
});
export type GroupMember = z.infer<typeof GroupMember>;

/** Objects that move together, like a table with its power strip and switch. */
export const ObjectGroup = z.object({
  id: Id,
  label: z.string().default(""),
  members: z.array(GroupMember).default([]),
});
export type ObjectGroup = z.infer<typeof ObjectGroup>;

export const ChecklistItem = z.object({
  power: z.boolean().default(false),
  ethernet: z.boolean().default(false),
  tested: z.boolean().default(false),
  note: z.string().default(""),
});
export type ChecklistItem = z.infer<typeof ChecklistItem>;

/** Cables and gear already on hand, so they come off the shopping list. Cable maps are keyed by length in feet. */
export const OwnedGear = z.object({
  ethernet: z.record(z.string(), z.number().int().nonnegative()).default({}),
  cords: z.record(z.string(), z.number().int().nonnegative()).default({}),
  strips: z.number().int().nonnegative().default(0),
  switches: z.number().int().nonnegative().default(0),
});
export type OwnedGear = z.infer<typeof OwnedGear>;

export const EventSettings = z.object({
  rsvpMode: z.enum(["confirmed", "confirmedInvited"]).default("confirmedInvited"),
  /** Profile used to fill empty seats for worst-case planning. */
  placeholderProfileId: Id.nullable().default(null),
  owned: OwnedGear.default(OwnedGear.parse({})),
  /** Speed of the internet connection in Mbps, if known. */
  internetMbps: z.number().positive().nullable().default(null),
});
export type EventSettings = z.infer<typeof EventSettings>;

export const EventDoc = z.object({
  tables: z.array(Table).default([]),
  zones: z.array(Zone).default([]),
  groups: z.array(ObjectGroup).default([]),
  seats: z.array(Seat).default([]),
  strips: z.array(Strip).default([]),
  cords: z.array(Cord).default([]),
  devices: z.array(InfraDevice).default([]),
  uplinks: z.array(Uplink).default([]),
  attendance: z.array(Attendance).default([]),
  checklist: z.record(z.string(), ChecklistItem).default({}),
  /** Bend points for hand-routed cables, keyed like "eth:<seat id>" or "pwr:strip:<strip id>". */
  routes: z.record(z.string(), z.array(Point)).default({}),
  settings: EventSettings.default(EventSettings.parse({})),
});
export type EventDoc = z.infer<typeof EventDoc>;

export const VOLTAGE = 120;
