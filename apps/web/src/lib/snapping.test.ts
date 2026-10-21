import { describe, expect, it } from "vitest";
import { boxAround, snapBox, type Box } from "./snapping";

const box = (minX: number, minY: number, maxX: number, maxY: number): Box => ({ minX, minY, maxX, maxY });

describe("boxAround", () => {
  it("is the box of a rotated rectangle", () => {
    const b = boxAround({ x: 10, y: 10, width: 4, depth: 2, rotation: 90 });
    expect(b.minX).toBeCloseTo(9);
    expect(b.maxX).toBeCloseTo(11);
    expect(b.minY).toBeCloseTo(8);
    expect(b.maxY).toBeCloseTo(12);
  });
});

describe("snapBox", () => {
  const opts = { thresholdFt: 0.5 };

  it("pushes a box flush against the side of another one", () => {
    // moving box left edge at 10.3, the other's right edge at 10: pull left by 0.3
    const r = snapBox(box(10.3, 0, 12.3, 2), [box(4, 0, 10, 2)], opts);
    expect(r.dx).toBeCloseTo(-0.3);
    expect(r.dy).toBe(0);
  });

  it("lines up with an edge on the same side", () => {
    const r = snapBox(box(4.2, 5, 6.2, 7), [box(4, 0, 9, 2)], opts);
    expect(r.dx).toBeCloseTo(-0.2);
  });

  it("lines up centres", () => {
    // moving centre x = 7.1, other centre x = 7
    const r = snapBox(box(6.1, 5, 8.1, 7), [box(4, 0, 10, 2)], opts);
    expect(r.dx).toBeCloseTo(-0.1);
  });

  it("does not move a box that is farther than the threshold from everything", () => {
    const r = snapBox(box(20, 20, 22, 22), [box(0, 0, 4, 4)], opts);
    expect(r).toMatchObject({ dx: 0, dy: 0, guides: [] });
  });

  it("snaps each axis on its own", () => {
    const r = snapBox(box(10.2, 3.9, 12.2, 5.9), [box(4, 0, 10, 4)], opts);
    expect(r.dx).toBeCloseTo(-0.2); // flush to the other's right edge
    expect(r.dy).toBeCloseTo(0.1); // top edge flush with the other's bottom edge at y = 4
  });

  it("takes the closest candidate when several are in range", () => {
    // left edge 10.3 is 0.3 from 10 and 0.4 from 9.9... closest is 10
    const r = snapBox(box(10.3, 0, 12.3, 2), [box(0, 0, 10, 2), box(0, 0, 9.9, 2)], opts);
    expect(r.dx).toBeCloseTo(-0.3);
  });

  it("reports a guide for each snapped axis", () => {
    const r = snapBox(box(10.2, 5, 12.2, 7), [box(4, 0, 10, 2)], opts);
    expect(r.guides).toHaveLength(1);
    expect(r.guides[0]).toMatchObject({ axis: "x" });
    expect(r.guides[0]!.pos).toBeCloseTo(10);
  });

  it("does nothing when there is nothing to snap to", () => {
    expect(snapBox(box(0, 0, 2, 2), [], opts)).toEqual({ dx: 0, dy: 0, guides: [] });
  });
});
