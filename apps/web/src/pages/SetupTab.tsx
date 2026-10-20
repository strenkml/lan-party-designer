import { useState } from "react";
import { seatName } from "../store/eventOps";
import { useEventDoc } from "../store/eventStore";
import { SeatMap } from "../panels/SeatMap";
import { useEventCtx } from "./eventContext";

export function SetupTab() {
  const { venue, doc, people, seatLabels } = useEventCtx();
  const update = useEventDoc((s) => s.update);
  const [highlight, setHighlight] = useState<string | null>(null);

  const seated = doc.attendance.filter((a) => a.seatId && a.rsvp !== "declined");
  const rows = seated
    .map((a) => {
      const seat = doc.seats.find((s) => s.id === a.seatId)!;
      const item = doc.checklist[seat.id] ?? { power: false, ethernet: false, tested: false, note: "" };
      const needsPower = !!seat.stripId;
      const needsNet = !!seat.netDeviceId;
      const required = 1 + (needsPower ? 1 : 0) + (needsNet ? 1 : 0);
      const done = (item.tested ? 1 : 0) + (needsPower && item.power ? 1 : 0) + (needsNet && item.ethernet ? 1 : 0);
      return { a, seat, item, needsPower, needsNet, required, done };
    })
    .filter((r) => r.seat);

  const total = rows.reduce((n, r) => n + r.required, 0);
  const done = rows.reduce((n, r) => n + r.done, 0);
  const pct = total ? Math.round((done / total) * 100) : 0;

  const tint: Record<string, "done" | "partial" | "none"> = {};
  for (const r of rows) tint[r.seat.id] = r.done === r.required ? "done" : r.done > 0 ? "partial" : "none";

  const toggle = (seatId: string, key: "power" | "ethernet" | "tested", value: boolean) =>
    update((d) => {
      const cur = d.checklist[seatId] ?? { power: false, ethernet: false, tested: false, note: "" };
      d.checklist[seatId] = { ...cur, [key]: value };
    });

  return (
    <main className="page">
      <div className="stack">
        <div className="row">
          <h1>Setup day</h1>
          <div className="spacer" />
          <strong>{pct}% ready</strong>
        </div>
        <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Setup progress"><div style={{ width: `${pct}%` }} /></div>

        <SeatMap venue={venue} event={doc} seatLabels={seatLabels} tint={tint} highlightSeat={highlight} onSeatClick={setHighlight} />

        {rows.length === 0 ? (
          <div className="empty">Seat some guests on the Roster tab to get a checklist for each seat.</div>
        ) : (
          <section className="card">
            <table className="table">
              <thead><tr><th>Seat</th><th>Guest</th><th>Power</th><th>Ethernet</th><th>Tested</th><th>Note</th></tr></thead>
              <tbody>
                {rows.map(({ a, seat, item, needsPower, needsNet }) => (
                  <tr key={seat.id} style={highlight === seat.id ? { background: "var(--surface)" } : undefined} onClick={() => setHighlight(seat.id)}>
                    <td>{seatName(doc, seat.id)}</td>
                    <td>{people.find((p) => p.id === a.personId)?.name}</td>
                    <td>{needsPower ? <input type="checkbox" aria-label={`Power connected at ${seatName(doc, seat.id)}`} checked={item.power} onChange={(e) => toggle(seat.id, "power", e.target.checked)} /> : <span className="muted">n/a</span>}</td>
                    <td>{needsNet ? <input type="checkbox" aria-label={`Ethernet connected at ${seatName(doc, seat.id)}`} checked={item.ethernet} onChange={(e) => toggle(seat.id, "ethernet", e.target.checked)} /> : <span className="muted">n/a</span>}</td>
                    <td><input type="checkbox" aria-label={`Tested at ${seatName(doc, seat.id)}`} checked={item.tested} onChange={(e) => toggle(seat.id, "tested", e.target.checked)} /></td>
                    <td><input type="text" aria-label={`Note for ${seatName(doc, seat.id)}`} value={item.note} onChange={(e) => update((d) => { const cur = d.checklist[seat.id] ?? { power: false, ethernet: false, tested: false, note: "" }; d.checklist[seat.id] = { ...cur, note: e.target.value }; }, { key: `note-${seat.id}` })} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </div>
    </main>
  );
}
