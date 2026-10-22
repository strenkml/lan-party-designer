import type { Point, VenueDoc } from "@lpd/shared";
import { newId } from "./id";
import { snapToWall } from "./walls";

const WALL_KINDS = ["door", "window", "garage", "outlet", "jack"] as const;
type WallKind = (typeof WALL_KINDS)[number];

/** Distance a clone sits from the original along the wall, for things with no width of their own. */
const SMALL_STEP_FT = 2;

const copyLabel = (label: string) => (label ? `${label} copy` : "");

/**
 * Adds a copy of a door, window, garage door, outlet or network jack beside the original on the same wall.
 * Everything else about it is kept. Returns the new item, or null when there is nothing to clone.
 */
export function cloneVenueItem(doc: VenueDoc, sel: { kind: string; id: string }): { kind: WallKind; id: string } | null {
  if (!(WALL_KINDS as readonly string[]).includes(sel.kind)) return null;
  const kind = sel.kind as WallKind;
  const list: { id: string; x: number; y: number; rotation?: number; width?: number; label?: string }[] =
    kind === "door" ? doc.doors
    : kind === "window" ? doc.windows
    : kind === "garage" ? doc.garageDoors
    : kind === "outlet" ? doc.outlets
    : doc.jacks;
  const original = list.find((x) => x.id === sel.id);
  if (!original) return null;

  const id = newId(kind);
  // flat objects, so a spread is a full copy (and works on an immer draft, which structuredClone cannot)
  const copy = { ...original };
  copy.id = id;
  if (copy.label !== undefined) copy.label = copyLabel(copy.label);

  // Outlets keep no rotation of their own, so they follow whichever wall they are snapped to.
  const wallAt = (p: Point) => snapToWall(doc.room, p, { maxDistFt: 2 });
  const step = original.width ?? SMALL_STEP_FT;
  const rotation = original.rotation ?? wallAt(original)?.rotation ?? 0;
  const along = { x: Math.cos((rotation * Math.PI) / 180), y: Math.sin((rotation * Math.PI) / 180) };
  const at = (sign: number): Point => ({ x: original.x + along.x * step * sign, y: original.y + along.y * step * sign });

  // Prefer the far side; if that runs off the end of the wall, try the near side.
  let spot: Point = at(1);
  const ahead = wallAt(spot);
  if (!ahead || Math.hypot(ahead.point.x - spot.x, ahead.point.y - spot.y) > 0.01) {
    const behind = wallAt(at(-1));
    if (behind && Math.hypot(behind.point.x - at(-1).x, behind.point.y - at(-1).y) <= 0.01) spot = at(-1);
  }
  const onWall = wallAt(spot);
  const round = (n: number) => Math.round(n * 1e6) / 1e6;
  copy.x = round(onWall?.point.x ?? spot.x);
  copy.y = round(onWall?.point.y ?? spot.y);
  if (copy.rotation !== undefined && onWall) copy.rotation = onWall.rotation;

  list.push(copy);
  return { kind, id };
}
