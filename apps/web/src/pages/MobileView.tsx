import { useState } from "react";
import { SeatMap } from "../panels/SeatMap";
import { seatName } from "../store/eventOps";
import { useEventCtx } from "./eventContext";

/** Read-only seat lookup for phones and tablets. */
export function MobileView() {
  const { venue, doc, people, seatLabels } = useEventCtx();
  const [q, setQ] = useState("");
  const [highlight, setHighlight] = useState<string | null>(null);
  const rows = doc.attendance
    .filter((a) => a.rsvp !== "declined")
    .map((a) => ({ a, person: people.find((p) => p.id === a.personId) }))
    .filter((r) => r.person && `${r.person.name} ${r.person.handle}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <main className="page mobile-only">
      <div className="stack">
        <SeatMap venue={venue} event={doc} seatLabels={seatLabels} highlightSeat={highlight} />
        <label className="field">
          Find someone
          <input type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or handle" />
        </label>
        <ul className="list card">
          {rows.map(({ a, person }) => (
            <li key={a.personId}>
              <button className="btn ghost grow" style={{ justifyContent: "space-between" }} onClick={() => setHighlight(a.seatId)}>
                <strong>{person!.name}</strong>
                <span className="muted">{seatName(doc, a.seatId)}</span>
              </button>
            </li>
          ))}
          {rows.length === 0 && <li className="muted">No one matches.</li>}
        </ul>
        <p className="muted">Editing the plan needs a larger screen.</p>
      </div>
    </main>
  );
}
