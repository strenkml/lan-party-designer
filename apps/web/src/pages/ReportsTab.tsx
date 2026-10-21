import { ethernetRuns, cordRuns, layoutWarnings, powerRuns, shoppingSummary } from "@lpd/shared";
import { Gauge, LevelBadge, formatWatts } from "../lib/ui";
import { SeatMap } from "../panels/SeatMap";
import { devicePorts, outletName, seatName } from "../store/eventOps";
import { useEventDoc } from "../store/eventStore";
import { useEventCtx } from "./eventContext";

export function ReportsTab({ eventName }: { eventName: string }) {
  const { venue, doc, people, profiles, report, seatLabels } = useEventCtx();
  const update = useEventDoc((s) => s.update);
  const shopping = shoppingSummary(venue, doc);
  const eth = ethernetRuns(doc, venue);
  const cords = cordRuns(venue, doc);
  const pwr = powerRuns(venue, doc);
  const layout = layoutWarnings(venue, doc);
  const switches = doc.devices.filter((d) => devicePorts(doc, d.id, profiles) > 0);

  const needsPort = doc.attendance.filter((a) => {
    if (!a.seatId || a.rsvp === "declined") return false;
    const needs = a.needsEthernet ?? people.find((p) => p.id === a.personId)?.needsEthernet ?? true;
    return needs && !doc.seats.find((s) => s.id === a.seatId)?.netDeviceId;
  });

  return (
    <main className="page">
      <div className="stack">
        <div className="row no-print">
          <h1>Reports</h1>
          <div className="spacer" />
          <button className="btn primary" onClick={() => window.print()}>Print</button>
        </div>
        <h1 style={{ display: "none" }} className="print-title">{eventName}</h1>

        <section className="card stack no-print" aria-labelledby="scope-h">
          <h2 id="scope-h">What to count</h2>
          <div className="row">
            <div className="seg" role="group" aria-label="Guests included">
              <button aria-pressed={doc.settings.rsvpMode === "confirmedInvited"} onClick={() => update((d) => void (d.settings.rsvpMode = "confirmedInvited"))}>Confirmed and invited</button>
              <button aria-pressed={doc.settings.rsvpMode === "confirmed"} onClick={() => update((d) => void (d.settings.rsvpMode = "confirmed"))}>Confirmed only</button>
            </div>
            <label className="field" style={{ minWidth: 220 }}>
              Fill empty seats with
              <select value={doc.settings.placeholderProfileId ?? ""} onChange={(e) => update((d) => void (d.settings.placeholderProfileId = e.target.value || null))}>
                <option value="">Nothing</option>
                {profiles.filter((p) => p.kind === "pc" || p.kind === "laptop").map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
          </div>
          <p className="muted">Declined guests are never counted. Filling empty seats shows the worst case if every seat is used.</p>
        </section>

        <section className="card stack" aria-labelledby="power-h">
          <div className="row"><h2 id="power-h">Power</h2><div className="spacer" /><span>{formatWatts(report.total.typicalW)} typical, {formatWatts(report.total.peakW)} peak</span></div>
          {report.circuits.length === 0 ? <div className="empty">This venue has no breakers yet. Add them in the venue editor.</div> : (
            <div className="stack">
              {report.circuits.map((c) => (
                <Gauge key={c.id} label={c.label} level={c.level} typicalA={c.typicalA} peakA={c.peakA} ratingA={c.ratingA}
                  detail={`${c.outletIds.length} outlets: ${c.outletIds.map((o) => outletName(venue, o)).join(", ") || "none"}`} />
              ))}
            </div>
          )}
          {report.unverified.peakW > 0 && (
            <p className="badge warn" style={{ justifySelf: "start" }}>{formatWatts(report.unverified.typicalW)} typical is on outlets with an unknown breaker. Tag them in the venue editor to verify.</p>
          )}
          {doc.strips.length > 0 && (
            <table className="table">
              <thead><tr><th>Power strip</th><th className="num">Sockets</th><th className="num">Typical</th><th className="num">Peak</th><th>Status</th></tr></thead>
              <tbody>
                {report.strips.map((s) => (
                  <tr key={s.id}>
                    <td>{s.label}</td>
                    <td className="num">{s.socketsUsed}/{s.socketsTotal}</td>
                    <td className="num">{s.typicalA.toFixed(1)}A</td>
                    <td className="num">{s.peakA.toFixed(1)}A of {s.ratingA}A</td>
                    <td><LevelBadge level={s.level} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {pwr.length > 0 && (
            <details>
              <summary>Power cable runs ({pwr.length})</summary>
              <table className="table">
                <thead><tr><th>From</th><th>To</th><th className="num">Cable</th></tr></thead>
                <tbody>{pwr.map((r) => <tr key={r.key}><td>{r.from}</td><td>{r.to}</td><td className="num">{r.lengthFt} ft</td></tr>)}</tbody>
              </table>
            </details>
          )}
          {report.warnings.length + layout.length > 0 && (
            <ul className="warnlist" style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {[...report.warnings, ...layout].map((w, i) => <li key={i}><span className="dot-line"><span className={`badge ${w.level}`}>{w.level === "danger" ? "Problem" : "Warning"}</span> {w.message}</span></li>)}
            </ul>
          )}
        </section>

        <section className="card stack" aria-labelledby="net-h">
          <h2 id="net-h">Network</h2>
          {switches.length === 0 ? <div className="empty">Place a switch on the plan to map ports.</div> : switches.map((sw) => {
            const total = devicePorts(doc, sw.id, profiles);
            const seats = doc.seats.filter((s) => s.netDeviceId === sw.id).sort((a, b) => (a.netPort ?? 99) - (b.netPort ?? 99));
            const up = doc.uplinks.filter((u) => u.fromDeviceId === sw.id || u.toDeviceId === sw.id);
            return (
              <div key={sw.id}>
                <h3>{sw.label} <span className="muted">{seats.length + up.length} of {total} ports used</span></h3>
                <table className="table">
                  <tbody>
                    {seats.map((s) => <tr key={s.id}><td style={{ width: 60 }}>Port {s.netPort !== null ? s.netPort + 1 : "?"}</td><td>{seatName(doc, s.id)}</td><td className="muted">{seatLabels[s.id] ?? ""}</td></tr>)}
                    {up.map((u) => <tr key={u.id}><td>Uplink</td><td colSpan={2}>{doc.devices.find((d) => d.id === (u.fromDeviceId === sw.id ? u.toDeviceId : u.fromDeviceId))?.label}</td></tr>)}
                  </tbody>
                </table>
              </div>
            );
          })}
          {needsPort.length > 0 && <p className="badge warn" style={{ justifySelf: "start" }}>{needsPort.length} seated guests need ethernet but have no port: {needsPort.map((a) => people.find((p) => p.id === a.personId)?.name).join(", ")}</p>}
        </section>

        <section className="card stack" aria-labelledby="shop-h">
          <h2 id="shop-h">Shopping list</h2>
          <table className="table">
            <thead><tr><th>Item</th><th className="num">Quantity</th></tr></thead>
            <tbody>
              {shopping.ethernet.map((l) => <tr key={`e${l.lengthFt}`}><td>Ethernet cable, {l.lengthFt} ft</td><td className="num">{l.count}</td></tr>)}
              {shopping.cords.map((l) => <tr key={`c${l.lengthFt}`}><td>Extension cord, {l.lengthFt} ft</td><td className="num">{l.count}</td></tr>)}
              {shopping.strips > 0 && <tr><td>Power strips</td><td className="num">{shopping.strips}</td></tr>}
              {doc.devices.length > 0 && <tr><td>Switches and routers</td><td className="num">{doc.devices.length}</td></tr>}
            </tbody>
          </table>
          {shopping.ethernet.length + shopping.cords.length + shopping.strips + doc.devices.length === 0 && <div className="empty">Nothing to buy yet. Wire seats to switches and strips first.</div>}
          {eth.length > 0 && (
            <details>
              <summary>Ethernet runs ({eth.length})</summary>
              <table className="table">
                <thead><tr><th>From</th><th>To</th><th className="num">Cable</th></tr></thead>
                <tbody>
                  {eth.map((r) => <tr key={r.id}><td>{r.from}</td><td>{r.to}</td><td className="num">{r.lengthFt} ft</td></tr>)}
                </tbody>
              </table>
            </details>
          )}
          <p className="muted">{eth.length} ethernet runs and {cords.filter((c) => c.lengthFt > 0).length} cords. Lengths add 20% slack plus 3 ft of drop at each end, rounded up to a standard size.</p>
        </section>

        <section className="card stack" aria-labelledby="map-h">
          <h2 id="map-h">Seat map</h2>
          <SeatMap venue={venue} event={doc} seatLabels={seatLabels} />
        </section>
      </div>
    </main>
  );
}
