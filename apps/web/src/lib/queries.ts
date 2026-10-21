import { QueryClient, useQuery } from "@tanstack/react-query";
import { api } from "./api";

export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 5_000, refetchOnWindowFocus: false } },
});

export const useVenues = () => useQuery({ queryKey: ["venues"], queryFn: api.venues });
export const useEvents = () => useQuery({ queryKey: ["events"], queryFn: api.events });
export const usePeople = () => useQuery({ queryKey: ["people"], queryFn: api.people });
export const usePresets = () => useQuery({ queryKey: ["presets"], queryFn: api.presets });
export const useProfiles = () => useQuery({ queryKey: ["profiles"], queryFn: api.profiles });
export const useSnapshots = (eventId: string) =>
  useQuery({ queryKey: ["snapshots", eventId], queryFn: () => api.snapshots(eventId) });

export const invalidate = (...keys: string[]) =>
  Promise.all(keys.map((k) => queryClient.invalidateQueries({ queryKey: [k] })));
