import { useMemo, useState } from "react";
import { autoWire, type Level, type Point } from "@lpd/shared";
import { FloorPlan, type Selection, type Tool } from "../canvas/FloorPlan";
import { useEditorKeys } from "../lib/keys";
import { Gauge, newId, toast } from "../lib/ui";
import { Icons } from "../panels/Icons";
import { TABLE_PRESETS, addTable, assignSeat, moveTable, removeCord, removeDevice, removeStrip, removeTable, seatName, shortName } from "../store/eventOps";
import { useEventDoc } from "../store/eventStore";
import { useEventCtx } from "./eventContext";
import { CordsPanel, EventInspector } from "./EventInspector";

const TOOLS: { tool: Tool; label: string }[] = [
  { tool: "select", label: "Select" },
  { tool: "table", label: "Table" },
  { tool: "strip", label: "Strip" },
  { tool: "device", label: "Switch" },
];

export function PlanTab() {
  const { venue, doc, people, profiles, report, seatLabels } = useEventCtx();
  const { update, undo, redo } = useEventDoc.getState();
  const canUndo = useEventDoc((s) => s.past.length > 0);
  const canRedo = useEventDoc((s) => s.future.length > 0);

  const [tool, setTool] = useState<Tool>("select");
  const [selection, setSelection] = useState<Selection | null>(null);
  const [snap, setSnap] = useState(true);
  const [showPower, setShowPower] = useState(true);
  const [showNet, setShowNet] = useState(true);
  const [preset, setPreset] = useState("folding-6");
  const [profileId, setProfileId] = useState("switch-16");
  const [unplaced, setUnplaced] = useState<{ seatId: string; kind: string; reason: string }[]>([]);

  const levels = useMemo(() => {
    const out: Record<string, Level> = {};
    for (const r of [...report.strips, ...report.outlets]) out[r.id] = r.level;
    return out;
  }, [report]);

  const clear = () => setSelection(null);

  const remove = () => {
    if (!selection) return;
    update((d) => {
      if (selection.kind === "table") removeTable(d, selection.id);
      if (selection.kind === "strip") removeStrip(d, selection.id);
      if (selection.kind === "device") removeDevice(d, selection.id);
      if (selection.kind === "cord") removeCord(d, selection.id);
    });
    clear();
  };

  useEditorKeys({
    undo: () => useEventDoc.getState().undo(),
    redo: () => useEventDoc.getState().redo(),
    remove,
    escape: () => { setTool("select"); clear(); },
    enter: () => {},
  });

  const place = (pt: Point) => {
    const id = newId(tool === "device" ? "dev" : tool);
    if (tool === "table") update((d) => addTable(d, preset, pt, id));
    if (tool === "strip") update((d) => void d.strips.push({ id, label: `Strip ${d.strips.length + 1}`, x: pt.x, y: pt.y, sockets: 6, amps: 15, pluggedInto: null }));
    if (tool === "device") {
      const p = profiles.find((x) => x.id === profileId);
      update((d) => void d.devices.push({ id, label: `${p?.kind === "router" ? "Router" : "Switch"} ${d.devices.length + 1}`, profileId, x: pt.x, y: pt.y, pluggedInto: null }));
    }
    if (tool === "table" || tool === "strip" || tool === "device") {
      setSelection({ kind: tool === "device" ? "device" : tool, id });
      setTool("select");
    }
  };

  const onDragEnd = (s: Selection, pt: Point) =>
    update((d) => {
      if (s.kind === "table") return moveTable(d, s.id, pt);
      if (s.kind === "seat") {
        const seat = d.seats.find((x) => x.id === s.id);
        if (seat) Object.assign(seat, pt, { manual: true });
      }
      if (s.kind === "strip") Object.assign(d.strips.find((x) => x.id === s.id) ?? {}, pt);
      if (s.kind === "device") Object.assign(d.devices.find((x) => x.id === s.id) ?? {}, pt);
    });

  const onDropPerson = (personId: string, pt: Point) => {
    // nearest seat within reach of the drop
    let best: { id: string; d: number } | null = null;
    for (const s of doc.seats) {
      const d = Math.hypot(s.x - pt.x, s.y - pt.y);
      if (d < 1.2 && (!best || d < best.d)) best = { id: s.id, d };
    }
    if (best) update((d) => assignSeat(d, personId, best!.id));
    else toast("Drop a guest onto a seat.");
  };

  const runAutoWire = () => {
    const result = autoWire({ venue, event: doc, people, profiles });
    update((d) => void (d.seats = result.event.seats));
    setUnplaced(result.unplaced);
    toast(result.unplaced.length ? `Auto-wired. ${result.unplaced.length} seats could not be placed.` : "Auto-wired every seat.");
  };

  const guests = doc.attendance.filter((a) => a.rsvp !== "declined");
  const warnTarget = (refId: string): Selection | null => {
    if (doc.strips.some((s) => s.id === refId)) return { kind: "strip", id: refId };
    if (doc.seats.some((s) => s.id === refId)) return { kind: "seat", id: refId };
    if (venue.outlets.some((s) => s.id === refId)) return { kind: "outlet", id: refId };
    return null;
  };

  return (
    <div className="workspace">
      <div className="rail no-print" role="toolbar" aria-label="Tools">
        {TOOLS.map((t) => (
          <button key={t.tool} className="btn" aria-pressed={tool === t.tool} title={t.label} onClick={() => setTool(t.tool)}>
            {Icons[t.tool === "device" ? "device" : (t.tool as "select" | "table" | "strip")]}
            {t.label}
          </button>
        ))}
        <button className="btn" onClick={() => undo()} disabled={!canUndo} title="Undo (Ctrl+Z)">{Icons.undo}Undo</button>
        <button className="btn" onClick={() => redo()} disabled={!canRedo} title="Redo (Ctrl+Shift+Z)">{Icons.redo}Redo</button>
      </div>

      <div style={{ position: "relative", minWidth: 0, minHeight: 0, display: "flex" }}>
        <div style={{ flex: 1, minWidth: 0, position: "relative" }}>
          <FloorPlan
            venue={venue}
            event={doc}
            tool={tool}
            selection={selection}
            snap={snap}
            showPower={showPower}
            showNet={showNet}
            roomDraft={[]}
            calibration={[]}
            levels={levels}
            seatLabels={seatLabels}
            seatTint={{}}
            onSelect={setSelection}
            onCanvasClick={place}
            onDragEnd={onDragEnd}
            onRoomVertexMove={() => {}}
            onRoomVertexRemove={() => {}}
            onRoomFinish={() => {}}
            onDropPerson={onDropPerson}
          />
          <div className="roster-dock no-print">
            <header>Guests <span className="muted">{guests.length}</span></header>
            {guests.length === 0 && <p className="muted" style={{ padding: "0 10px" }}>Add guests on the Roster tab, then drag them onto seats.</p>}
            {guests.map((a) => {
              const person = people.find((p) => p.id === a.personId);
              return (
                <div
                  key={a.personId}
                  className={`chip ${a.seatId ? "seated" : ""}`}
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData("text/x-person", a.personId)}
                  title={a.seatId ? `At ${seatName(doc, a.seatId)}. Drag to move.` : "Drag onto a seat"}
                >
                  <strong>{shortName(person)}</strong>
                  <span className="muted" style={{ marginLeft: "auto" }}>{a.seatId ? seatName(doc, a.seatId) : a.rsvp}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <aside className="side">
        <section>
          <label className="check field"><input type="checkbox" checked={snap} onChange={(e) => setSnap(e.target.checked)} />Snap to half-foot grid</label>
          <label className="check field"><input type="checkbox" checked={showPower} onChange={(e) => setShowPower(e.target.checked)} /><span style={{ color: "var(--power)" }}>Show power wiring</span></label>
          <label className="check field"><input type="checkbox" checked={showNet} onChange={(e) => setShowNet(e.target.checked)} /><span style={{ color: "var(--net)" }}>Show network cables</span></label>
          {tool === "table" && (
            <label className="field">Table to place
              <select value={preset} onChange={(e) => setPreset(e.target.value)}>
                {TABLE_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </label>
          )}
          {tool === "device" && (
            <label className="field">Device to place
              <select value={profileId} onChange={(e) => setProfileId(e.target.value)}>
                {profiles.filter((p) => p.ports > 0).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
          )}
          <button className="btn primary" onClick={runAutoWire} disabled={doc.seats.length === 0}>Auto-wire seats</button>
          {unplaced.length > 0 && (
            <ul className="warnlist" aria-label="Seats auto-wire could not place">
              {unplaced.map((u, i) => (
                <li key={i}><button onClick={() => setSelection({ kind: "seat", id: u.seatId })}><span className="dot warn" /><span>{seatName(doc, u.seatId)}: {u.reason}</span></button></li>
              ))}
            </ul>
          )}
        </section>

        <EventInspector selection={selection} clear={clear} />

        <section>
          <h3>Warnings <span className="badge info">{report.warnings.length}</span></h3>
          {report.warnings.length === 0 ? (
            <p className="muted">Nothing to fix.</p>
          ) : (
            <ul className="warnlist" style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {report.warnings.map((w, i) => (
                <li key={i}>
                  <button onClick={() => { const t = warnTarget(w.refId); if (t) setSelection(t); }}>
                    <span className={`dot ${w.level}`} aria-hidden />
                    <span><span className="sr-only">{w.level === "danger" ? "Problem: " : "Warning: "}</span>{w.message}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h3>Breakers</h3>
          {report.circuits.length === 0 && <p className="muted">No breakers set up in this venue.</p>}
          {report.circuits.map((c) => (
            <Gauge key={c.id} label={c.label} level={c.level} typicalA={c.typicalA} peakA={c.peakA} ratingA={c.ratingA} />
          ))}
          {report.unverified.peakW > 0 && <p className="muted">{Math.round(report.unverified.typicalW)} W on outlets with an unknown breaker.</p>}
        </section>

        <CordsPanel />
      </aside>
    </div>
  );
}

