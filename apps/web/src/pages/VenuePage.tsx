import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { VenueDoc, type Circuit, type Point } from "@lpd/shared";
import { FloorPlan, CIRCUIT_COLORS, type Selection, type Tool } from "../canvas/FloorPlan";
import { api, uploadUrl } from "../lib/api";
import { useEditorKeys } from "../lib/keys";
import { invalidate } from "../lib/queries";
import { href } from "../lib/route";
import { Dialog, NumberField, TextField, newId, toast } from "../lib/ui";
import { useAutosave } from "../lib/useAutosave";
import { Icons } from "../panels/Icons";
import { TopBar } from "../panels/TopBar";
import { createDocStore } from "../store/docStore";

const useVenueDoc = createDocStore<VenueDoc>(VenueDoc.parse({}));

const TOOLS: { tool: Tool; label: string }[] = [
  { tool: "select", label: "Select" },
  { tool: "room", label: "Room" },
  { tool: "door", label: "Door" },
  { tool: "obstacle", label: "Obstacle" },
  { tool: "outlet", label: "Outlet" },
];

export function VenuePage({ id }: { id: string }) {
  const q = useQuery({ queryKey: ["venue", id], queryFn: () => api.venue(id), staleTime: Infinity, gcTime: 0 });
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (q.data) {
      useVenueDoc.getState().load(VenueDoc.parse(q.data.doc));
      setReady(true);
    }
  }, [q.data]);

  const { status } = useAutosave(useVenueDoc, (doc) => api.saveVenue(id, { doc }).then(() => invalidate("venues")), ready);

  if (q.error) return <div className="app"><TopBar /><main className="page"><div className="empty">Venue not found.</div></main></div>;
  if (!ready || !q.data) return <div className="app"><TopBar /><main className="page muted">Loading…</main></div>;
  return <VenueEditor id={id} name={q.data.name} status={status} />;
}

function VenueEditor({ id, name, status }: { id: string; name: string; status: string }) {
  const { doc, update, undo, redo, past, future } = useVenueDoc();
  const [tool, setTool] = useState<Tool>("select");
  const [selection, setSelection] = useState<Selection | null>(null);
  const [snap, setSnap] = useState(true);
  const [roomDraft, setRoomDraft] = useState<Point[]>([]);
  const [calibration, setCalibration] = useState<Point[]>([]);
  const [paintCircuit, setPaintCircuit] = useState<string | null>(null);
  const [venueName, setVenueName] = useState(name);

  const finishRoom = () => {
    if (roomDraft.length >= 3) update((d) => void (d.room = roomDraft));
    else if (roomDraft.length > 0) toast("A room needs at least three corners.");
    setRoomDraft([]);
    setTool("select");
  };

  const deleteSelected = () => {
    if (!selection) return;
    update((d) => {
      if (selection.kind === "outlet") d.outlets = d.outlets.filter((o) => o.id !== selection.id);
      if (selection.kind === "door") d.doors = d.doors.filter((o) => o.id !== selection.id);
      if (selection.kind === "obstacle") d.obstacles = d.obstacles.filter((o) => o.id !== selection.id);
    });
    setSelection(null);
  };

  useEditorKeys({
    undo,
    redo,
    remove: deleteSelected,
    escape: () => {
      setTool("select");
      setRoomDraft([]);
      setCalibration([]);
      setPaintCircuit(null);
      setSelection(null);
    },
    enter: () => tool === "room" && finishRoom(),
  });

  const place = (pt: Point) => {
    if (tool === "room") return setRoomDraft((r) => [...r, pt]);
    if (tool === "calibrate") return setCalibration((c) => (c.length >= 2 ? [pt] : [...c, pt]));
    const newIdValue = newId(tool);
    update((d) => {
      if (tool === "door") d.doors.push({ id: newIdValue, x: pt.x, y: pt.y, width: 3, rotation: 0 });
      if (tool === "obstacle") d.obstacles.push({ id: newIdValue, label: "Obstacle", x: pt.x, y: pt.y, width: 3, depth: 3, rotation: 0 });
      if (tool === "outlet") d.outlets.push({ id: newIdValue, label: "", x: pt.x, y: pt.y, circuitId: paintCircuit, amps: 15 });
    });
    if (tool === "door" || tool === "obstacle" || tool === "outlet") setSelection({ kind: tool, id: newIdValue });
  };

  const onSelect = (s: Selection | null) => {
    if (s?.kind === "outlet" && paintCircuit) {
      update((d) => {
        const o = d.outlets.find((x) => x.id === s.id);
        if (o) o.circuitId = paintCircuit;
      });
    }
    setSelection(s);
  };

  const onDragEnd = (s: Selection, pt: Point) =>
    update((d) => {
      const list = s.kind === "outlet" ? d.outlets : s.kind === "door" ? d.doors : s.kind === "obstacle" ? d.obstacles : [];
      const item = list.find((x) => x.id === s.id);
      if (item) Object.assign(item, pt);
    });

  const calibrationDistance = calibration.length === 2 ? Math.hypot(calibration[0]!.x - calibration[1]!.x, calibration[0]!.y - calibration[1]!.y) : 0;

  return (
    <div className="app">
      <TopBar
        crumb={
          <>
            <span>Venue</span>
            <input
              type="text"
              aria-label="Venue name"
              value={venueName}
              style={{ fontWeight: 650, width: 220 }}
              onChange={(e) => setVenueName(e.target.value)}
              onBlur={() => venueName.trim() && api.saveVenue(id, { name: venueName.trim() }).then(() => invalidate("venues"))}
            />
          </>
        }
        right={<span className="muted" role="status">{status === "saving" ? "Saving…" : status === "saved" ? "Saved" : status === "error" ? "Save failed" : ""}</span>}
      />
      <div className="workspace">
        <div className="rail no-print" role="toolbar" aria-label="Tools">
          {TOOLS.map((t) => (
            <button key={t.tool} className="btn" aria-pressed={tool === t.tool} title={t.label}
              onClick={() => { setTool(t.tool); setRoomDraft([]); setCalibration([]); }}>
              {Icons[t.tool as keyof typeof Icons]}
              {t.label}
            </button>
          ))}
          <button className="btn" onClick={undo} disabled={past.length === 0} title="Undo (Ctrl+Z)">{Icons.undo}Undo</button>
          <button className="btn" onClick={redo} disabled={future.length === 0} title="Redo (Ctrl+Shift+Z)">{Icons.redo}Redo</button>
        </div>

        <FloorPlan
          venue={doc}
          tool={tool}
          selection={selection}
          snap={snap}
          showPower
          showNet
          roomDraft={roomDraft}
          calibration={calibration}
          levels={{}}
          seatLabels={{}}
          seatTint={{}}
          onSelect={onSelect}
          onCanvasClick={place}
          onDragEnd={onDragEnd}
          onRoomVertexMove={(i, pt) => update((d) => void (d.room[i] = pt))}
          onRoomVertexRemove={(i) => doc.room.length > 3 && update((d) => void d.room.splice(i, 1))}
          onRoomFinish={finishRoom}
          onDropPerson={() => {}}
        />

        <aside className="side">
          <section>
            <label className="check field">
              <input type="checkbox" checked={snap} onChange={(e) => setSnap(e.target.checked)} />
              Snap to half-foot grid
            </label>
            {paintCircuit && (
              <div className="badge warn" role="status">
                Tagging outlets: click an outlet to assign it. Esc to stop.
              </div>
            )}
          </section>
          <Inspector selection={selection} />
          <CircuitsPanel paint={paintCircuit} setPaint={(c) => { setPaintCircuit(c); setTool("select"); }} />
          <BackgroundPanel
            venueId={id}
            onCalibrate={() => { setTool("calibrate"); setCalibration([]); }}
          />
        </aside>
      </div>

      {calibration.length === 2 && (
        <CalibrateDialog
          measuredFt={calibrationDistance}
          onClose={() => { setCalibration([]); setTool("select"); }}
          onApply={(realFt) => {
            update((d) => {
              if (d.background) d.background.feetPerPixel *= realFt / calibrationDistance;
            });
            setCalibration([]);
            setTool("select");
          }}
        />
      )}
    </div>
  );
}

function Inspector({ selection }: { selection: Selection | null }) {
  const { doc, update } = useVenueDoc();
  if (!selection) {
    return (
      <section>
        <h3>Nothing selected</h3>
        <p className="muted">Draw the room outline, then add doors, obstacles and outlets. Drag anything to move it.</p>
      </section>
    );
  }
  const key = `${selection.kind}-${selection.id}`;
  if (selection.kind === "outlet") {
    const o = doc.outlets.find((x) => x.id === selection.id);
    if (!o) return null;
    const set = (f: (o: typeof doc.outlets[number]) => void) => update((d) => { const t = d.outlets.find((x) => x.id === o.id); if (t) f(t); }, { key });
    return (
      <section>
        <h3>Outlet</h3>
        <TextField label="Label" value={o.label} onChange={(v) => set((t) => void (t.label = v))} />
        <label className="field">
          Breaker
          <select value={o.circuitId ?? ""} onChange={(e) => set((t) => void (t.circuitId = e.target.value || null))}>
            <option value="">Unknown</option>
            {doc.circuits.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </label>
        <NumberField label="Outlet rating" suffix="A" step={5} value={o.amps} onChange={(v) => set((t) => void (t.amps = v))} />
      </section>
    );
  }
  if (selection.kind === "door") {
    const o = doc.doors.find((x) => x.id === selection.id);
    if (!o) return null;
    const set = (f: (o: typeof doc.doors[number]) => void) => update((d) => { const t = d.doors.find((x) => x.id === o.id); if (t) f(t); }, { key });
    return (
      <section>
        <h3>Door</h3>
        <NumberField label="Width" suffix="ft" value={o.width} min={1} onChange={(v) => set((t) => void (t.width = v))} />
        <NumberField label="Rotation" suffix="deg" step={90} value={o.rotation} onChange={(v) => set((t) => void (t.rotation = v))} />
      </section>
    );
  }
  if (selection.kind === "obstacle") {
    const o = doc.obstacles.find((x) => x.id === selection.id);
    if (!o) return null;
    const set = (f: (o: typeof doc.obstacles[number]) => void) => update((d) => { const t = d.obstacles.find((x) => x.id === o.id); if (t) f(t); }, { key });
    return (
      <section>
        <h3>Obstacle</h3>
        <TextField label="Label" value={o.label} onChange={(v) => set((t) => void (t.label = v))} />
        <NumberField label="Width" suffix="ft" value={o.width} min={0.5} onChange={(v) => set((t) => void (t.width = v))} />
        <NumberField label="Depth" suffix="ft" value={o.depth} min={0.5} onChange={(v) => set((t) => void (t.depth = v))} />
        <NumberField label="Rotation" suffix="deg" step={15} value={o.rotation} onChange={(v) => set((t) => void (t.rotation = v))} />
      </section>
    );
  }
  return null;
}

function CircuitsPanel({ paint, setPaint }: { paint: string | null; setPaint: (id: string | null) => void }) {
  const { doc, update } = useVenueDoc();
  const count = (id: string) => doc.outlets.filter((o) => o.circuitId === id).length;
  const unknown = doc.outlets.filter((o) => !o.circuitId || !doc.circuits.some((c) => c.id === o.circuitId)).length;
  return (
    <section>
      <h3>
        Breakers
        <button className="btn small" onClick={() => update((d) => void d.circuits.push({ id: newId("cb"), label: `Breaker ${d.circuits.length + 1}`, amps: 15 } as Circuit))}>
          Add breaker
        </button>
      </h3>
      {doc.circuits.length === 0 && <p className="muted">Add each breaker in the panel, then tag which outlets run on it. Untagged outlets are flagged as unverified in reports.</p>}
      {doc.circuits.map((c, i) => (
        <div key={c.id} className="stack" style={{ gap: 6 }}>
          <div className="row">
            <span aria-hidden style={{ width: 12, height: 12, borderRadius: 6, background: CIRCUIT_COLORS[i % CIRCUIT_COLORS.length] }} />
            <input type="text" aria-label="Breaker name" value={c.label} style={{ flex: 1, minWidth: 0 }}
              onChange={(e) => update((d) => { const t = d.circuits.find((x) => x.id === c.id); if (t) t.label = e.target.value; }, { key: `cb-${c.id}` })} />
            <select aria-label="Breaker amps" value={c.amps} style={{ width: 70 }}
              onChange={(e) => update((d) => { const t = d.circuits.find((x) => x.id === c.id); if (t) t.amps = Number(e.target.value) as 15 | 20; })}>
              <option value={15}>15A</option>
              <option value={20}>20A</option>
            </select>
          </div>
          <div className="row">
            <span className="muted">{count(c.id)} {count(c.id) === 1 ? "outlet" : "outlets"}</span>
            <div className="spacer" />
            <button className="btn small" aria-pressed={paint === c.id} onClick={() => setPaint(paint === c.id ? null : c.id)}>
              Tag outlets
            </button>
            <button className="btn small danger" onClick={() => update((d) => {
              d.circuits = d.circuits.filter((x) => x.id !== c.id);
              d.outlets.forEach((o) => { if (o.circuitId === c.id) o.circuitId = null; });
            })}>Remove</button>
          </div>
        </div>
      ))}
      {unknown > 0 && <p className="muted">{unknown} {unknown === 1 ? "outlet has" : "outlets have"} an unknown breaker</p>}
    </section>
  );
}

function BackgroundPanel({ venueId, onCalibrate }: { venueId: string; onCalibrate: () => void }) {
  const { doc, update } = useVenueDoc();
  const bg = doc.background;
  return (
    <section>
      <h3>Floor plan image</h3>
      <p className="muted">Trace over a photo or sketch of the room. Calibrate it so distances are real.</p>
      <label className="btn" style={{ justifySelf: "start" }}>
        {bg ? "Replace image" : "Upload image"}
        <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            try {
              const { file: name } = await api.uploadBackground(venueId, file);
              update((d) => { d.background = { file: name, x: 0, y: 0, feetPerPixel: bg?.feetPerPixel ?? 0.05, opacity: bg?.opacity ?? 0.5 }; });
              toast("Image added. Now calibrate its scale.");
            } catch (err) { toast((err as Error).message); }
          }} />
      </label>
      {bg && (
        <>
          <div className="row">
            <button className="btn" onClick={onCalibrate}>Calibrate scale</button>
            <button className="btn danger" onClick={() => update((d) => void (d.background = null))}>Remove</button>
          </div>
          <label className="field">
            Opacity
            <input type="range" min={0.1} max={1} step={0.05} value={bg.opacity}
              onChange={(e) => update((d) => { if (d.background) d.background.opacity = Number(e.target.value); }, { key: "bg-opacity" })} />
          </label>
          <NumberField label="Offset X" suffix="ft" value={bg.x} onChange={(v) => update((d) => { if (d.background) d.background.x = v; }, { key: "bg-x" })} />
          <NumberField label="Offset Y" suffix="ft" value={bg.y} onChange={(v) => update((d) => { if (d.background) d.background.y = v; }, { key: "bg-y" })} />
          <a className="muted" href={uploadUrl(bg.file)} target="_blank" rel="noreferrer">View original</a>
        </>
      )}
    </section>
  );
}

function CalibrateDialog(props: { measuredFt: number; onClose: () => void; onApply: (realFt: number) => void }) {
  const [real, setReal] = useState("");
  const value = parseFloat(real);
  return (
    <Dialog title="Set the scale" onClose={props.onClose}>
      <p className="muted">
        The two points you clicked are currently {props.measuredFt.toFixed(1)} ft apart. Enter the real distance between them.
      </p>
      <label className="field">
        Real distance (ft)
        <input type="number" autoFocus min={0.1} step={0.1} value={real} onChange={(e) => setReal(e.target.value)} />
      </label>
      <div className="row">
        <button className="btn primary" disabled={!(value > 0)} onClick={() => props.onApply(value)}>Apply scale</button>
        <button className="btn" onClick={props.onClose}>Cancel</button>
      </div>
    </Dialog>
  );
}
