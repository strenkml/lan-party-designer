import { Fragment, useState } from "react";
import { api } from "../lib/api";
import { invalidate } from "../lib/queries";
import { href } from "../lib/route";
import { toast } from "../lib/ui";
import { assignSeat, seatName } from "../store/eventOps";
import { useEventDoc } from "../store/eventStore";
import { useEventCtx } from "./eventContext";
import { DevicePicker } from "./PeoplePage";

export function RosterTab() {
  const { doc, people, profiles } = useEventCtx();
  const update = useEventDoc((s) => s.update);
  const [pick, setPick] = useState("");
  const [quick, setQuick] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  const inEvent = new Set(doc.attendance.map((a) => a.personId));
  const available = people.filter((p) => !inEvent.has(p.id));
  const counts = { confirmed: 0, invited: 0, declined: 0 };
  doc.attendance.forEach((a) => counts[a.rsvp]++);

  const add = (personId: string) =>
    update((d) => void d.attendance.push({ personId, rsvp: "invited", seatId: null }));

  const takenSeats = new Set(doc.attendance.map((a) => a.seatId).filter(Boolean));

  return (
    <main className="page">
      <div className="stack">
        <div className="row">
          <h1>Roster</h1>
          <div className="spacer" />
          <span className="badge ok">{counts.confirmed} confirmed</span>
          <span className="badge info">{counts.invited} invited</span>
          <span className="badge info">{counts.declined} declined</span>
          <span className="badge info">{doc.seats.length} seats</span>
        </div>

        <section className="card stack">
          <h2>Add guests</h2>
          <div className="row">
            <select aria-label="Add from people" value={pick} onChange={(e) => setPick(e.target.value)} style={{ maxWidth: 260 }}>
              <option value="">Choose someone…</option>
              {available.map((p) => <option key={p.id} value={p.id}>{p.name}{p.handle ? ` (${p.handle})` : ""}</option>)}
            </select>
            <button className="btn primary" disabled={!pick} onClick={() => { add(pick); setPick(""); }}>Add to event</button>
            <span className="muted">or</span>
            <form
              className="row"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!quick.trim()) return;
                try {
                  const person = await api.createPerson({ name: quick.trim(), handle: "", devices: [{ profileId: "pc-mid" }, { profileId: "monitor-27" }], needsEthernet: true, notes: "" });
                  await invalidate("people");
                  add(person.id);
                  setQuick("");
                } catch (err) { toast((err as Error).message); }
              }}
            >
              <input type="text" aria-label="New person name" placeholder="New person's name" value={quick} onChange={(e) => setQuick(e.target.value)} />
              <button className="btn" disabled={!quick.trim()}>Create and add</button>
            </form>
          </div>
          <p className="muted">New people start with a mid-range PC and one 27" monitor. Edit their gear under <a href={href("people")}>People & devices</a>.</p>
        </section>

        {doc.attendance.length === 0 ? (
          <div className="empty">No guests yet. Add the people you invited.</div>
        ) : (
          <section className="card" style={{ overflowX: "auto" }}>
            <table className="table">
              <thead>
                <tr><th>Guest</th><th>RSVP</th><th>Seat</th><th>Ethernet</th><th>Devices</th><th /></tr>
              </thead>
              <tbody>
                {doc.attendance.map((a) => {
                  const person = people.find((p) => p.id === a.personId);
                  const custom = !!a.devices;
                  const devices = a.devices ?? person?.devices ?? [];
                  const set = (f: (x: typeof a) => void) => update((d) => { const t = d.attendance.find((x) => x.personId === a.personId); if (t) f(t); });
                  return (
                    <Fragment key={a.personId}>
                      <tr>
                        <td><strong>{person?.name ?? "Unknown"}</strong>{person?.handle && <div className="muted">{person.handle}</div>}</td>
                        <td>
                          <select aria-label={`RSVP for ${person?.name}`} value={a.rsvp} onChange={(e) => set((x) => void (x.rsvp = e.target.value as typeof a.rsvp))}>
                            <option value="invited">Invited</option>
                            <option value="confirmed">Confirmed</option>
                            <option value="declined">Declined</option>
                          </select>
                        </td>
                        <td>
                          <select aria-label={`Seat for ${person?.name}`} value={a.seatId ?? ""} onChange={(e) => update((d) => assignSeat(d, a.personId, e.target.value || null))}>
                            <option value="">Unseated</option>
                            {doc.seats.map((s) => (
                              <option key={s.id} value={s.id}>{seatName(doc, s.id)}{takenSeats.has(s.id) && s.id !== a.seatId ? " (taken)" : ""}</option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <input type="checkbox" aria-label={`${person?.name} needs ethernet`} checked={a.needsEthernet ?? person?.needsEthernet ?? true} onChange={(e) => set((x) => void (x.needsEthernet = e.target.checked))} />
                        </td>
                        <td>
                          <button className="btn small" onClick={() => setOpen(open === a.personId ? null : a.personId)}>
                            {devices.length} devices{custom ? " (custom)" : ""}
                          </button>
                        </td>
                        <td className="num"><button className="btn small danger" onClick={() => update((d) => void (d.attendance = d.attendance.filter((x) => x.personId !== a.personId)))}>Remove</button></td>
                      </tr>
                      {open === a.personId && (
                        <tr>
                          <td colSpan={6}>
                            <div className="stack">
                              <DevicePicker profiles={profiles} value={devices.map((d) => d.profileId)} onChange={(ids) => set((x) => void (x.devices = ids.map((profileId) => ({ profileId }))))} />
                              {custom && <button className="btn small" style={{ justifySelf: "start" }} onClick={() => set((x) => void (x.devices = undefined))}>Use {person?.name}'s usual gear</button>}
                              <p className="muted">Changes here apply to this event only.</p>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </section>
        )}
      </div>
    </main>
  );
}
