import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { EventDoc, VenueDoc, computePowerLoad } from "@lpd/shared";
import { api } from "../lib/api";
import { invalidate, usePeople, useProfiles, useSnapshots } from "../lib/queries";
import { href } from "../lib/route";
import { Dialog, downloadJson, toast } from "../lib/ui";
import { useAutosave } from "../lib/useAutosave";
import { TopBar } from "../panels/TopBar";
import { useEventDoc } from "../store/eventStore";
import { shortName } from "../store/eventOps";
import { EventProvider } from "./eventContext";
import { MobileView } from "./MobileView";
import { PlanTab } from "./PlanTab";
import { ReportsTab } from "./ReportsTab";
import { RosterTab } from "./RosterTab";
import { SetupTab } from "./SetupTab";

const TABS = [
  { id: "plan", label: "Plan" },
  { id: "roster", label: "Roster" },
  { id: "reports", label: "Reports" },
  { id: "setup", label: "Setup day" },
] as const;

export function EventPage({ id, tab }: { id: string; tab: string }) {
  const eventQ = useQuery({ queryKey: ["event", id], queryFn: () => api.event(id), staleTime: Infinity, gcTime: 0 });
  const venueId = eventQ.data?.venueId;
  const venueQ = useQuery({
    queryKey: ["venue", venueId],
    queryFn: () => api.venue(venueId!),
    enabled: !!venueId,
    staleTime: 0,
    gcTime: 0,
  });
  const people = usePeople();
  const profiles = useProfiles();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (eventQ.data) {
      useEventDoc.getState().load(EventDoc.parse(eventQ.data.doc));
      setReady(true);
    }
  }, [eventQ.data]);

  const { status, flush } = useAutosave(useEventDoc, (doc) => api.saveEvent(id, { doc }).then(() => invalidate("events")), ready);

  if (eventQ.error) {
    return <div className="app"><TopBar /><main className="page"><div className="empty">Event not found.</div></main></div>;
  }
  if (!ready || !eventQ.data || !venueQ.data || !people.data || !profiles.data) {
    return <div className="app"><TopBar /><main className="page muted">Loading…</main></div>;
  }
  return (
    <EventShell
      id={id}
      tab={tab}
      name={eventQ.data.name}
      date={eventQ.data.date}
      venue={VenueDoc.parse(venueQ.data.doc)}
      venueName={venueQ.data.name}
      venueId={venueQ.data.id}
      status={status}
      flush={flush}
      people={people.data}
      profiles={profiles.data}
    />
  );
}

function EventShell(props: {
  id: string;
  tab: string;
  name: string;
  date: string | null;
  venue: VenueDoc;
  venueName: string;
  venueId: string;
  status: string;
  flush: () => Promise<void>;
  people: import("@lpd/shared").Person[];
  profiles: import("@lpd/shared").DeviceProfile[];
}) {
  const doc = useEventDoc((s) => s.doc);
  const [name, setName] = useState(props.name);
  const [snapshots, setSnapshots] = useState(false);

  const report = useMemo(
    () => computePowerLoad({ venue: props.venue, event: doc, people: props.people, profiles: props.profiles }),
    [props.venue, doc, props.people, props.profiles],
  );

  const seatLabels = useMemo(() => {
    const out: Record<string, string> = {};
    for (const a of doc.attendance) {
      if (a.seatId && a.rsvp !== "declined") out[a.seatId] = shortName(props.people.find((p) => p.id === a.personId));
    }
    return out;
  }, [doc.attendance, props.people]);

  const ctx = { eventId: props.id, venue: props.venue, people: props.people, profiles: props.profiles, doc, report, seatLabels };
  const active = TABS.find((t) => t.id === props.tab)?.id ?? "plan";

  const exportEvent = async () => {
    await props.flush();
    try {
      downloadJson(`${name.replace(/\W+/g, "-").toLowerCase() || "event"}.json`, await api.exportEvent(props.id));
    } catch (e) {
      toast((e as Error).message);
    }
  };

  return (
    <EventProvider value={ctx}>
      <div className="app">
        <TopBar
          crumb={
            <>
              <a href={href("venue", props.venueId)} title="Edit venue">{props.venueName}</a>
              <span aria-hidden>/</span>
              <input
                type="text"
                aria-label="Event name"
                value={name}
                style={{ fontWeight: 650, width: 220 }}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => name.trim() && api.saveEvent(props.id, { name: name.trim() }).then(() => invalidate("events"))}
              />
            </>
          }
          tabs={TABS.map((t) => (
            <a key={t.id} className="tab" href={href("event", props.id, t.id)} aria-current={active === t.id ? "page" : undefined}>
              {t.label}
            </a>
          ))}
          right={
            <>
              <span className="muted hide-mobile" role="status">
                {props.status === "saving" ? "Saving…" : props.status === "saved" ? "Saved" : props.status === "error" ? "Save failed. Retrying on next change." : ""}
              </span>
              <button className="btn small hide-mobile" onClick={() => setSnapshots(true)}>Snapshots</button>
              <button className="btn small hide-mobile" onClick={exportEvent}>Export</button>
            </>
          }
        />
        {active === "plan" && (
          <>
            <PlanTab eventName={name} />
            <MobileView />
          </>
        )}
        {active === "roster" && <RosterTab />}
        {active === "reports" && <ReportsTab eventName={name} />}
        {active === "setup" && <SetupTab />}
        {snapshots && <SnapshotsDialog eventId={props.id} flush={props.flush} onClose={() => setSnapshots(false)} />}
      </div>
    </EventProvider>
  );
}

function SnapshotsDialog({ eventId, flush, onClose }: { eventId: string; flush: () => Promise<void>; onClose: () => void }) {
  const q = useSnapshots(eventId);
  const [name, setName] = useState("");
  const refresh = () => invalidate("snapshots");
  const fmt = (t: number) => new Date(t).toLocaleString();
  return (
    <Dialog title="Snapshots" onClose={onClose}>
      <p className="muted">Save a named version before big changes. Restoring first saves your current plan as "Before restore", so nothing is lost.</p>
      <form
        className="row"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim()) return;
          await flush();
          await api.createSnapshot(eventId, name.trim()).catch((err) => toast(err.message));
          setName("");
          refresh();
          toast("Snapshot saved");
        }}
      >
        <input type="text" aria-label="Snapshot name" placeholder="Name this version" value={name} onChange={(e) => setName(e.target.value)} style={{ flex: 1 }} />
        <button className="btn primary" disabled={!name.trim()}>Save snapshot</button>
      </form>
      {q.data?.length ? (
        <ul className="list">
          {q.data.map((s) => (
            <li key={s.id}>
              <div className="grow"><strong>{s.name}</strong><div className="muted">{fmt(s.createdAt)}</div></div>
              <button
                className="btn small"
                onClick={async () => {
                  if (!confirm(`Restore "${s.name}"? Your current plan is saved as "Before restore" first.`)) return;
                  await flush();
                  await api.restoreSnapshot(s.id);
                  toast("Restored. Reloading…");
                  window.location.reload();
                }}
              >
                Restore
              </button>
              <button className="btn small danger" onClick={() => api.deleteSnapshot(s.id).then(refresh)}>Delete</button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="empty">No snapshots yet.</div>
      )}
    </Dialog>
  );
}
