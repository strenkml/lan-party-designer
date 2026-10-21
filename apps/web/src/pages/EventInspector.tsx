import { useMemo, useState } from "react";
import { cableConnections, cordRuns, ethernetRuns, powerRuns, type ZoneKind } from "@lpd/shared";
import type { Selection } from "../canvas/FloorPlan";
import type { GroupMember } from "@lpd/shared";
import { api } from "../lib/api";
import { invalidate } from "../lib/queries";
import { Gauge, LevelBadge, NameDialog, NumberField, TextField, newId, toast } from "../lib/ui";
import {
  assignSeat,
  decodePlug,
  deleteCable,
  disconnectDevice,
  disconnectOutlet,
  disconnectStrip,
  groupObjects,
  ungroup,
  removeZone,
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
    case "zone": return <ZoneInspector id={selection.id} clear={clear} />;
    case "cable": return <CableInspector routeKey={selection.id} clear={clear} />;
    default: return null;
  }
}


const LINK_SPEEDS = [10, 100, 1000, 2500, 10000];
const speedLabel = (n: number) => (n >= 1000 ? `${n / 1000} Gbps` : `${n} Mbps`);
/** Options for a link speed select, keeping an unusual current value selectable. */
function speedOptions(current: number) {
  const speeds = LINK_SPEEDS.includes(current) || current <= 0 ? LINK_SPEEDS : [...LINK_SPEEDS, current].sort((a, b) => a - b);
  return speeds.map((n) => <option key={n} value={n}>{speedLabel(n)}</option>);
}

function RotateField({ value, onChange }: { value: number; onChange: (deg: number) => void }) {
  return (
    <div className="row" style={{ alignItems: "end" }}>
      <div style={{ flex: 1 }}>
        <NumberField label="Rotation" suffix="deg" step={15} value={value} onChange={onChange} />
      </div>
      <button className="btn" onClick={() => onChange(((Math.round(value) + 90) % 360 + 360) % 360)}>Rotate 90°</button>
    </div>
  );
}

function CableInspector({ routeKey, clear }: { routeKey: string; clear: () => void }) {
  const { venue, doc } = useEventCtx();
  const update = useEventDoc((s) => s.update);
  const cn = cableConnections(venue, doc).find((c) => c.key === routeKey);
  const length = useMemo(() => {
    const eth = ethernetRuns(doc, venue).find((r) => r.key === routeKey);
    if (eth) return eth.lengthFt;
    const pwr = powerRuns(venue, doc).find((r) => r.key === routeKey);
    if (pwr) return pwr.lengthFt;
    const cord = cordRuns(venue, doc).find((r) => `pwr:cord:${r.id}` === routeKey);
    return cord?.lengthFt ?? 0;
  }, [doc, venue, routeKey]);
  if (!cn) return null;
  const set = (points: typeof cn.waypoints) =>
    update((d) => { if (points.length === 0) delete d.routes[routeKey]; else d.routes[routeKey] = points; });
  const addBend = () => {
    // split the longest leg of the cable in half
    const pts = [cn.from, ...cn.waypoints, cn.to];
    let at = 0, longest = -1;
    for (let i = 0; i < pts.length - 1; i++) {
      const len = Math.abs(pts[i + 1]!.x - pts[i]!.x) + Math.abs(pts[i + 1]!.y - pts[i]!.y);
      if (len > longest) { longest = len; at = i; }
    }
    const a = pts[at]!, b = pts[at + 1]!;
    set([...cn.waypoints.slice(0, at), { x: Math.round(((a.x + b.x) / 2) * 2) / 2, y: Math.round(((a.y + b.y) / 2) * 2) / 2 }, ...cn.waypoints.slice(at)]);
  };
  return (
    <section>
      <h3>{cn.kind === "ethernet" ? "Ethernet cable" : "Power cable"}</h3>
      <p style={{ margin: 0 }}><strong>{cn.fromName}</strong> to <strong>{cn.toName}</strong></p>
      <p className="muted" style={{ margin: 0 }}>
        {cn.waypoints.length === 0 ? "Straight across the floor." : `${cn.waypoints.length} bend${cn.waypoints.length === 1 ? "" : "s"}.`}
        {length > 0 ? ` Needs a ${length} ft cable, including slack and the drop at each end.` : ""}
      </p>
      <div className="row">
        <button className="btn" onClick={addBend}>Add a bend</button>
        <button className="btn" disabled={cn.waypoints.length === 0} onClick={() => set([])}>Clear route</button>
      </div>
      <p className="muted" style={{ margin: 0 }}>
        Drag the dots to reshape the route. Click a + to add a bend there. Double-click a dot to remove it.
      </p>
      <div className="row">
        <button className="btn" onClick={clear}>Done</button>
        <button className="btn danger" onClick={() => { update((d) => void deleteCable(d, routeKey)); clear(); }}>Delete cable</button>
      </div>
    </section>
  );
}

function ZoneInspector({ id, clear }: { id: string; clear: () => void }) {
  const z = useEventDoc((s) => s.doc.zones.find((x) => x.id === id));
  const update = useEventDoc((s) => s.update);
  if (!z) return null;
  const set = (f: (x: NonNullable<typeof z>) => void) => update((d) => { const t = d.zones.find((x) => x.id === id); if (t) f(t); }, { key: `zone-${id}` });
  return (
    <section>
      <h3>Zone</h3>
      <TextField label="Label" value={z.label} onChange={(v) => set((t) => void (t.label = v))} />
      <label className="field">
        Kind
        <select value={z.kind} onChange={(e) => set((t) => void (t.kind = e.target.value as ZoneKind))}>
          <option value="walkway">Walkway (keep clear)</option>
          <option value="food">Food</option>
          <option value="storage">Storage</option>
          <option value="stage">Stage or screen</option>
          <option value="other">Other</option>
        </select>
      </label>
      <div className="row">
        <div style={{ flex: 1 }}><NumberField label="Width" suffix="ft" min={1} value={z.width} onChange={(v) => set((t) => void (t.width = Math.max(1, v)))} /></div>
        <div style={{ flex: 1 }}><NumberField label="Depth" suffix="ft" min={1} value={z.depth} onChange={(v) => set((t) => void (t.depth = Math.max(1, v)))} /></div>
      </div>
      <RotateField value={z.rotation} onChange={(v) => set((t) => void (t.rotation = v))} />
      {z.kind === "walkway" && <p className="muted" style={{ margin: 0 }}>Tables, chairs, strips and switches inside a walkway are listed under Warnings.</p>}
      <button className="btn danger" onClick={() => { update((d) => removeZone(d, id)); clear(); }}>Delete zone</button>
    </section>
  );
}

const KIND_NAME: Record<string, string> = { table: "Table", strip: "Power strip", device: "Network device", zone: "Zone" };

function memberName(doc: ReturnType<typeof useEventCtx>["doc"], m: { kind: string; id: string }) {
  const item =
    m.kind === "table" ? doc.tables.find((x) => x.id === m.id)
    : m.kind === "strip" ? doc.strips.find((x) => x.id === m.id)
    : m.kind === "device" ? doc.devices.find((x) => x.id === m.id)
    : doc.zones.find((x) => x.id === m.id);
  return item?.label || `${KIND_NAME[m.kind] ?? m.kind}`;
}

export function GroupInspector({ groupId }: { groupId: string }) {
  const { doc } = useEventCtx();
  const update = useEventDoc((s) => s.update);
  const g = doc.groups.find((x) => x.id === groupId);
  if (!g) return null;
  return (
    <section>
      <h3>Group</h3>
      <TextField label="Group name" value={g.label} onChange={(v) => update((d) => { const t = d.groups.find((x) => x.id === groupId); if (t) t.label = v; }, { key: `group-${groupId}` })} />
      <p className="muted" style={{ margin: 0 }}>
        {g.members.length} objects move together: {g.members.map((m) => memberName(doc, m)).join(", ")}.
      </p>
      <button className="btn" onClick={() => update((d) => ungroup(d, groupId))}>Ungroup</button>
    </section>
  );
}

export function MultiInspector({ picked, clear }: { picked: Selection[]; clear: () => void }) {
  const { doc } = useEventCtx();
  const update = useEventDoc((s) => s.update);
  const members = picked.filter((p) => ["table", "strip", "device", "zone"].includes(p.kind)).map((p) => ({ kind: p.kind, id: p.id }) as GroupMember);
  return (
    <section>
      <h3>{picked.length} objects selected</h3>
      <p className="muted" style={{ margin: 0 }}>{members.map((m) => memberName(doc, m)).join(", ")}</p>
      <button className="btn primary" disabled={members.length < 2} onClick={() => { update((d) => void groupObjects(d, members)); clear(); }}>
        Group these objects
      </button>
      <p className="muted" style={{ margin: 0 }}>Shift-click to add or remove objects. Drag any one of them to move them all.</p>
    </section>
  );
}

/** Unplugs everything attached to one item. Undo with Ctrl+Z brings it all back. */
function DisconnectButton({ count, run }: { count: number; run: () => number }) {
  return (
    <button
      className="btn"
      disabled={count === 0}
      title={count === 0 ? "Nothing is connected" : `Remove all ${count} connections`}
      onClick={() => {
        const n = run();
        toast(`Disconnected ${n} ${n === 1 ? "connection" : "connections"}. Press Ctrl+Z to undo.`);
      }}
    >
      Disconnect everything{count > 0 ? ` (${count})` : ""}
    </button>
  );
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
  const [saving, setSaving] = useState(false);
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
      {t.shape === "rect" && (
        <label className="field">
          Seats on
          <select value={t.seatSides} onChange={(e) => patch({ seatSides: e.target.value as typeof t.seatSides })}>
            <option value="both">Both long sides</option>
            <option value="far">One side (top edge)</option>
            <option value="near">One side (bottom edge)</option>
          </select>
        </label>
      )}
      {t.shape === "rect" && t.seatSides !== "both" && (
        <p className="muted" style={{ margin: 0 }}>
          Guests seated on the side you switch off become unseated. Rotate the table to choose which wall the seats face.
        </p>
      )}
      <button className="btn" onClick={() => setSaving(true)}>Save as a custom table…</button>
      {saving && (
        <NameDialog
          title="Save as a custom table"
          initial={t.label}
          action="Save table"
          onClose={() => setSaving(false)}
          onSubmit={async (name) => {
            await api.createPreset({ kind: "table", name, spec: { shape: t.shape, width: t.width, depth: t.depth, seats: t.seats, seatWidthIn: t.seatWidthIn, seatSides: t.seatSides } })
              .then(() => { invalidate("presets"); toast(`Saved "${name}". Find it under Your tables when placing.`); })
              .catch((e) => toast(e.message));
          }}
        />
      )}
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
  const [saving, setSaving] = useState(false);
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
      <RotateField value={strip.rotation} onChange={(v) => set((s) => void (s.rotation = v))} />
      <PlugSelect value={encodePlug(strip.pluggedInto)} excludeStrip={id} onChange={(v) => set((s) => void (s.pluggedInto = v))} />
      {r && (
        <Gauge label="Load" level={r.level} typicalA={r.typicalA} peakA={r.peakA} ratingA={r.ratingA} detail={`${r.socketsUsed} of ${r.socketsTotal} sockets used`} />
      )}
      <DisconnectButton
        count={disconnectStrip(structuredClone(doc), id)}
        run={() => { let n = 0; update((d) => void (n = disconnectStrip(d, id))); return n; }}
      />
      <button className="btn" onClick={() => setSaving(true)}>Save as a custom strip…</button>
      {saving && (
        <NameDialog
          title="Save as a custom power strip"
          initial={strip.label}
          action="Save strip"
          onClose={() => setSaving(false)}
          onSubmit={async (name) => {
            await api.createPreset({ kind: "strip", name, spec: { sockets: strip.sockets, amps: strip.amps } })
              .then(() => { invalidate("presets"); toast(`Saved "${name}". Find it under Your strips when placing.`); })
              .catch((e) => toast(e.message));
          }}
        />
      )}
      <button className="btn danger" onClick={() => { update((d) => removeStrip(d, id)); clear(); }}>Delete strip</button>
    </section>
  );
}

function DeviceInspector({ id, clear }: { id: string; clear: () => void }) {
  const { doc, profiles, venue } = useEventCtx();
  const update = useEventDoc((s) => s.update);
  const dev = doc.devices.find((d) => d.id === id);
  const [saving, setSaving] = useState(false);
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
      <label className="field">
        Port speed
        <select value={dev.portMbps} onChange={(e) => set((d) => void (d.portMbps = Number(e.target.value)))}>
          {speedOptions(dev.portMbps)}
        </select>
      </label>
      <RotateField value={dev.rotation} onChange={(v) => set((d) => void (d.rotation = v))} />
      <PlugSelect value={encodePlug(dev.pluggedInto)} onChange={(v) => set((d) => void (d.pluggedInto = v))} />
      {venue.jacks.length > 0 && (
        <label className="field">
          Uplink to wall jack
          <select value={dev.jackId ?? ""} onChange={(e) => set((d) => void (d.jackId = e.target.value || null))}>
            <option value="">None</option>
            {venue.jacks.map((j) => <option key={j.id} value={j.id}>{j.label || j.id}</option>)}
          </select>
        </label>
      )}
      <h3>Uplinks</h3>
      {uplinks.map((u) => {
        const other = u.fromDeviceId === id ? u.toDeviceId : u.fromDeviceId;
        return (
          <div key={u.id} className="row">
            <span className="grow">To {nameOf(other)}</span>
            <select aria-label={`Speed of uplink to ${nameOf(other)}`} value={u.mbps ?? ""} onChange={(e) => update((d) => { const t = d.uplinks.find((x) => x.id === u.id); if (t) t.mbps = e.target.value ? Number(e.target.value) : null; })}>
              <option value="">Auto speed</option>
              {speedOptions(u.mbps ?? 0)}
            </select>
            <button className="btn small danger" onClick={() => update((d) => void (d.uplinks = d.uplinks.filter((x) => x.id !== u.id)))}>Remove</button>
          </div>
        );
      })}
      {others.length > 0 && (
        <select aria-label="Add uplink" value="" onChange={(e) => e.target.value && update((d) => void d.uplinks.push({ id: newId("up"), fromDeviceId: id, toDeviceId: e.target.value, overrideFt: null, mbps: null }))}>
          <option value="">Connect to another switch…</option>
          {others.map((d) => <option key={d.id} value={d.id}>{d.label || d.id}</option>)}
        </select>
      )}
      <DisconnectButton
        count={disconnectDevice(structuredClone(doc), id)}
        run={() => { let n = 0; update((d) => void (n = disconnectDevice(d, id))); return n; }}
      />
      <button className="btn" onClick={() => setSaving(true)}>Save as a custom switch…</button>
      {saving && (
        <NameDialog
          title="Save as a custom switch"
          initial={dev.label}
          action="Save switch"
          onClose={() => setSaving(false)}
          onSubmit={async (name) => {
            try {
              const created = await api.createProfile({
                name,
                kind: profile?.kind === "router" ? "router" : "switch",
                typicalW: dev.typicalW ?? profile?.typicalW ?? 0,
                peakW: dev.peakW ?? profile?.peakW ?? 0,
                ports: dev.ports ?? profile?.ports ?? 0,
              });
              await invalidate("profiles");
              update((d) => { const t = d.devices.find((x) => x.id === id); if (t) { t.profileId = created.id; t.typicalW = undefined; t.peakW = undefined; t.ports = undefined; } });
              toast(`Saved "${name}". It is in the switch list and under Device profiles.`);
            } catch (e) { toast((e as Error).message); }
          }}
        />
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
      <DisconnectButton
        count={disconnectOutlet(structuredClone(doc), id)}
        run={() => { let n = 0; update((d) => void (n = disconnectOutlet(d, id))); return n; }}
      />
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
