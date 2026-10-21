import { z } from "zod";
import { Preset } from "./presets";
import { DeviceProfile, EventDoc, Person, VenueDoc } from "./schema";

/** Export, import and snapshot format: everything needed to rebuild one event. */
export const EventBundle = z.object({
  version: z.literal(1),
  event: z.object({ name: z.string(), date: z.string().nullable().default(null), doc: EventDoc }),
  venue: z.object({ name: z.string(), doc: VenueDoc }),
  people: z.array(Person).default([]),
  profiles: z.array(DeviceProfile).default([]),
  presets: z.array(Preset).default([]),
});
export type EventBundle = z.infer<typeof EventBundle>;
