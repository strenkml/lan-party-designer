import type { DeviceProfile, EventBundle, EventDoc, Person, VenueDoc } from "@lpd/shared";

export interface VenueRow {
  id: string;
  name: string;
  doc: VenueDoc;
  updatedAt: number;
}
export interface VenueSummary {
  id: string;
  name: string;
  updatedAt: number;
}
export interface EventRow {
  id: string;
  venueId: string;
  name: string;
  date: string | null;
  doc: EventDoc;
  updatedAt: number;
}
export interface EventSummary {
  id: string;
  venueId: string;
  name: string;
  date: string | null;
  updatedAt: number;
}
export interface SnapshotSummary {
  id: string;
  name: string;
  createdAt: number;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`);
  return data as T;
}

export const api = {
  venues: () => request<VenueSummary[]>("GET", "/venues"),
  venue: (id: string) => request<VenueRow>("GET", `/venues/${id}`),
  createVenue: (name: string) => request<VenueRow>("POST", "/venues", { name }),
  saveVenue: (id: string, patch: { name?: string; doc?: VenueDoc }) => request("PUT", `/venues/${id}`, patch),
  deleteVenue: (id: string) => request("DELETE", `/venues/${id}`),
  uploadBackground: async (venueId: string, file: File) => {
    const form = new FormData();
    form.set("file", file);
    const res = await fetch(`/api/venues/${venueId}/background`, { method: "POST", body: form });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Upload failed");
    return data as { file: string };
  },
  events: () => request<EventSummary[]>("GET", "/events"),
  event: (id: string) => request<EventRow>("GET", `/events/${id}`),
  createEvent: (body: { name: string; venueId: string; date?: string | null; cloneFrom?: string }) =>
    request<EventRow>("POST", "/events", body),
  saveEvent: (id: string, patch: { name?: string; date?: string | null; doc?: EventDoc }) =>
    request("PUT", `/events/${id}`, patch),
  deleteEvent: (id: string) => request("DELETE", `/events/${id}`),
  exportEvent: (id: string) => request<EventBundle>("GET", `/events/${id}/export`),
  importBundle: (bundle: unknown) => request<{ eventId: string }>("POST", "/import", bundle),
  snapshots: (eventId: string) => request<SnapshotSummary[]>("GET", `/events/${eventId}/snapshots`),
  createSnapshot: (eventId: string, name: string) => request("POST", `/events/${eventId}/snapshots`, { name }),
  restoreSnapshot: (id: string) => request("POST", `/snapshots/${id}/restore`),
  deleteSnapshot: (id: string) => request("DELETE", `/snapshots/${id}`),
  people: () => request<Person[]>("GET", "/people"),
  createPerson: (p: Omit<Person, "id">) => request<Person>("POST", "/people", p),
  savePerson: (id: string, p: Omit<Person, "id">) => request("PUT", `/people/${id}`, p),
  deletePerson: (id: string) => request("DELETE", `/people/${id}`),
  profiles: () => request<DeviceProfile[]>("GET", "/profiles"),
  createProfile: (p: Omit<DeviceProfile, "id">) => request<DeviceProfile>("POST", "/profiles", p),
  saveProfile: (id: string, p: Omit<DeviceProfile, "id">) => request("PUT", `/profiles/${id}`, p),
  deleteProfile: (id: string) => request("DELETE", `/profiles/${id}`),
};

export const uploadUrl = (file: string) => `/api/uploads/${file}`;
