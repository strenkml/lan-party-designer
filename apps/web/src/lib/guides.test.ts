import { describe, expect, it } from "vitest";
import { guideRoomPoint } from "./guides";

const none = { snapGrid: false };

describe("guideRoomPoint", () => {
  it("snaps a nearly horizontal segment flat and shows a guide", () => {
    const r = guideRoomPoint([{ x: 0, y: 0 }], { x: 10, y: 0.5 }, none);
    expect(r.point).toEqual({ x: 10, y: 0 });
    expect(r.guides.map((g) => g.kind)).toEqual(["ortho"]);
  });

  it("snaps a nearly vertical segment straight", () => {
    const r = guideRoomPoint([{ x: 4, y: 2 }], { x: 4.4, y: 12 }, none);
    expect(r.point).toEqual({ x: 4, y: 12 });
  });

  it("leaves a clearly diagonal segment alone", () => {
    const r = guideRoomPoint([{ x: 0, y: 0 }], { x: 8, y: 6 }, none);
    expect(r.point).toEqual({ x: 8, y: 6 });
    expect(r.guides).toEqual([]);
  });

  it("squares up the fourth corner of a rectangle against the first corner", () => {
    const draft = [{ x: 0, y: 0 }, { x: 12, y: 0 }, { x: 12, y: 8 }];
    const r = guideRoomPoint(draft, { x: 0.3, y: 8.4 }, none);
    expect(r.point).toEqual({ x: 0, y: 8 });
    expect(r.guides.map((g) => g.kind).sort()).toEqual(["align", "ortho"]);
  });

  it("aligns with an earlier corner even when the segment is diagonal", () => {
    const draft = [{ x: 5, y: 0 }, { x: 15, y: 6 }];
    const r = guideRoomPoint(draft, { x: 5.2, y: 14 }, none);
    expect(r.point.x).toBe(5);
    expect(r.guides.some((g) => g.kind === "align")).toBe(true);
  });

  it("does nothing special for the first corner except the grid", () => {
    expect(guideRoomPoint([], { x: 3.3, y: 4.8 }, { snapGrid: true }).point).toEqual({ x: 3.5, y: 5 });
  });

  it("can be switched off", () => {
    const r = guideRoomPoint([{ x: 0, y: 0 }], { x: 10, y: 0.5 }, { snapGrid: false, disabled: true });
    expect(r.point).toEqual({ x: 10, y: 0.5 });
    expect(r.guides).toEqual([]);
  });
});
