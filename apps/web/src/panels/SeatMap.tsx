import type { EventDoc, VenueDoc } from "@lpd/shared";
import { CIRCUIT_COLORS } from "../canvas/FloorPlan";

type Tint = "done" | "partial" | "none";

/** Read-only floor plan as SVG. Used on phones, in setup mode and for printing. */
export function SeatMap(props: {
  venue: VenueDoc;
  event: EventDoc;
  seatLabels: Record<string, string>;
  tint?: Record<string, Tint>;
  highlightSeat?: string | null;
  onSeatClick?: (seatId: string) => void;
}) {
  const { venue, event } = props;
  const pts = [
    ...venue.room,
    ...event.tables.flatMap((t) => [
      { x: t.x - t.width / 2 - 2, y: t.y - t.depth / 2 - 2 },
      { x: t.x + t.width / 2 + 2, y: t.y + t.depth / 2 + 2 },
    ]),
    ...event.seats,
    ...venue.doors,
    ...venue.outlets,
    ...event.devices,
    ...event.strips,
  ];
  if (pts.length === 0) pts.push({ x: 0, y: 0 }, { x: 20, y: 12 });
  const minX = Math.min(...pts.map((p) => p.x)) - 2;
  const maxX = Math.max(...pts.map((p) => p.x)) + 2;
  const minY = Math.min(...pts.map((p) => p.y)) - 2;
  const maxY = Math.max(...pts.map((p) => p.y)) + 2;
  const fillFor = (id: string) => {
    const t = props.tint?.[id];
    if (t === "done") return "var(--ok)";
    if (t === "partial") return "var(--warn)";
    return props.seatLabels[id] ? "var(--primary)" : "var(--seat)";
  };
  return (
    <div className="seatmap-wrap">
      <svg viewBox={`${minX} ${minY} ${maxX - minX} ${maxY - minY}`} role="img" aria-label="Seat map">
        {venue.room.length > 2 && (
          <polygon points={venue.room.map((p) => `${p.x},${p.y}`).join(" ")} fill="var(--floor)" stroke="var(--floor-line)" strokeWidth={0.2} />
        )}
        {venue.obstacles.map((o) => (
          <g key={o.id} transform={`translate(${o.x} ${o.y}) rotate(${o.rotation})`}>
            <rect x={-o.width / 2} y={-o.depth / 2} width={o.width} height={o.depth} fill="var(--line-strong)" opacity={0.6} />
            <text textAnchor="middle" y={0.3} fontSize={0.9} fill="var(--ink)">{o.label}</text>
          </g>
        ))}
        {venue.doors.map((d) => (
          <g key={d.id} transform={`translate(${d.x} ${d.y}) rotate(${d.rotation})`}>
            <rect x={-d.width / 2} y={-0.2} width={d.width} height={0.4} fill="var(--floor)" />
            <g transform={`scale(${d.flipHinge ? -1 : 1} ${d.flipSwing ? -1 : 1})`}>
              <line x1={-d.width / 2} y1={0} x2={-d.width / 2} y2={d.width} stroke="var(--ink)" strokeWidth={0.12} />
              <path d={`M ${d.width / 2} 0 A ${d.width} ${d.width} 0 0 1 ${-d.width / 2} ${d.width}`} fill="none" stroke="var(--ink-2)" strokeWidth={0.06} strokeDasharray="0.2 0.2" />
            </g>
          </g>
        ))}
        {venue.outlets.map((o) => {
          const i = venue.circuits.findIndex((c) => c.id === o.circuitId);
          return (
            <circle key={o.id} cx={o.x} cy={o.y} r={0.5} fill={i >= 0 ? CIRCUIT_COLORS[i % CIRCUIT_COLORS.length] : "var(--panel)"} stroke="var(--ink-2)" strokeWidth={0.1} strokeDasharray={i >= 0 ? undefined : "0.2 0.15"} />
          );
        })}
        {event.tables.map((t) => (
          <g key={t.id} transform={`translate(${t.x} ${t.y}) rotate(${t.rotation})`}>
            {t.shape === "round" ? (
              <circle r={t.width / 2} fill="var(--table)" stroke="var(--table-line)" strokeWidth={0.12} />
            ) : (
              <rect x={-t.width / 2} y={-t.depth / 2} width={t.width} height={t.depth} rx={0.2} fill="var(--table)" stroke="var(--table-line)" strokeWidth={0.12} />
            )}
            <text textAnchor="middle" y={0.3} fontSize={0.9} fill="var(--ink-2)">{t.label}</text>
          </g>
        ))}
        {event.devices.map((d) => (
          <g key={d.id}>
            <rect x={d.x - 1.1} y={d.y - 0.55} width={2.2} height={1.1} rx={0.2} fill="var(--panel)" stroke="var(--net)" strokeWidth={0.14} />
            <text x={d.x} y={d.y + 0.3} textAnchor="middle" fontSize={0.8} fill="var(--ink)">{d.label}</text>
          </g>
        ))}
        {event.seats.map((s) => {
          const label = props.seatLabels[s.id];
          const active = props.highlightSeat === s.id;
          return (
            <g
              key={s.id}
              transform={`translate(${s.x} ${s.y})`}
              onClick={props.onSeatClick ? () => props.onSeatClick!(s.id) : undefined}
              style={props.onSeatClick ? { cursor: "pointer" } : undefined}
            >
              <rect x={-0.75} y={-0.75} width={1.5} height={1.5} rx={0.3} fill={fillFor(s.id)} stroke={active ? "var(--focus)" : "var(--table-line)"} strokeWidth={active ? 0.25 : 0.1} />
              {label && (
                <text textAnchor="middle" y={0.28} fontSize={0.62} fill="var(--panel)" style={{ pointerEvents: "none" }}>
                  {label.length > 7 ? `${label.slice(0, 6)}…` : label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
