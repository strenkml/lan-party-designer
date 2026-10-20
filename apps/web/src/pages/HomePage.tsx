import { useMutation } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { api } from "../lib/api";
import { invalidate, useEvents, useVenues } from "../lib/queries";
import { href } from "../lib/route";
import { Dialog, toast } from "../lib/ui";
import { TopBar } from "../panels/TopBar";

export function HomePage() {
  const venues = useVenues();
  const events = useEvents();
  const [dialog, setDialog] = useState<"venue" | "event" | null>(null);
  const importRef = useRef<HTMLInputElement>(null);

  const remove = useMutation({
    mutationFn: async (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => invalidate("venues", "events"),
    onError: (e) => toast(e.message),
  });

  const onImport = async (file: File) => {
    try {
      const { eventId } = await api.importBundle(JSON.parse(await file.text()));
      await invalidate("venues", "events");
      window.location.hash = href("event", eventId);
    } catch (e) {
      toast(`Import failed: ${(e as Error).message}`);
    }
  };

  const venueName = (id: string) => venues.data?.find((v) => v.id === id)?.name ?? "Unknown venue";

  return (
    <div className="app">
      <TopBar />
      <main className="page">
        <div className="stack">
          <div className="row">
            <h1>Plan your next LAN</h1>
            <div className="spacer" />
            <input
              ref={importRef}
              type="file"
              accept="application/json"
              hidden
              onChange={(e) => e.target.files?.[0] && onImport(e.target.files[0])}
            />
            <button className="btn" onClick={() => importRef.current?.click()}>
              Import event
            </button>
            <button className="btn primary" onClick={() => setDialog("event")} disabled={!venues.data?.length}>
              New event
            </button>
          </div>

          <section className="card stack" aria-labelledby="events-h">
            <h2 id="events-h">Events</h2>
            {events.data?.length ? (
              <ul className="list">
                {events.data.map((e) => (
                  <li key={e.id}>
                    <a className="grow" href={href("event", e.id)}>
                      <strong>{e.name}</strong>
                      <div className="muted">
                        {venueName(e.venueId)}
                        {e.date ? `, ${e.date}` : ""}
                      </div>
                    </a>
                    <button
                      className="btn small danger"
                      onClick={() =>
                        confirm(`Delete event "${e.name}"? Snapshots are deleted with it.`) &&
                        remove.mutate(() => api.deleteEvent(e.id))
                      }
                    >
                      Delete
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="empty">
                {venues.data?.length
                  ? "No events yet. Create one to start placing tables."
                  : "Add the room you play in first, then create an event in it."}
              </div>
            )}
          </section>

          <section className="card stack" aria-labelledby="venues-h">
            <div className="row">
              <h2 id="venues-h">Venues</h2>
              <div className="spacer" />
              <button className="btn" onClick={() => setDialog("venue")}>
                New venue
              </button>
            </div>
            {venues.data?.length ? (
              <ul className="list">
                {venues.data.map((v) => (
                  <li key={v.id}>
                    <a className="grow" href={href("venue", v.id)}>
                      <strong>{v.name}</strong>
                    </a>
                    <button
                      className="btn small danger"
                      onClick={() => confirm(`Delete venue "${v.name}"?`) && remove.mutate(() => api.deleteVenue(v.id))}
                    >
                      Delete
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="empty">A venue holds the room outline, outlets and breakers. You reuse it for every event.</div>
            )}
          </section>
        </div>
      </main>

      {dialog === "venue" && (
        <NameDialog
          title="New venue"
          action="Create venue"
          onClose={() => setDialog(null)}
          onSubmit={async (name) => {
            const v = await api.createVenue(name);
            await invalidate("venues");
            window.location.hash = href("venue", v.id);
          }}
        />
      )}
      {dialog === "event" && venues.data && (
        <NewEventDialog venues={venues.data} events={events.data ?? []} onClose={() => setDialog(null)} />
      )}
    </div>
  );
}

function NameDialog(props: {
  title: string;
  action: string;
  onClose: () => void;
  onSubmit: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  return (
    <Dialog title={props.title} onClose={props.onClose}>
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          if (name.trim()) await props.onSubmit(name.trim()).catch((err) => toast(err.message));
        }}
      >
        <label className="field">
          Name
          <input type="text" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <button className="btn primary" disabled={!name.trim()}>
          {props.action}
        </button>
      </form>
    </Dialog>
  );
}

function NewEventDialog(props: {
  venues: { id: string; name: string }[];
  events: { id: string; name: string; venueId: string }[];
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [venueId, setVenueId] = useState(props.venues[0]?.id ?? "");
  const [date, setDate] = useState("");
  const [cloneFrom, setCloneFrom] = useState("");
  const cloneable = props.events.filter((e) => e.venueId === venueId);
  return (
    <Dialog title="New event" onClose={props.onClose}>
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            const created = await api.createEvent({
              name: name.trim(),
              venueId,
              date: date || null,
              cloneFrom: cloneFrom || undefined,
            });
            await invalidate("events");
            window.location.hash = href("event", created.id);
          } catch (err) {
            toast((err as Error).message);
          }
        }}
      >
        <label className="field">
          Name
          <input type="text" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          Date
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="field">
          Venue
          <select
            value={venueId}
            onChange={(e) => {
              setVenueId(e.target.value);
              setCloneFrom("");
            }}
          >
            {props.venues.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </label>
        {cloneable.length > 0 && (
          <label className="field">
            Start from a previous layout
            <select value={cloneFrom} onChange={(e) => setCloneFrom(e.target.value)}>
              <option value="">Empty room</option>
              {cloneable.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <button className="btn primary" disabled={!name.trim() || !venueId}>
          Create event
        </button>
      </form>
    </Dialog>
  );
}
