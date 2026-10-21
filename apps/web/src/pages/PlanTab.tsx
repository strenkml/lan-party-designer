import { useMemo, useState } from "react";
import { BUILTIN_STRIP_PRESETS, applyWire, autoWire, cableConnections, wireOptions, layoutWarnings, type GroupMember, type Level, type Point, type ZoneKind } from "@lpd/shared";
import { FloorPlan, type Selection, type Tool } from "../canvas/FloorPlan";
import { useEditorKeys } from "../lib/keys";
import { ContextMenu, type MenuEntry } from "../lib/ContextMenu";
import { api } from "../lib/api";
import { invalidate, usePresets } from "../lib/queries";
import { nearestSegment } from "../lib/segments";
import { boxAround, snapBox, type Box } from "../lib/snapping";
import { Gauge, NameDialog, newId, toast } from "../lib/ui";
import { Icons } from "../panels/Icons";
import { TABLE_PRESETS, addTable, assignSeat, disconnectDevice, disconnectOutlet, disconnectStrip, groupObjects, groupOf, moveTable, pasteObject, deleteCable, removeCord, removeDevice, removeStrip, removeTable, removeZone, resetSeat, rotateObject, seatName, shortName, snapshotObject, translateObjects, ungroup, type ObjectSnapshot } from "../store/eventOps";
import { useEventDoc } from "../store/eventStore";
import { useEventCtx } from "./eventContext";
import { CordsPanel, EventInspector, GroupInspector, MultiInspector } from "./EventInspector";

const TOOLS: { tool: Tool; label: string }[] = [
  { tool: "select", label: "Select" },
  { tool: "table", label: "Table" },
  { tool: "strip", label: "Strip" },
  { tool: "device", label: "Switch" },
  { tool: "zone", label: "Zone" },
];

const ZONE_PRESETS: Record<ZoneKind, { label: string; width: number; depth: number }> = {
  walkway: { label: "Walkway", width: 4, depth: 12 },
  food: { label: "Food table", width: 8, depth: 3 },
  storage: { label: "Storage", width: 4, depth: 4 },
  stage: { label: "Stage", width: 12, depth: 8 },
  other: { label: "Zone", width: 6, depth: 6 },
};

export function PlanTab() {
  const { venue, doc, people, profiles, report, seatLabels } = useEventCtx();
  const { update, undo, redo } = useEventDoc.getState();
  const canUndo = useEventDoc((s) => s.past.length > 0);
  const canRedo = useEventDoc((s) => s.future.length > 0);

  const [tool, setTool] = useState<Tool>("select");
  const [selection, setSelectionRaw] = useState<Selection | null>(null);
  /** Objects picked with shift-click. Two or more can be grouped. */
  const [picked, setPicked] = useState<Selection[]>([]);
  const setSelection = (s: Selection | null) => { setSelectionRaw(s); setPicked([]); };
  const [snap, setSnap] = useState(true);
  const [showPower, setShowPower] = useState(true);
  const [showNet, setShowNet] = useState(true);
  const [showDimensions, setShowDimensions] = useState(false);
  const [snapObjects, setSnapObjects] = useState(true);
  const [preset, setPreset] = useState("folding-6");
  const [profileId, setProfileId] = useState("switch-16");
  const [stripPreset, setStripPreset] = useState("strip-6");
  const [zoneKind, setZoneKind] = useState<ZoneKind>("walkway");
  const customPresets = usePresets().data ?? [];
  const customTables = customPresets.filter((p) => p.kind === "table");
  const customStrips = customPresets.filter((p) => p.kind === "strip");
  const [unplaced, setUnplaced] = useState<{ seatId: string; kind: string; reason: string }[]>([]);

  const levels = useMemo(() => {
    const out: Record<string, Level> = {};
    for (const r of [...report.strips, ...report.outlets]) out[r.id] = r.level;
    return out;
  }, [report]);

  const GROUPABLE = ["table", "strip", "device", "zone"];
  const asMember = (s: Selection): GroupMember | null => (GROUPABLE.includes(s.kind) ? ({ kind: s.kind, id: s.id } as GroupMember) : null);
  const groupedWith = (s: Selection | null) => {
    const g = s && asMember(s) ? groupOf(doc, s.kind as GroupMember["kind"], s.id) : undefined;
    return g;
  };
  const selectedGroup = picked.length < 2 ? groupedWith(selection) : undefined;
  /** What moves when the selection is dragged: the picked objects, or the whole group. */
  const movingSet = (s: Selection): GroupMember[] => {
    const inPicked = picked.some((p) => p.kind === s.kind && p.id === s.id);
    if (inPicked && picked.length >= 2) return picked.map(asMember).filter((m): m is GroupMember => !!m);
    return groupedWith(s)?.members ?? [];
  };
  const highlight: Selection[] = picked.length >= 2
    ? picked
    : selection
      ? [selection, ...(selectedGroup?.members ?? []).map((m) => ({ kind: m.kind, id: m.id }) as Selection)]
      : [];
  const toggleSelect = (s: Selection) => {
    const base = picked.length ? picked : selection ? [selection] : [];
    const has = base.some((p) => p.kind === s.kind && p.id === s.id);
    const next = has ? base.filter((p) => !(p.kind === s.kind && p.id === s.id)) : [...base, s];
    setPicked(next);
    setSelectionRaw(next[next.length - 1] ?? null);
  };

  const layout = useMemo(() => layoutWarnings(venue, doc), [venue, doc]);
  const allWarnings = useMemo(() => [...report.warnings, ...layout], [report.warnings, layout]);
  const clear = () => setSelection(null);

  const removeTargets = (targets: Selection[]) => {
    if (targets.length === 0) return;
    update((d) => {
      for (const t of targets) {
        if (t.kind === "table") removeTable(d, t.id);
        if (t.kind === "strip") removeStrip(d, t.id);
        if (t.kind === "device") removeDevice(d, t.id);
        if (t.kind === "cord") removeCord(d, t.id);
        if (t.kind === "cable") deleteCable(d, t.id);
        if (t.kind === "zone") removeZone(d, t.id);
      }
    });
    clear();
  };
  const remove = () => removeTargets(picked.length >= 2 ? picked : selection ? [selection] : []);

  useEditorKeys({
    undo: () => useEventDoc.getState().undo(),
    redo: () => useEventDoc.getState().redo(),
    remove,
    escape: () => { setTool("select"); clear(); },
    enter: () => {},
  });

  /** Lines a dragged item up with the other objects and the room edges. */
  const snapToObjects = (sel: Selection, pt: Point, bypass: boolean) => {
    if (!snapObjects || bypass) return null;
    const dims = {
      table: (id: string) => { const t = doc.tables.find((x) => x.id === id); return t && { width: t.width, depth: t.shape === "round" ? t.width : t.depth, rotation: t.rotation }; },
      strip: (id: string) => { const t = doc.strips.find((x) => x.id === id); return t && { width: 2.4, depth: 0.8, rotation: t.rotation }; },
      device: (id: string) => { const t = doc.devices.find((x) => x.id === id); return t && { width: 3.2, depth: 1.1, rotation: t.rotation }; },
      zone: (id: string) => { const t = doc.zones.find((x) => x.id === id); return t && { width: t.width, depth: t.depth, rotation: t.rotation }; },
      seat: (id: string) => { const t = doc.seats.find((x) => x.id === id); return t && { width: 1.4, depth: 1.4, rotation: t.rotation }; },
    } as const;
    const getDims = (dims as Record<string, ((id: string) => { width: number; depth: number; rotation: number } | undefined) | undefined>)[sel.kind];
    const d = getDims?.(sel.id);
    if (!d) return null;
    const moving = boxAround({ ...pt, ...d });
    const together = movingSet(sel);
    const isMoving = (kind: GroupMember["kind"], id: string) => together.some((m) => m.kind === kind && m.id === id);
    const others: Box[] = [];
    const push = (x: number, y: number, width: number, depth: number, rotation: number) => others.push(boxAround({ x, y, width, depth, rotation }));
    for (const t of doc.tables) if (!(sel.kind === "table" && t.id === sel.id) && !isMoving("table", t.id)) push(t.x, t.y, t.width, t.shape === "round" ? t.width : t.depth, t.rotation);
    for (const z of doc.zones) if (!(sel.kind === "zone" && z.id === sel.id) && !isMoving("zone", z.id)) push(z.x, z.y, z.width, z.depth, z.rotation);
    for (const s of doc.strips) if (!(sel.kind === "strip" && s.id === sel.id) && !isMoving("strip", s.id)) push(s.x, s.y, 2.4, 0.8, s.rotation);
    for (const v of doc.devices) if (!(sel.kind === "device" && v.id === sel.id) && !isMoving("device", v.id)) push(v.x, v.y, 3.2, 1.1, v.rotation);
    for (const s of doc.seats) if (!(sel.kind === "seat" && s.id === sel.id) && !(s.tableId && isMoving("table", s.tableId))) push(s.x, s.y, 1.4, 1.4, s.rotation);
    for (const o of venue.obstacles) push(o.x, o.y, o.width, o.depth, o.rotation);
    if (venue.room.length >= 3) {
      others.push({
        minX: Math.min(...venue.room.map((p) => p.x)), maxX: Math.max(...venue.room.map((p) => p.x)),
        minY: Math.min(...venue.room.map((p) => p.y)), maxY: Math.max(...venue.room.map((p) => p.y)),
      });
    }
    const r = snapBox(moving, others, { thresholdFt: 0.6 });
    return { pt: { x: pt.x + r.dx, y: pt.y + r.dy }, guides: r.guides };
  };

  /** Adds one item of a kind at a point, using the presets currently chosen in the side panel. */
  const placeItem = (kind: "table" | "strip" | "device" | "zone", pt: Point) => {
    const id = newId(kind === "device" ? "dev" : kind);
    if (kind === "table") {
      const custom = customTables.find((p) => `custom:${p.id}` === preset);
      update((d) => addTable(d, custom && custom.kind === "table" ? { ...custom.spec, name: custom.name } : preset, pt, id));
    }
    if (kind === "strip") {
      const custom = customStrips.find((p) => `custom:${p.id}` === stripPreset);
      const spec = custom && custom.kind === "strip" ? custom.spec : (BUILTIN_STRIP_PRESETS.find((p) => p.id === stripPreset)?.spec ?? { sockets: 6, amps: 15 });
      update((d) => void d.strips.push({ id, label: custom?.name ?? `Strip ${d.strips.length + 1}`, x: pt.x, y: pt.y, sockets: spec.sockets, amps: spec.amps, rotation: 0, pluggedInto: null }));
    }
    if (kind === "device") {
      const p = profiles.find((x) => x.id === profileId);
      update((d) => void d.devices.push({ id, label: `${p?.kind === "router" ? "Router" : "Switch"} ${d.devices.length + 1}`, profileId, x: pt.x, y: pt.y, rotation: 0, jackId: null, pluggedInto: null }));
    }
    if (kind === "zone") {
      const size = ZONE_PRESETS[zoneKind];
      update((d) => void d.zones.push({ id, label: size.label, kind: zoneKind, x: pt.x, y: pt.y, width: size.width, depth: size.depth, rotation: 0 }));
    }
    setSelection({ kind, id });
    return id;
  };

  const place = (pt: Point) => {
    if (tool === "table" || tool === "strip" || tool === "device" || tool === "zone") {
      placeItem(tool, pt);
      setTool("select");
    }
  };

  const onDragEnd = (s: Selection, pt: Point) =>
    update((d) => {
      const members = movingSet(s);
      if (members.length >= 2) {
        const cur = s.kind === "table" ? d.tables.find((x) => x.id === s.id) : s.kind === "strip" ? d.strips.find((x) => x.id === s.id) : s.kind === "device" ? d.devices.find((x) => x.id === s.id) : s.kind === "zone" ? d.zones.find((x) => x.id === s.id) : undefined;
        if (cur) return translateObjects(d, members, pt.x - cur.x, pt.y - cur.y);
      }
      if (s.kind === "table") return moveTable(d, s.id, pt);
      if (s.kind === "seat") {
        const seat = d.seats.find((x) => x.id === s.id);
        if (seat) Object.assign(seat, pt, { manual: true });
      }
      if (s.kind === "strip") Object.assign(d.strips.find((x) => x.id === s.id) ?? {}, pt);
      if (s.kind === "zone") Object.assign(d.zones.find((x) => x.id === s.id) ?? {}, pt);
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

  // ----- right-click menu -----
  const [menu, setMenu] = useState<{ id: number; x: number; y: number; entries: MenuEntry[] } | null>(null);
  const [clipboard, setClipboard] = useState<ObjectSnapshot | null>(null);
  const [saveAs, setSaveAs] = useState<{ kind: "table" | "strip" | "device"; id: string } | null>(null);

  const snapPoint = (p: Point): Point => (snap ? { x: Math.round(p.x * 2) / 2, y: Math.round(p.y * 2) / 2 } : p);
  const posOf = (sel: Selection): Point | null => {
    const list = sel.kind === "table" ? doc.tables : sel.kind === "strip" ? doc.strips : sel.kind === "device" ? doc.devices : sel.kind === "zone" ? doc.zones : [];
    const item = (list as (Point & { id: string })[]).find((x) => x.id === sel.id);
    return item ? { x: item.x, y: item.y } : null;
  };
  const snapshotLabel = (snap: ObjectSnapshot) =>
    snap.kind === "table" ? snap.table.label : snap.kind === "strip" ? snap.strip.label : snap.kind === "device" ? snap.device.label : snap.zone.label;
  const disconnect = (run: (d: typeof doc) => number) => {
    let n = 0;
    update((d) => void (n = run(d)));
    toast(`Disconnected ${n} ${n === 1 ? "connection" : "connections"}. Press Ctrl+Z to undo.`);
  };

  /** The second level of the menu: only connections the wiring rules allow. */
  const openWireMenu = (sel: Selection, pt: Point, screen: { x: number; y: number }) => {
    const names = (e: { kind: string; id: string }) => (e.kind === "seat" ? seatName(doc, e.id) : undefined);
    const options = wireOptions(venue, doc, profiles, sel, names);
    const entries: MenuEntry[] = [
      { label: "Back", onSelect: () => setMenu({ id: Date.now(), ...screen, entries: objectEntries(sel, pt, screen) }) },
      { separator: true },
    ];
    for (const group of ["Ethernet", "Power"] as const) {
      const inGroup = options.filter((o) => o.group === group);
      if (inGroup.length === 0) continue;
      entries.push({ heading: group });
      for (const o of inGroup) {
        entries.push({
          label: o.disabledReason ? `${o.verb} (${o.disabledReason})` : o.verb,
          disabled: !!o.disabledReason,
          onSelect: () => {
            let key: string | null = null;
            update((d) => void (key = applyWire(d, venue, profiles, o.apply.source, o.apply.target)));
            if (key) {
              setSelectionRaw({ kind: "cable", id: key });
              setPicked([]);
              toast(`${o.verb}. Ctrl+Z to undo.`);
            } else {
              toast("That connection is not allowed.");
            }
          },
        });
      }
    }
    if (options.length === 0) entries.push({ heading: "Nothing this can be wired to" });
    setMenu({ id: Date.now(), ...screen, entries });
  };

  const objectEntries = (sel: Selection, pt: Point, screen: { x: number; y: number }): MenuEntry[] => {
    const entries: MenuEntry[] = [];
    const personName = (id: string) => people.find((p) => p.id === id)?.name ?? "guest";

    if (GROUPABLE.includes(sel.kind)) {
      entries.push({
        label: "Copy",
        onSelect: () => {
          const snapshot = snapshotObject(doc, sel);
          if (snapshot) {
            setClipboard(snapshot);
            toast(`Copied ${snapshotLabel(snapshot) || sel.kind}. Right-click the floor to paste.`);
          }
        },
      });
      entries.push({
        label: "Duplicate",
        onSelect: () => {
          const snapshot = snapshotObject(doc, sel);
          const at = posOf(sel);
          if (!snapshot || !at) return;
          let made: { kind: string; id: string } | undefined;
          update((d) => void (made = pasteObject(d, snapshot, { x: at.x + 2, y: at.y + 2 })));
          if (made) setSelection(made as Selection);
        },
      });
      entries.push({ label: "Rotate 90°", onSelect: () => update((d) => rotateObject(d, sel)) });

      const members = picked.map(asMember).filter((m): m is GroupMember => !!m);
      if (picked.length >= 2 && picked.some((p) => p.kind === sel.kind && p.id === sel.id)) {
        entries.push({ label: `Group these ${members.length} objects`, disabled: members.length < 2, onSelect: () => { update((d) => void groupObjects(d, members)); clear(); } });
      }
      const g = groupedWith(sel);
      if (g) entries.push({ label: `Ungroup${g.label ? ` "${g.label}"` : ""}`, onSelect: () => update((d) => ungroup(d, g.id)) });
      entries.push({ separator: true });
    }

    if (sel.kind === "strip") {
      const n = disconnectStrip(structuredClone(doc), sel.id);
      entries.push({ label: `Disconnect everything (${n})`, disabled: n === 0, onSelect: () => disconnect((d) => disconnectStrip(d, sel.id)) });
      entries.push({ label: "Save as a custom strip…", onSelect: () => setSaveAs({ kind: "strip", id: sel.id }) });
    }
    if (sel.kind === "device") {
      const n = disconnectDevice(structuredClone(doc), sel.id);
      entries.push({ label: `Disconnect everything (${n})`, disabled: n === 0, onSelect: () => disconnect((d) => disconnectDevice(d, sel.id)) });
      entries.push({ label: "Save as a custom switch…", onSelect: () => setSaveAs({ kind: "device", id: sel.id }) });
    }
    if (sel.kind === "table") entries.push({ label: "Save as a custom table…", onSelect: () => setSaveAs({ kind: "table", id: sel.id }) });

    if (sel.kind === "outlet") {
      const n = disconnectOutlet(structuredClone(doc), sel.id);
      entries.push({ label: `Disconnect everything (${n})`, disabled: n === 0, onSelect: () => disconnect((d) => disconnectOutlet(d, sel.id)) });
      entries.push({
        label: "Add an extension cord from here",
        onSelect: () => update((d) => void d.cords.push({ id: newId("cord"), label: `Cord ${d.cords.length + 1}`, gauge: 14, amps: 15, outletId: sel.id, overrideFt: null })),
      });
    }

    if (sel.kind === "seat") {
      const occupant = doc.attendance.find((a) => a.seatId === sel.id);
      const seat = doc.seats.find((x) => x.id === sel.id);
      entries.push({ heading: seatName(doc, sel.id) });
      if (occupant) entries.push({ label: `Unseat ${personName(occupant.personId)}`, onSelect: () => update((d) => assignSeat(d, occupant.personId, null)) });
      const waiting = doc.attendance.filter((a) => !a.seatId && a.rsvp !== "declined");
      if (waiting.length > 0) entries.push({ heading: occupant ? "Swap in a guest" : "Seat a guest here" });
      for (const a of waiting.slice(0, 8)) entries.push({ label: personName(a.personId), onSelect: () => update((d) => assignSeat(d, a.personId, sel.id)) });
      if (waiting.length > 8) entries.push({ heading: `${waiting.length - 8} more on the Roster tab` });
      if (seat?.manual) entries.push({ label: "Snap back to table", onSelect: () => update((d) => resetSeat(d, sel.id)) });
    }

    if (sel.kind === "cable") {
      const cn = cableConnections(venue, doc).find((c) => c.key === sel.id);
      if (cn) {
        entries.push({
          label: "Add a bend here",
          onSelect: () => {
            const at = nearestSegment([cn.from, ...cn.waypoints, cn.to], pt);
            update((d) => void (d.routes[cn.key] = [...cn.waypoints.slice(0, at), pt, ...cn.waypoints.slice(at)]));
          },
        });
        entries.push({ label: "Clear route", disabled: cn.waypoints.length === 0, onSelect: () => update((d) => void delete d.routes[cn.key]) });
      }
    }

    if (["door", "window", "garage", "jack", "obstacle"].includes(sel.kind)) {
      entries.push({ heading: "Part of the venue. Edit it in the venue editor." });
    }

    if (["seat", "device", "strip", "outlet", "jack"].includes(sel.kind)) {
      if (entries.length && !("separator" in entries[entries.length - 1]!) && !("heading" in entries[entries.length - 1]!)) entries.push({ separator: true });
      entries.push({ label: "Wire to…", onSelect: () => openWireMenu(sel, pt, screen) });
    }

    const deletable = picked.length >= 2 && picked.some((p) => p.kind === sel.kind && p.id === sel.id) ? picked : [sel];
    if (["table", "strip", "device", "zone", "cord", "cable"].includes(sel.kind)) {
      if (entries.length && !("separator" in entries[entries.length - 1]!)) entries.push({ separator: true });
      entries.push({ label: sel.kind === "cable" ? "Delete cable" : deletable.length > 1 ? `Delete ${deletable.length} objects` : "Delete", danger: true, onSelect: () => removeTargets(deletable) });
    }
    return entries.filter((e, i, all) => !("separator" in e) || (i > 0 && i < all.length - 1));
  };

  const floorEntries = (pt: Point): MenuEntry[] => {
    const tableName = customTables.find((p) => `custom:${p.id}` === preset)?.name ?? TABLE_PRESETS.find((p) => p.id === preset)?.label ?? "table";
    const stripName = customStrips.find((p) => `custom:${p.id}` === stripPreset)?.name ?? BUILTIN_STRIP_PRESETS.find((p) => p.id === stripPreset)?.name ?? "strip";
    const switchName = profiles.find((p) => p.id === profileId)?.name ?? "switch";
    return [
      { heading: "Add here" },
      { label: `Table: ${tableName}`, onSelect: () => void placeItem("table", pt) },
      { label: `Power strip: ${stripName}`, onSelect: () => void placeItem("strip", pt) },
      { label: `Switch: ${switchName}`, onSelect: () => void placeItem("device", pt) },
      { label: `Zone: ${ZONE_PRESETS[zoneKind].label}`, onSelect: () => void placeItem("zone", pt) },
      { separator: true },
      {
        label: clipboard ? `Paste ${snapshotLabel(clipboard) || "copy"}` : "Paste",
        disabled: !clipboard,
        onSelect: () => {
          if (!clipboard) return;
          let made: { kind: string; id: string } | undefined;
          update((d) => void (made = pasteObject(d, clipboard, pt)));
          if (made) setSelection(made as Selection);
        },
      },
    ];
  };

  const openContextMenu = ({ target, at, screen }: { target: Selection | null; at: Point; screen: { x: number; y: number } }) => {
    const pt = snapPoint(at);
    if (target && !highlight.some((h) => h.kind === target.kind && h.id === target.id)) setSelection(target);
    setMenu({ id: Date.now(), x: screen.x, y: screen.y, entries: target ? objectEntries(target, pt, screen) : floorEntries(pt) });
  };

  const saveAsSubmit = async (name: string) => {
    if (!saveAs) return;
    try {
      if (saveAs.kind === "table") {
        const t = doc.tables.find((x) => x.id === saveAs.id);
        if (t) await api.createPreset({ kind: "table", name, spec: { shape: t.shape, width: t.width, depth: t.depth, seats: t.seats, seatWidthIn: t.seatWidthIn, seatSides: t.seatSides } });
        await invalidate("presets");
        toast(`Saved "${name}". Find it under Your tables when placing.`);
      } else if (saveAs.kind === "strip") {
        const st = doc.strips.find((x) => x.id === saveAs.id);
        if (st) await api.createPreset({ kind: "strip", name, spec: { sockets: st.sockets, amps: st.amps } });
        await invalidate("presets");
        toast(`Saved "${name}". Find it under Your strips when placing.`);
      } else {
        const dev = doc.devices.find((x) => x.id === saveAs.id);
        const base = profiles.find((p) => p.id === dev?.profileId);
        if (dev) {
          const created = await api.createProfile({ name, kind: base?.kind === "router" ? "router" : "switch", typicalW: dev.typicalW ?? base?.typicalW ?? 0, peakW: dev.peakW ?? base?.peakW ?? 0, ports: dev.ports ?? base?.ports ?? 0 });
          await invalidate("profiles");
          update((d) => { const t = d.devices.find((x) => x.id === dev.id); if (t) { t.profileId = created.id; t.typicalW = undefined; t.peakW = undefined; t.ports = undefined; } });
          toast(`Saved "${name}". It is in the switch list and under Device profiles.`);
        }
      }
    } catch (e) {
      toast((e as Error).message);
    }
  };

  const runAutoWire = () => {
    const result = autoWire({ venue, event: doc, people, profiles });
    update((d) => void (d.seats = result.event.seats));
    setUnplaced(result.unplaced);
    toast(result.unplaced.length ? `Auto-wired. ${result.unplaced.length} seats could not be placed.` : "Auto-wired every seat.");
  };

  const guests = doc.attendance.filter((a) => a.rsvp !== "declined");
  const warnTarget = (refId: string): Selection | null => {
    if (doc.tables.some((s) => s.id === refId)) return { kind: "table", id: refId };
    if (doc.devices.some((s) => s.id === refId)) return { kind: "device", id: refId };
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
            {Icons[t.tool === "device" ? "device" : (t.tool as "select" | "table" | "strip" | "zone")]}
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
            showDimensions={showDimensions}
            roomDraft={[]}
            calibration={[]}
            levels={levels}
            seatLabels={seatLabels}
            seatTint={{}}
            onSelect={setSelection}
            highlight={highlight}
            onToggleSelect={toggleSelect}
            onContextMenu={openContextMenu}
            snapToObjects={snapToObjects}
            onRouteChange={(key, points) => update((d) => { if (points.length === 0) delete d.routes[key]; else d.routes[key] = points; })}
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
          <label className="check field"><input type="checkbox" checked={snapObjects} onChange={(e) => setSnapObjects(e.target.checked)} />Snap to other objects and walls (hold Alt to skip)</label>
          <label className="check field"><input type="checkbox" checked={showPower} onChange={(e) => setShowPower(e.target.checked)} /><span style={{ color: "var(--power)" }}>Show power wiring</span></label>
          <label className="check field"><input type="checkbox" checked={showNet} onChange={(e) => setShowNet(e.target.checked)} /><span style={{ color: "var(--net)" }}>Show network cables</span></label>
          <label className="check field"><input type="checkbox" checked={showDimensions} onChange={(e) => setShowDimensions(e.target.checked)} />Show wall and opening dimensions</label>
          {tool === "table" && (
            <label className="field">Table to place
              <select value={preset} onChange={(e) => setPreset(e.target.value)}>
                {TABLE_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                {customTables.length > 0 && (
                  <optgroup label="Your tables">
                    {customTables.map((p) => <option key={p.id} value={`custom:${p.id}`}>{p.name}</option>)}
                  </optgroup>
                )}
              </select>
            </label>
          )}
          {tool === "zone" && (
            <label className="field">Kind of zone
              <select value={zoneKind} onChange={(e) => setZoneKind(e.target.value as ZoneKind)}>
                {Object.entries(ZONE_PRESETS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </label>
          )}
          {tool === "strip" && (
            <label className="field">Power strip to place
              <select value={stripPreset} onChange={(e) => setStripPreset(e.target.value)}>
                {BUILTIN_STRIP_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                {customStrips.length > 0 && (
                  <optgroup label="Your strips">
                    {customStrips.map((p) => <option key={p.id} value={`custom:${p.id}`}>{p.name}</option>)}
                  </optgroup>
                )}
              </select>
            </label>
          )}
          {tool === "device" && (
            <label className="field">Switch or router to place
              <select value={profileId} onChange={(e) => setProfileId(e.target.value)}>
                {profiles.filter((p) => p.ports > 0).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
          )}
          <button className="btn primary" onClick={runAutoWire} disabled={doc.seats.length === 0}>Auto-wire seats</button>
          <p className="muted" style={{ margin: 0 }}>Wires every unwired seat, including empty ones. Wiring you set by hand is never changed.</p>
          {unplaced.length > 0 && (
            <ul className="warnlist" aria-label="Seats auto-wire could not place">
              {unplaced.map((u, i) => (
                <li key={i}><button onClick={() => setSelection({ kind: "seat", id: u.seatId })}><span className="dot warn" /><span>{seatName(doc, u.seatId)}: {u.reason}</span></button></li>
              ))}
            </ul>
          )}
        </section>

        {picked.length >= 2 ? (
          <MultiInspector picked={picked} clear={clear} />
        ) : (
          <>
            {selectedGroup && <GroupInspector groupId={selectedGroup.id} />}
            <EventInspector selection={selection} clear={clear} />
          </>
        )}

        <section>
          <h3>Warnings <span className="badge info">{allWarnings.length}</span></h3>
          {allWarnings.length === 0 ? (
            <p className="muted">Nothing to fix.</p>
          ) : (
            <ul className="warnlist" style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {allWarnings.map((w, i) => (
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

      {menu && <ContextMenu key={menu.id} x={menu.x} y={menu.y} entries={menu.entries} onClose={() => setMenu(null)} />}
      {saveAs && (
        <NameDialog
          title={saveAs.kind === "table" ? "Save as a custom table" : saveAs.kind === "strip" ? "Save as a custom power strip" : "Save as a custom switch"}
          initial={(saveAs.kind === "table" ? doc.tables : saveAs.kind === "strip" ? doc.strips : doc.devices).find((x) => x.id === saveAs.id)?.label ?? ""}
          action="Save"
          onClose={() => setSaveAs(null)}
          onSubmit={saveAsSubmit}
        />
      )}
    </div>
  );
}

