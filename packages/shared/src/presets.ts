import { z } from "zod";
import { Id } from "./schema";

export const TableSpec = z.object({
  shape: z.enum(["rect", "round"]).default("rect"),
  width: z.number().positive(),
  depth: z.number().positive(),
  /** Seats per long side (rect) or total seats (round). */
  seats: z.number().int().nonnegative(),
  seatWidthIn: z.number().positive().default(36),
  seatSides: z.enum(["both", "far", "near"]).default("both"),
});
export type TableSpec = z.infer<typeof TableSpec>;

export const StripSpec = z.object({
  sockets: z.number().int().positive(),
  amps: z.number().positive(),
});
export type StripSpec = z.infer<typeof StripSpec>;

const tablePreset = { kind: z.literal("table"), name: z.string().min(1), spec: TableSpec };
const stripPreset = { kind: z.literal("strip"), name: z.string().min(1), spec: StripSpec };

/** A named table or power strip the user saved for reuse. Switches are device profiles. */
export const Preset = z.discriminatedUnion("kind", [
  z.object({ id: Id, ...tablePreset }),
  z.object({ id: Id, ...stripPreset }),
]);
export type Preset = z.infer<typeof Preset>;

export const PresetBody = z.discriminatedUnion("kind", [z.object(tablePreset), z.object(stripPreset)]);
export type PresetBody = z.infer<typeof PresetBody>;

export const BUILTIN_STRIP_PRESETS: { id: string; name: string; spec: StripSpec }[] = [
  { id: "strip-6", name: "6 outlet strip", spec: { sockets: 6, amps: 15 } },
  { id: "strip-8", name: "8 outlet strip", spec: { sockets: 8, amps: 15 } },
  { id: "strip-12", name: "12 outlet power bar (20A)", spec: { sockets: 12, amps: 20 } },
];
