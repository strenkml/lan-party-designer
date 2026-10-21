import type Konva from "konva";
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent } from "react";
import { Circle, Group, Image as KImage, Layer, Line, Rect, Shape, Stage, Text } from "react-konva";
import { type EventDoc, type Level, type Point, type VenueDoc } from "@lpd/shared";
import { uploadUrl } from "../lib/api";
import { useCssColors } from "../theme/theme";
import { wallDimensions } from "../lib/dimensions";
import { guideRoomPoint, type GuidedPoint } from "../lib/guides";
import { useImage } from "./useImage";

/** Pixels per foot at zoom 1. */
export const PPF = 24;
export const CIRCUIT_COLORS = ["#e4572e", "#17bebb", "#e0a800", "#76b041", "#9b5de5", "#f15bb5", "#00a6fb", "#8d6a4b"];

export type SelKind = "outlet" | "door" | "obstacle" | "table" | "seat" | "strip" | "device" | "cord";
export interface Selection {
  kind: SelKind;
  id: string;
}

export type Tool =
  | "select"
  | "room"
  | "door"
  | "obstacle"
  | "outlet"
  | "table"
  | "strip"
  | "device"
  | "calibrate";

export interface FloorPlanProps {
  venue: VenueDoc;
  event?: EventDoc;
  tool: Tool;
  selection: Selection | null;
  snap: boolean;
  showPower: boolean;
  showNet: boolean;
  /** Measurements along each wall, split at doors. */
  showDimensions?: boolean;
  /** Pending room outline points while the room tool is active. */
  roomDraft: Point[];
  calibration: Point[];
  levels: Record<string, Level>;
  seatLabels: Record<string, string>;
  seatTint: Record<string, "done" | "partial" | "none">;
  onSelect: (s: Selection | null) => void;
  onCanvasClick: (pt: Point) => void;
  onDragEnd: (s: Selection, pt: Point) => void;
  onRoomVertexMove: (index: number, pt: Point) => void;
  onRoomVertexRemove: (index: number) => void;
  onRoomFinish: () => void;
  onDropPerson: (personId: string, pt: Point) => void;
}

const snapTo = (n: number, on: boolean) => (on ? Math.round(n * 2) / 2 : n);
const COLOR_NAMES = [
  "floor", "floor-line", "grid", "table", "table-line", "seat", "ink", "ink-2", "power", "net",
  "ok", "warn", "danger", "primary", "focus", "panel", "line-strong",
] as const;

export function FloorPlan(props: FloorPlanProps) {
  const { venue, event } = props;
  const c = useCssColors(COLOR_NAMES);
  const wrapRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [view, setView] = useState({ x: 40, y: 40, scale: 1 });
  const [cursor, setCursor] = useState<GuidedPoint | null>(null);
  const fitted = useRef(false);

  const bgImage = useImage(venue.background ? uploadUrl(venue.background.file) : null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const dims = useMemo(
    () => (props.showDimensions ? wallDimensions(venue.room, venue.doors) : []),
    [props.showDimensions, venue.room, venue.doors],
  );

  const circuitColor = useMemo(() => {
    const map = new Map<string, string>();
    venue.circuits.forEach((ci, i) => map.set(ci.id, CIRCUIT_COLORS[i % CIRCUIT_COLORS.length]!));
    return map;
  }, [venue.circuits]);

  const fit = useCallback(() => {
    const pts: Point[] = [
      ...venue.room,
      ...venue.outlets,
      ...(event?.tables ?? []),
      ...(event?.seats ?? []),
    ];
    if (venue.background && bgImage) {
      const s = venue.background.feetPerPixel;
      pts.push({ x: venue.background.x, y: venue.background.y });
      pts.push({ x: venue.background.x + bgImage.width * s, y: venue.background.y + bgImage.height * s });
    }
    if (pts.length === 0) pts.push({ x: 0, y: 0 }, { x: 30, y: 20 });
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const minX = Math.min(...xs) - 3, maxX = Math.max(...xs) + 3;
    const minY = Math.min(...ys) - 3, maxY = Math.max(...ys) + 3;
    const scale = Math.min(size.w / ((maxX - minX) * PPF), size.h / ((maxY - minY) * PPF), 3);
    setView({ scale, x: -minX * PPF * scale + (size.w - (maxX - minX) * PPF * scale) / 2, y: -minY * PPF * scale + (size.h - (maxY - minY) * PPF * scale) / 2 });
  }, [venue.room, venue.outlets, venue.background, bgImage, event?.tables, event?.seats, size.w, size.h]);

  useEffect(() => {
    if (!fitted.current && size.w > 0 && size.h > 0) {
      fitted.current = true;
      fit();
    }
  }, [fit, size]);

  const pointer = (): Point | null => {
    const p = stageRef.current?.getRelativePointerPosition();
    return p ? { x: p.x / PPF, y: p.y / PPF } : null;
  };

  /** Pointer position, run through the room guides while drawing a room. */
  const guidedPointer = (shift: boolean): GuidedPoint | null => {
    const p = pointer();
    if (!p) return null;
    if (props.tool === "room") return guideRoomPoint(props.roomDraft, p, { snapGrid: props.snap, disabled: shift });
    return { point: { x: snapTo(p.x, props.snap), y: snapTo(p.y, props.snap) }, guides: [] };
  };

  const onWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const stage = stageRef.current!;
    const old = view.scale;
    const ptr = stage.getPointerPosition()!;
    const next = Math.min(Math.max(old * (e.evt.deltaY > 0 ? 0.9 : 1.1), 0.15), 6);
    const mouse = { x: (ptr.x - view.x) / old, y: (ptr.y - view.y) / old };
    setView({ scale: next, x: ptr.x - mouse.x * next, y: ptr.y - mouse.y * next });
  };

  const zoomBy = (f: number) => {
    const cx = size.w / 2, cy = size.h / 2;
    const next = Math.min(Math.max(view.scale * f, 0.15), 6);
    const mouse = { x: (cx - view.x) / view.scale, y: (cy - view.y) / view.scale };
    setView({ scale: next, x: cx - mouse.x * next, y: cy - mouse.y * next });
  };

  const selected = (kind: SelKind, id: string) => props.selection?.kind === kind && props.selection.id === id;
  const interactive = props.tool === "select";
  const lvlColor = (l?: Level) => (l === "danger" ? c.danger : l === "warn" ? c.warn : null);

  const dragProps = (sel: Selection) => ({
    draggable: interactive,
    onClick: (e: Konva.KonvaEventObject<MouseEvent>) => {
      if (!interactive) return;
      e.cancelBubble = true;
      props.onSelect(sel);
    },
    onDragStart: () => props.onSelect(sel),
    onDragEnd: (e: Konva.KonvaEventObject<globalThis.DragEvent>) => {
      const node = e.target;
      const pt = { x: snapTo(node.x() / PPF, props.snap), y: snapTo(node.y() / PPF, props.snap) };
      node.position({ x: pt.x * PPF, y: pt.y * PPF });
      props.onDragEnd(sel, pt);
    },
  });

  const onStageClick = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (e.target !== e.target.getStage() && !e.target.attrs.bg) return;
    if (props.tool === "select") {
      props.onSelect(null);
      return;
    }
    const g = guidedPointer(e.evt.shiftKey);
    if (g) props.onCanvasClick(g.point);
  };

  const allowDrop = (e: ReactDragEvent) => e.preventDefault();
  const onDrop = (e: ReactDragEvent) => {
    e.preventDefault();
    const personId = e.dataTransfer.getData("text/x-person");
    if (!personId || !stageRef.current) return;
    stageRef.current.setPointersPositions(e.nativeEvent);
    const p = pointer();
    if (p) props.onDropPerson(personId, p);
  };

  const seatById = useMemo(() => new Map((event?.seats ?? []).map((s) => [s.id, s])), [event?.seats]);
  const stripById = useMemo(() => new Map((event?.strips ?? []).map((s) => [s.id, s])), [event?.strips]);
  const deviceById = useMemo(() => new Map((event?.devices ?? []).map((d) => [d.id, d])), [event?.devices]);
  const outletById = useMemo(() => new Map(venue.outlets.map((o) => [o.id, o])), [venue.outlets]);
  const cordById = useMemo(() => new Map((event?.cords ?? []).map((cd) => [cd.id, cd])), [event?.cords]);

  const targetPoint = (t: { kind: string; id: string }): Point | undefined => {
    if (t.kind === "outlet") return outletById.get(t.id);
    if (t.kind === "strip") return stripById.get(t.id);
    if (t.kind === "cord") {
      const cord = cordById.get(t.id);
      return cord?.outletId ? outletById.get(cord.outletId) : undefined;
    }
    return undefined;
  };

  const line = (pts: Point[], color: string, opts: { dash?: number[]; width?: number; key: string }) => (
    <Line
      key={opts.key}
      points={pts.flatMap((p) => [p.x * PPF, p.y * PPF])}
      stroke={color}
      strokeWidth={opts.width ?? 1.5}
      dash={opts.dash}
      listening={false}
      strokeScaleEnabled={false}
      opacity={0.85}
    />
  );

  const tool = props.tool;
  const hint =
    tool === "room" ? "Click to add corners. Guides square them up (hold Shift to draw freely). Click the first corner or press Enter to close."
    : tool === "calibrate" ? `Click two points that are a known distance apart (${props.calibration.length}/2).`
    : tool === "door" || tool === "outlet" ? `Click near a wall to place ${tool === "door" ? "a door" : "an outlet"}. It snaps onto the wall. Press Esc to stop.`
    : tool !== "select" ? "Click on the plan to place. Press Esc to stop." : null;

  return (
    <div ref={wrapRef} className="canvas-area" onDragOver={allowDrop} onDrop={onDrop}>
      <div className="canvas-hud no-print">
        <span className="pill">{Math.round(view.scale * 100)}%</span>
        <button className="btn small" onClick={() => zoomBy(1.25)} aria-label="Zoom in">+</button>
        <button className="btn small" onClick={() => zoomBy(0.8)} aria-label="Zoom out">−</button>
        <button className="btn small" onClick={fit}>Fit</button>
      </div>
      {hint && <div className="canvas-hint">{hint}</div>}
      <Stage
        ref={stageRef}
        width={size.w}
        height={size.h}
        x={view.x}
        y={view.y}
        scaleX={view.scale}
        scaleY={view.scale}
        draggable={interactive}
        onDragEnd={(e) => e.target === e.target.getStage() && setView((v) => ({ ...v, x: e.target.x(), y: e.target.y() }))}
        onWheel={onWheel}
        onClick={onStageClick}
        onMouseMove={(e) => (tool === "room" ? setCursor(guidedPointer(e.evt.shiftKey)) : undefined)}
        style={{ cursor: tool === "select" ? "default" : "crosshair" }}
      >
        <Layer>
          {/* grid */}
          <Shape
            listening={false}
            sceneFunc={(ctx, shape) => {
              const x0 = Math.floor(-view.x / view.scale / PPF) - 1;
              const y0 = Math.floor(-view.y / view.scale / PPF) - 1;
              const x1 = x0 + Math.ceil(size.w / view.scale / PPF) + 2;
              const y1 = y0 + Math.ceil(size.h / view.scale / PPF) + 2;
              ctx.beginPath();
              const step = view.scale < 0.4 ? 5 : 1;
              for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) { ctx.moveTo(x * PPF, y0 * PPF); ctx.lineTo(x * PPF, y1 * PPF); }
              for (let y = Math.ceil(y0 / step) * step; y <= y1; y += step) { ctx.moveTo(x0 * PPF, y * PPF); ctx.lineTo(x1 * PPF, y * PPF); }
              ctx.fillStrokeShape(shape);
            }}
            stroke={c.grid}
            strokeWidth={1}
            strokeScaleEnabled={false}
          />
          {/* hit target for empty space clicks */}
          <Rect x={-5000} y={-5000} width={10000} height={10000} attrs={{ bg: true }} fill="transparent" />

          {venue.background && bgImage && (
            <KImage
              image={bgImage}
              x={venue.background.x * PPF}
              y={venue.background.y * PPF}
              scaleX={(venue.background.feetPerPixel * PPF)}
              scaleY={(venue.background.feetPerPixel * PPF)}
              opacity={venue.background.opacity}
              listening={false}
            />
          )}

          {venue.room.length > 1 && (
            <Line
              points={venue.room.flatMap((p) => [p.x * PPF, p.y * PPF])}
              closed
              fill={c.floor}
              opacity={venue.background ? 0.35 : 1}
              stroke={c["floor-line"]}
              strokeWidth={3}
              strokeScaleEnabled={false}
              listening={false}
            />
          )}

          {venue.obstacles.map((o) => (
            <Group key={o.id} x={o.x * PPF} y={o.y * PPF} rotation={o.rotation} {...dragProps({ kind: "obstacle", id: o.id })}>
              <Rect
                x={(-o.width / 2) * PPF} y={(-o.depth / 2) * PPF} width={o.width * PPF} height={o.depth * PPF}
                fill={c["line-strong"]} opacity={0.55}
                stroke={selected("obstacle", o.id) ? c.focus : c["floor-line"]} strokeWidth={selected("obstacle", o.id) ? 3 : 1}
              />
              <Text text={o.label} x={(-o.width / 2) * PPF} y={-6} width={o.width * PPF} align="center" fontSize={11} fill={c.ink} listening={false} />
            </Group>
          ))}

          {venue.doors.map((d) => {
            const w = d.width * PPF;
            const sel = selected("door", d.id);
            const stroke = sel ? c.focus : c.ink;
            const arc = Array.from({ length: 10 }, (_, i) => {
              const t = (i / 9) * (Math.PI / 2);
              return [-w / 2 + w * Math.cos(t), w * Math.sin(t)];
            }).flat();
            return (
              <Group key={d.id} x={d.x * PPF} y={d.y * PPF} rotation={d.rotation} {...dragProps({ kind: "door", id: d.id })}>
                {/* leaf, swing and hit area mirror with the flip options */}
                <Group scaleX={d.flipHinge ? -1 : 1} scaleY={d.flipSwing ? -1 : 1}>
                  <Rect x={-w / 2 - 4} y={-8} width={w + 8} height={w + 8} fill="transparent" />
                  <Line points={[-w / 2, 0, -w / 2, w]} stroke={stroke} strokeWidth={2} listening={false} />
                  <Line points={arc} stroke={sel ? c.focus : c["ink-2"]} strokeWidth={1} dash={[3, 3]} listening={false} />
                </Group>
                {/* gap cut into the wall */}
                <Rect x={-w / 2} y={-4} width={w} height={8} fill={c.floor} listening={false} />
                <Line points={[-w / 2, -5, -w / 2, 5]} stroke={stroke} strokeWidth={3} listening={false} />
                <Line points={[w / 2, -5, w / 2, 5]} stroke={stroke} strokeWidth={3} listening={false} />
              </Group>
            );
          })}

          {/* wall dimensions */}
          {dims.map((w) => {
            const fs = 11 / view.scale;
            const off = 1.1;
            const pt = (ft: number, extra = off) => ({
              x: (w.a.x + ((w.b.x - w.a.x) / w.lengthFt) * ft + w.outward.x * extra) * PPF,
              y: (w.a.y + ((w.b.y - w.a.y) / w.lengthFt) * ft + w.outward.y * extra) * PPF,
            });
            return (
              <Group key={`dim${w.index}`} listening={false}>
                {w.spans.map((sp, i) => {
                  const p0 = pt(sp.startFt);
                  const p1 = pt(sp.endFt);
                  const label = `${sp.lengthFt} ft`;
                  const mid = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
                  const lw = (label.length * 6.2 + 8) / view.scale;
                  const color = sp.kind === "door" ? c.focus : c["ink-2"];
                  const t0 = pt(sp.startFt, off - 0.35);
                  const t1 = pt(sp.startFt, off + 0.35);
                  const t2 = pt(sp.endFt, off - 0.35);
                  const t3 = pt(sp.endFt, off + 0.35);
                  return (
                    <Group key={i}>
                      <Line points={[p0.x, p0.y, p1.x, p1.y]} stroke={color} strokeWidth={1} strokeScaleEnabled={false} />
                      <Line points={[t0.x, t0.y, t1.x, t1.y]} stroke={color} strokeWidth={1} strokeScaleEnabled={false} />
                      <Line points={[t2.x, t2.y, t3.x, t3.y]} stroke={color} strokeWidth={1} strokeScaleEnabled={false} />
                      <Rect x={mid.x - lw / 2} y={mid.y - fs * 0.75} width={lw} height={fs * 1.5} fill={c.panel} opacity={0.9} cornerRadius={3 / view.scale} />
                      <Text text={label} x={mid.x - lw / 2} y={mid.y - fs * 0.5} width={lw} align="center" fontSize={fs} fill={color} fontStyle={sp.kind === "door" ? "bold" : "normal"} />
                    </Group>
                  );
                })}
              </Group>
            );
          })}

          {/* cables, drawn under items */}
          {event && props.showNet && (
            <>
              {event.seats.map((s) => {
                const d = s.netDeviceId ? deviceById.get(s.netDeviceId) : undefined;
                return d ? line([s, d], c.net, { key: `n-${s.id}`, width: 1.5 }) : null;
              })}
              {event.uplinks.map((u) => {
                const a = deviceById.get(u.fromDeviceId), b = deviceById.get(u.toDeviceId);
                return a && b ? line([a, b], c.net, { key: `u-${u.id}`, width: 3 }) : null;
              })}
            </>
          )}
          {event && props.showPower && (
            <>
              {event.seats.map((s) => {
                const st = s.stripId ? stripById.get(s.stripId) : undefined;
                return st ? line([s, st], c.power, { key: `p-${s.id}`, dash: [5, 4], width: 1.2 }) : null;
              })}
              {event.strips.map((st) => {
                const t = st.pluggedInto ? targetPoint(st.pluggedInto) : undefined;
                return t ? line([st, t], c.power, { key: `sp-${st.id}`, width: 2.5 }) : null;
              })}
              {event.devices.map((d) => {
                const t = d.pluggedInto ? targetPoint(d.pluggedInto) : undefined;
                return t ? line([d, t], c.power, { key: `dp-${d.id}`, width: 2 }) : null;
              })}
              {event.cords.map((cd) => {
                const o = cd.outletId ? outletById.get(cd.outletId) : undefined;
                const feed = [...event.strips, ...event.devices].find((x) => x.pluggedInto?.kind === "cord" && x.pluggedInto.id === cd.id);
                return o && feed ? line([o, feed], c.power, { key: `c-${cd.id}`, width: 4 }) : null;
              })}
            </>
          )}

          {/* tables and seats */}
          {event?.tables.map((t) => (
            <Group key={t.id} x={t.x * PPF} y={t.y * PPF} rotation={t.rotation} {...dragProps({ kind: "table", id: t.id })}>
              {t.shape === "round" ? (
                <Circle radius={(t.width / 2) * PPF} fill={c.table} stroke={selected("table", t.id) ? c.focus : c["table-line"]} strokeWidth={selected("table", t.id) ? 3 : 1.5} />
              ) : (
                <Rect x={(-t.width / 2) * PPF} y={(-t.depth / 2) * PPF} width={t.width * PPF} height={t.depth * PPF} cornerRadius={3}
                  fill={c.table} stroke={selected("table", t.id) ? c.focus : c["table-line"]} strokeWidth={selected("table", t.id) ? 3 : 1.5} />
              )}
              <Text text={t.label} x={(-t.width / 2) * PPF} y={-6} width={t.width * PPF} align="center" fontSize={11} fill={c["ink-2"]} listening={false} />
            </Group>
          ))}

          {event?.seats.map((s) => {
            const label = props.seatLabels[s.id];
            const tint = props.seatTint[s.id];
            const fill = tint === "done" ? c.ok : tint === "partial" ? c.warn : label ? c.primary : c.seat;
            const textColor = tint || label ? (label && !tint ? c["panel"] : c.panel) : c["ink-2"];
            return (
              <Group key={s.id} x={s.x * PPF} y={s.y * PPF} rotation={s.rotation} {...dragProps({ kind: "seat", id: s.id })}>
                <Rect x={-0.7 * PPF} y={-0.7 * PPF} width={1.4 * PPF} height={1.4 * PPF} cornerRadius={7} fill={fill}
                  opacity={label || tint ? 1 : 0.9}
                  stroke={selected("seat", s.id) ? c.focus : c["table-line"]} strokeWidth={selected("seat", s.id) ? 3 : 1} />
                <Line points={[-0.45 * PPF, -0.55 * PPF, 0.45 * PPF, -0.55 * PPF]} stroke={c["table-line"]} strokeWidth={3} lineCap="round" listening={false} />
                {label && (
                  <Text text={label} x={-0.7 * PPF} y={-6} width={1.4 * PPF} align="center" fontSize={10} fill={textColor} rotation={-s.rotation} offsetX={0} listening={false} wrap="none" ellipsis />
                )}
              </Group>
            );
          })}

          {event?.strips.map((st) => (
            <Group key={st.id} x={st.x * PPF} y={st.y * PPF} {...dragProps({ kind: "strip", id: st.id })}>
              <Rect x={-1.2 * PPF} y={-0.4 * PPF} width={2.4 * PPF} height={0.8 * PPF} cornerRadius={4} fill={c.panel}
                stroke={selected("strip", st.id) ? c.focus : lvlColor(props.levels[st.id]) ?? c.power} strokeWidth={selected("strip", st.id) ? 3 : 2} />
              {Array.from({ length: Math.min(st.sockets, 8) }, (_, i) => (
                <Circle key={i} x={(-1 + (i + 0.5) * (2 / Math.min(st.sockets, 8))) * PPF} y={0} radius={3} fill={c.power} listening={false} />
              ))}
              {lvlColor(props.levels[st.id]) && <Circle x={1.2 * PPF} y={-0.4 * PPF} radius={5} fill={lvlColor(props.levels[st.id])!} listening={false} />}
            </Group>
          ))}

          {event?.devices.map((d) => (
            <Group key={d.id} x={d.x * PPF} y={d.y * PPF} {...dragProps({ kind: "device", id: d.id })}>
              <Rect x={-1.6 * PPF} y={-0.55 * PPF} width={3.2 * PPF} height={1.1 * PPF} cornerRadius={4} fill={c.panel}
                stroke={selected("device", d.id) ? c.focus : c.net} strokeWidth={selected("device", d.id) ? 3 : 2} />
              <Text text={d.label || "Device"} x={-1.6 * PPF} y={-5} width={3.2 * PPF} align="center" fontSize={10} fill={c.ink} listening={false} wrap="none" ellipsis />
            </Group>
          ))}

          {/* outlets on top so they are always clickable */}
          {venue.outlets.map((o) => {
            const col = o.circuitId ? circuitColor.get(o.circuitId) : undefined;
            const lvl = lvlColor(props.levels[o.id]);
            return (
              <Group key={o.id} x={o.x * PPF} y={o.y * PPF} {...dragProps({ kind: "outlet", id: o.id })}>
                <Circle radius={0.5 * PPF} fill={col ?? c.panel} stroke={selected("outlet", o.id) ? c.focus : lvl ?? (col ? c.ink : c["ink-2"])} strokeWidth={selected("outlet", o.id) ? 3 : lvl ? 3 : 1.5} dash={col ? undefined : [3, 2]} />
                <Line points={[-3, -2, -3, 2]} stroke={col ? "#111" : c["ink-2"]} strokeWidth={1.5} listening={false} />
                <Line points={[3, -2, 3, 2]} stroke={col ? "#111" : c["ink-2"]} strokeWidth={1.5} listening={false} />
                {o.sockets !== 2 && (
                  <Text text={`×${o.sockets}`} x={0.5 * PPF + 2} y={-5} fontSize={11} fontStyle="bold" fill={c.ink} listening={false} />
                )}
              </Group>
            );
          })}

          {/* room being drawn */}
          {tool === "room" && props.roomDraft.length > 0 && (() => {
            const draft = props.roomDraft;
            const live = cursor ? [...draft, cursor.point] : draft;
            const fs = 12 / view.scale;
            const segments = live.slice(1).map((b, i) => ({ a: live[i]!, b }));
            return (
              <>
                {cursor?.guides.map((g, i) => (
                  <Line key={`g${i}`} points={[g.from.x * PPF, g.from.y * PPF, g.to.x * PPF, g.to.y * PPF]}
                    stroke={g.kind === "ortho" ? c.focus : c.net} strokeWidth={1.5} dash={[4, 4]} strokeScaleEnabled={false} listening={false} />
                ))}
                <Line points={live.flatMap((p) => [p.x * PPF, p.y * PPF])} stroke={c.focus} strokeWidth={2} strokeScaleEnabled={false} listening={false} />
                {segments.map(({ a, b }, i) => {
                  const len = Math.hypot(b.x - a.x, b.y - a.y);
                  return len < 0.1 ? null : (
                    <Text key={`l${i}`} text={`${len.toFixed(1)} ft`} x={((a.x + b.x) / 2) * PPF + 6 / view.scale} y={((a.y + b.y) / 2) * PPF - fs - 4 / view.scale}
                      fontSize={fs} fill={c.ink} listening={false} />
                  );
                })}
                {draft.map((p, i) => <Circle key={i} x={p.x * PPF} y={p.y * PPF} radius={(i === 0 && draft.length >= 3 ? 8 : 4) / view.scale} fill={i === 0 && draft.length >= 3 ? c.panel : c.focus}
                  stroke={c.focus} strokeWidth={2} strokeScaleEnabled={false} listening={false} />)}
                {cursor && <Circle x={cursor.point.x * PPF} y={cursor.point.y * PPF} radius={4 / view.scale} fill={c.focus} listening={false} />}
              </>
            );
          })()}
          {/* room vertex handles */}
          {tool === "select" && !event && venue.room.map((p, i) => (
            <Rect key={i} x={p.x * PPF - 5} y={p.y * PPF - 5} width={10} height={10} fill={c.panel} stroke={c.focus} strokeWidth={2}
              draggable
              onDragEnd={(e) => {
                const pt = { x: snapTo((e.target.x() + 5) / PPF, props.snap), y: snapTo((e.target.y() + 5) / PPF, props.snap) };
                props.onRoomVertexMove(i, pt);
              }}
              onDblClick={(e) => { e.cancelBubble = true; props.onRoomVertexRemove(i); }}
            />
          ))}
          {tool === "calibrate" && props.calibration.map((p, i) => <Circle key={i} x={p.x * PPF} y={p.y * PPF} radius={6} fill={c.danger} listening={false} />)}
          {tool === "calibrate" && props.calibration.length === 2 && line(props.calibration, c.danger, { key: "cal", width: 2 })}
        </Layer>
      </Stage>
    </div>
  );
}

