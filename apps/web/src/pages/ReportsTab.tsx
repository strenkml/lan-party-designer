import { STANDARD_LENGTHS_FT, WINDOW_UNIT_BTU, cordRuns, ethernetRuns, heatLoad, layoutWarnings, networkLoad, powerRuns, shoppingSummary, shoppingWithOwned } from "@lpd/shared";
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
  const heat = heatLoad(report.total);
  const net = networkLoad(doc, new Map(profiles.map((p) => [p.id, p.kind])));
  const shopRows = shoppingWithOwned(shopping, doc.devices.length, doc.settings.owned);
  const setOwned = (group: "ethernet" | "cords" | "strips" | "switches", lengthFt: number | undefined, n: number) =>
    update((d) => {
      const count = Math.max(0, Math.round(n));
      if (group === "strips" || group === "switches") d.settings.owned[group] = count;
      else if (count === 0) delete d.settings.owned[group][String(lengthFt)];
      else d.settings.owned[group][String(lengthFt)] = count;
    });
  const levelBadge = { ok: "OK", warn: "Check", danger: "Slow" } as const;
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
          <p className="muted">Declined guests are never counted. Filling empty seats shows the worst case if every seat is used. A PC placeholder also gets a 27 inch monitor.</p>
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
          {report.total.peakW > 0 && (
            <p className="muted" style={{ margin: 0 }}>
              Heat in the room: {Math.round(heat.typicalBtu).toLocaleString()} BTU/h typical, {Math.round(heat.peakBtu).toLocaleString()} BTU/h at peak
              ({heat.peakTons.toFixed(1)} tons of cooling, about {heat.peakWindowUnits} window air conditioners of {WINDOW_UNIT_BTU.toLocaleString()} BTU/h). Plan for ventilation or cooling.
            </p>
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
          <label className="field" style={{ maxWidth: 260 }}>
            Internet speed (Mbps)
            <input type="number" min={0} step={50} value={doc.settings.internetMbps ?? ""} placeholder="Unknown"
              onChange={(e) => { const n = parseFloat(e.target.value); update((d) => void (d.settings.internetMbps = Number.isFinite(n) && n > 0 ? n : null)); }} />
          </label>
          {net.internet && <p className="muted" style={{ margin: 0 }}>{net.internet.seats} wired seats share the connection: about {Math.round(net.internet.perSeatMbps)} Mbps each if all download at once.</p>}
          {net.uplinks.length > 0 && (
            <table className="table">
              <thead><tr><th>Uplink</th><th className="num">Seats behind it</th><th className="num">Link speed</th><th className="num">Per seat if all busy</th><th>Status</th></tr></thead>
              <tbody>
                {net.uplinks.map((u) => (
                  <tr key={u.id}>
                    <td>{u.upstream} to {u.downstream}</td>
                    <td className="num">{u.seats}</td>
                    <td className="num">{u.capacityMbps >= 1000 ? `${u.capacityMbps / 1000} Gbps` : `${u.capacityMbps} Mbps`}</td>
                    <td className="num">{Math.round(u.perSeatMbps)} Mbps</td>
                    <td><span className={`badge ${u.level}`}>{levelBadge[u.level]}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {net.warnings.length > 0 && (
            <ul className="warnlist" style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {net.warnings.map((w, i) => <li key={i}><span className="dot-line"><span className={`badge ${w.level}`}>{w.level === "danger" ? "Problem" : "Warning"}</span> {w.message}</span></li>)}
            </ul>
          )}
          {needsPort.length > 0 && <p className="badge warn" style={{ justifySelf: "start" }}>{needsPort.length} seated guests need ethernet but have no port: {needsPort.map((a) => people.find((p) => p.id === a.personId)?.name).join(", ")}</p>}
        </section>

        <section className="card stack" aria-labelledby="shop-h">
          <h2 id="shop-h">Shopping list</h2>
          <table className="table">
            <thead><tr><th>Item</th><th className="num">Need</th><th className="num">Have</th><th className="num">Buy</th></tr></thead>
            <tbody>
              {shopRows.map((r) => (
                <tr key={r.id}>
                  <td>{r.label}</td>
                  <td className="num">{r.need}</td>
                  <td className="num">
                    <input type="number" min={0} step={1} style={{ width: 64 }} aria-label={`Owned: ${r.label}`} value={r.have}
                      onChange={(e) => { const n = parseInt(e.target.value, 10); if (Number.isFinite(n)) setOwned(r.group, r.lengthFt, n); }} />
                  </td>
                  <td className="num"><strong>{r.buy}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
          {shopRows.length === 0 && <div className="empty">Nothing to buy yet. Wire seats to switches and strips first.</div>}
          <div className="row no-print">
            {(["ethernet", "cords"] as const).map((group) => (
              <label key={group} className="field">
                {group === "ethernet" ? "Add an ethernet cable you own" : "Add an extension cord you own"}
                <select value="" onChange={(e) => e.target.value && setOwned(group, Number(e.target.value), (doc.settings.owned[group][e.target.value] ?? 0) + 1)}>
                  <option value="">Length…</option>
                  {STANDARD_LENGTHS_FT.map((l) => <option key={l} value={l}>{l} ft</option>)}
                </select>
              </label>
            ))}
          </div>
          <p className="muted no-print">Gear you own only covers items of the same length. Strips and switches count one for one.</p>
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
