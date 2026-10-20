import { createContext, useContext } from "react";
import type { DeviceProfile, EventDoc, Person, PowerReport, VenueDoc } from "@lpd/shared";

export interface EventCtx {
  eventId: string;
  venue: VenueDoc;
  people: Person[];
  profiles: DeviceProfile[];
  doc: EventDoc;
  report: PowerReport;
  /** Seat id to a short guest name, for counted guests only. */
  seatLabels: Record<string, string>;
}

const Ctx = createContext<EventCtx | null>(null);
export const EventProvider = Ctx.Provider;
export function useEventCtx(): EventCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("Missing EventProvider");
  return v;
}
