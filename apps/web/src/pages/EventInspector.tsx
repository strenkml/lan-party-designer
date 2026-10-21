import { useMemo } from "react";
import type { Selection } from "../canvas/FloorPlan";
import { Gauge, LevelBadge, NumberField, TextField, newId } from "../lib/ui";
import {
  assignSeat,
  decodePlug,
  devicePorts,
  encodePlug,
  freePorts,
  outletName,
  removeCord,
  removeDevice,
  removeStrip,
  removeTable,
  resetSeat,
  resizeTable,
} from "../store/eventOps";
import { useEventDoc } from "../store/eventStore";
import { useEventCtx } from "./eventContext";

export function EventInspector({ selection, clear }: { selection: Selection | null; clear: () => void }) {
  if (!selection) {
    return (
      <section>
        <h3>Nothing selected</h3>
        <p className="muted">Pick a tool on the left to place tables, power strips and switches, or click an item to edit it.</p>
      </section>
    );
  }
  switch (selection.kind) {
    case "table": return <TableInspector id={selection.id} clear={clear} />;
    case "seat": return <SeatInspector id={selection.id} />;
    case "strip": return <StripInspector id={selection.id} clear={clear} />;
    case "device": return <DeviceInspector id={selection.id} clear={clear} />;
    case "outlet": return <OutletInspector id={selection.id} />;
    default: return null;
  }
}

function PlugSelect(props: {
  value: ReturnType<typeof encodePlug>;
  excludeStrip?: string;
  onChange: (v: ReturnType<typeof decodePlug>) => void;
}) {
  const { venue, doc } = useEventCtx();
  return (
    <label className="field">
      Plugged into
      <select value={props.value} onChange={(e) => props.onChange(decodePlug(e.target.value))}>
        <option value="">Nothing</option>
        <optgroup label="Wall outlets">
          {venue.outlets.map((o) => <option key={o.id} value={`outlet:${o.id}`}>{outletName(venue, o.id)}</option>)}
        </optgroup>
        {doc.cords.length > 0 && (
          <optgroup label="Extension cords">
            {doc.cords.map((c) => <option key={c.id} value={`cord:${c.id}`}>{c.label || c.id}</option>)}
          </optgroup>
        )}
        <optgroup label="Power strips (daisy chain)">
          {doc.strips.filter((s) => s.id !== props.excludeStrip).map((s) => <option key={s.id} value={`strip:${s.id}`}>{s.label || s.id}</option>)}
        </optgroup>
      </select>
    </label>
  );
}

function TableInspector({ id, clear }: { id: string; clear: () => void }) {
  const t = useEventDoc((s) => s.doc.tables.find((x) => x.id === id));
  const update = useEventDoc((s) => s.update);
  if (!t) return null;
  const patch = (p: Partial<typeof t>) => update((d) => resizeTable(d, id, p), { key: `table-${id}` });
  return (
    <section>
      <h3>Table</h3>
      <TextField label="Label" value={t.label} onChange={(label) => patch({ label })} />
      <div className="row">
        <div style={{ flex: 1 }}><NumberField label={t.shape === "round" ? "Diameter" : "Length"} suffix="ft" min={1} value={t.width} onChange={(width) => patch(t.shape === "round" ? { width, depth: width } : { width })} /></div>
        {t.shape === "rect" && <div style={{ flex: 1 }}><NumberField label="Depth" suffix="ft" min={1} value={t.depth} onChange={(depth) => patch({ depth })} /></div>}
      </div>
      <div className="row">
        <div style={{ flex: 1 }}><NumberField label={t.shape === "round" ? "Seats" : "Seats per side"} step={1} min={0} value={t.seats} onChange={(seats) => patch({ seats: Math.max(0, Math.round(seats)) })} /></div>
        <div style={{ flex: 1 }}><NumberField label="Rotation" suffix="deg" step={15} value={t.rotation} onChange={(rotation) => patch({ rotation })} /></div>
      </div>
      <button className="btn danger" onClick={() => { update((d) => removeTable(d, id)); clear(); }}>Delete table and seats</button>
    </section>
  );
}

function SeatInspector({ id }: { id: string }) {
  const { doc, people, profiles } = useEventCtx();
  const update = useEventDoc((s) => s.update);
  const seat = doc.seats.find((s) => s.id === id);
  const occupant = doc.attendance.find((a) => a.seatId === id);
  const load = useEventCtx().report.seatLoads[id];
  const ports = seat?.netDeviceId ? devicePorts(doc, seat.netDeviceId, profiles) : 0;
  const portOptions = useMemo(
    () => (seat?.netDeviceId ? freePorts(doc, seat.netDeviceId, ports) : []),
    [doc, seat?.netDeviceId, ports],
  );
  if (!seat) return null;
  const set = (f: (s: NonNullable<typeof seat>) => void) => update((d) => { const t = d.seats.find((x) => x.id === id); if (t) f(t); });
  const switches = doc.devices.filter((d) => devicePorts(doc, d.id, profiles) > 0);
  const ports2 = seat.netPort !== null && !portOptions.includes(seat.netPort) ? [seat.netPort, ...portOptions] : portOptions;
  return (
    <section>
      <h3>Seat</h3>
      <label className="field">
        Guest
        <select
          value={occupant?.personId ?? ""}
          onChange={(e) => update((d) => {
            if (e.target.value) assignSeat(d, e.target.value, id);
            else for (const a of d.attendance) if (a.seatId === id) a.seatId = null;
          })}
        >
          <option value="">Empty</option>
          {doc.attendance.map((a) => (
            <option key={a.personId} value={a.personId}>
              {people.find((p) => p.id === a.personId)?.name ?? a.personId}{a.seatId && a.seatId !== id ? " (seated)" : ""}
            </option>
          ))}
        </select>
      </label>
      {load && load.deviceCount > 0 && <p className="muted">{load.deviceCount} devices, {Math.round(load.typicalW)} W typical, {Math.round(load.peakW)} W peak</p>}
      <label className="field">
        Power strip
        <select value={seat.stripId ?? ""} onChange={(e) => set((s) => void (s.stripId = e.target.value || null))}>
          <option value="">None</option>
          {doc.strips.map((s) => <option key={s.id} value={s.id}>{s.label || s.id}</option>)}
        </select>
      </label>
      <div className="row">
        <label className="field" style={{ flex: 1 }}>
          Switch
          <select value={seat.netDeviceId ?? ""} onChange={(e) => set((s) => { s.netDeviceId = e.target.value || null; s.netPort = null; })}>
            <option value="">None</option>
            {switches.map((d) => <option key={d.id} value={d.id}>{d.label || d.id}</option>)}
          </select>
        </label>
        <label className="field" style={{ width: 90 }}>
          Port
          <select disabled={!seat.netDeviceId} value={seat.netPort ?? ""} onChange={(e) => set((s) => void (s.netPort = e.target.value === "" ? null : Number(e.target.value)))}>
            <option value="">Auto</option>
            {ports2.map((p) => <option key={p} value={p}>{p + 1}</option>)}
          </select>
        </label>
      </div>
      <NumberField label="Cable length override" suffix="ft" step={1} value={seat.cableOverrideFt ?? 0} onChange={(v) => set((s) => void (s.cableOverrideFt = v > 0 ? v : null))} />
      {seat.manual && <button className="btn" onClick={() => update((d) => resetSeat(d, id))}>Snap back to table</button>}
    </section>
  );
}

function StripInspector({ id, clear }: { id: string; clear: () => void }) {
  const { doc, report } = useEventCtx();
  const update = useEventDoc((s) => s.update);
  const strip = doc.strips.find((s) => s.id === id);
  const r = report.strips.find((s) => s.id === id);
  if (!strip) return null;
  const set = (f: (s: NonNullable<typeof strip>) => void) => update((d) => { const t = d.strips.find((x) => x.id === id); if (t) f(t); }, { key: `strip-${id}` });
  return (
    <section>
      <h3>Power strip {r && <LevelBadge level={r.level} />}</h3>
      <TextField label="Label" value={strip.label} onChange={(v) => set((s) => void (s.label = v))} />
      <div className="row">
        <div style={{ flex: 1 }}><NumberField label="Sockets" step={1} min={1} value={strip.sockets} onChange={(v) => set((s) => void (s.sockets = Math.max(1, Math.round(v))))} /></div>
        <div style={{ flex: 1 }}><NumberField label="Rating" suffix="A" step={1} value={strip.amps} onChange={(v) => set((s) => void (s.amps = v))} /></div>
      </div>
      <PlugSelect value={encodePlug(strip.pluggedInto)} excludeStrip={id} onChange={(v) => set((s) => void (s.pluggedInto = v))} />
      {r && (
        <Gauge label="Load" level={r.level} typicalA={r.typicalA} peakA={r.peakA} ratingA={r.ratingA} detail={`${r.socketsUsed} of ${r.socketsTotal} sockets used`} />
      )}
      <button className="btn danger" onClick={() => { update((d) => removeStrip(d, id)); clear(); }}>Delete strip</button>
    </section>
  );
}

function DeviceInspector({ id, clear }: { id: string; clear: () => void }) {
  const { doc, profiles } = useEventCtx();
  const update = useEventDoc((s) => s.update);
  const dev = doc.devices.find((d) => d.id === id);
  if (!dev) return null;
  const profile = profiles.find((p) => p.id === dev.profileId);
  const set = (f: (d: NonNullable<typeof dev>) => void) => update((d) => { const t = d.devices.find((x) => x.id === id); if (t) f(t); }, { key: `dev-${id}` });
  const uplinks = doc.uplinks.filter((u) => u.fromDeviceId === id || u.toDeviceId === id);
  const others = doc.devices.filter((d) => d.id !== id && !uplinks.some((u) => u.fromDeviceId === d.id || u.toDeviceId === d.id));
  const nameOf = (x: string) => doc.devices.find((d) => d.id === x)?.label || x;
  return (
    <section>
      <h3>Network device</h3>
      <TextField label="Label" value={dev.label} onChange={(v) => set((d) => void (d.label = v))} />
      <label className="field">
        Profile
        <select value={dev.profileId} onChange={(e) => set((d) => { d.profileId = e.target.value; d.typicalW = undefined; d.peakW = undefined; d.ports = undefined; })}>
          {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>
      <div className="row">
        <div style={{ flex: 1 }}><NumberField label="Typical W" step={5} value={dev.typicalW ?? profile?.typicalW ?? 0} onChange={(v) => set((d) => void (d.typicalW = v))} /></div>
        <div style={{ flex: 1 }}><NumberField label="Peak W" step={5} value={dev.peakW ?? profile?.peakW ?? 0} onChange={(v) => set((d) => void (d.peakW = v))} /></div>
        <div style={{ width: 70 }}><NumberField label="Ports" step={1} min={0} value={dev.ports ?? profile?.ports ?? 0} onChange={(v) => set((d) => void (d.ports = Math.max(0, Math.round(v))))} /></div>
      </div>
      <PlugSelect value={encodePlug(dev.pluggedInto)} onChange={(v) => set((d) => void (d.pluggedInto = v))} />
      <h3>Uplinks</h3>
      {uplinks.map((u) => {
        const other = u.fromDeviceId === id ? u.toDeviceId : u.fromDeviceId;
        return (
          <div key={u.id} className="row">
            <span className="grow">To {nameOf(other)}</span>
            <button className="btn small danger" onClick={() => update((d) => void (d.uplinks = d.uplinks.filter((x) => x.id !== u.id)))}>Remove</button>
          </div>
        );
      })}
      {others.length > 0 && (
        <select aria-label="Add uplink" value="" onChange={(e) => e.target.value && update((d) => void d.uplinks.push({ id: newId("up"), fromDeviceId: id, toDeviceId: e.target.value, overrideFt: null }))}>
          <option value="">Connect to another switch…</option>
          {others.map((d) => <option key={d.id} value={d.id}>{d.label || d.id}</option>)}
        </select>
      )}
      <button className="btn danger" onClick={() => { update((d) => removeDevice(d, id)); clear(); }}>Delete device</button>
    </section>
  );
}

function OutletInspector({ id }: { id: string }) {
  const { venue, report, doc } = useEventCtx();
  const update = useEventDoc((s) => s.update);
  const o = venue.outlets.find((x) => x.id === id);
  const r = report.outlets.find((x) => x.id === id);
  if (!o || !r) return null;
  const circuit = venue.circuits.find((c) => c.id === o.circuitId);
  return (
    <section>
      <h3>{outletName(venue, id)}</h3>
      <p className="muted">{circuit ? `On ${circuit.label} (${circuit.amps}A)` : "Breaker unknown. Load here is unverified."}</p>
      <Gauge label="Outlet load" level={r.level} typicalA={r.typicalA} peakA={r.peakA} ratingA={r.ratingA} detail={`${r.socketsUsed} of ${r.socketsTotal} plugs used`} />
      <button className="btn" onClick={() => update((d) => void d.cords.push({ id: newId("cord"), label: `Cord ${doc.cords.length + 1}`, gauge: 14, amps: 15, outletId: id, overrideFt: null }))}>
        Add extension cord from here
      </button>
      <p className="muted">Move or edit outlets in the venue editor.</p>
    </section>
  );
}

export function CordsPanel() {
  const { doc, venue, report } = useEventCtx();
  const update = useEventDoc((s) => s.update);
  if (doc.cords.length === 0) return null;
  return (
    <section>
      <h3>Extension cords</h3>
      {doc.cords.map((c) => {
        const r = report.cords.find((x) => x.id === c.id);
        const set = (f: (x: typeof c) => void) => update((d) => { const t = d.cords.find((x) => x.id === c.id); if (t) f(t); }, { key: `cord-${c.id}` });
        return (
          <div key={c.id} className="stack" style={{ gap: 6 }}>
            <div className="row">
              <input type="text" aria-label="Cord name" value={c.label} style={{ flex: 1, minWidth: 0 }} onChange={(e) => set((x) => void (x.label = e.target.value))} />
              {r && <LevelBadge level={r.level} />}
            </div>
            <div className="row">
              <select aria-label="Cord outlet" value={c.outletId ?? ""} style={{ flex: 1, minWidth: 0 }} onChange={(e) => set((x) => void (x.outletId = e.target.value || null))}>
                <option value="">No outlet</option>
                {venue.outlets.map((o) => <option key={o.id} value={o.id}>{outletName(venue, o.id)}</option>)}
              </select>
              <select aria-label="Cord gauge and rating" value={`${c.gauge}/${c.amps}`} style={{ width: 96 }}
                onChange={(e) => { const [g, a] = e.target.value.split("/").map(Number); set((x) => { x.gauge = g!; x.amps = a!; }); }}>
                <option value="16/10">16 AWG 10A</option>
                <option value="14/15">14 AWG 15A</option>
                <option value="12/20">12 AWG 20A</option>
              </select>
              <button className="btn small danger" onClick={() => update((d) => removeCord(d, c.id))}>Remove</button>
            </div>
            {r && <Gauge label="Cord load" level={r.level} typicalA={r.typicalA} peakA={r.peakA} ratingA={r.ratingA} />}
          </div>
        );
      })}
    </section>
  );
}
