import { describe, expect, it } from "vitest";
import { snapToWall } from "./walls";

// 20 x 10 ft room, corners clockwise from the top left
const room = [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }, { x: 0, y: 10 }];

describe("snapToWall", () => {
  it("moves a point near the top wall onto it, with the door facing into the room", () => {
    const s = snapToWall(room, { x: 7, y: 1.2 }, { maxDistFt: 3 })!;
    expect(s.point).toEqual({ x: 7, y: 0 });
    // local +y points down into the room: no turn needed
    expect(s.rotation).toBe(0);
  });

  it("faces into the room from the bottom wall", () => {
    const s = snapToWall(room, { x: 5, y: 9.4 }, { maxDistFt: 3 })!;
    expect(s.point).toEqual({ x: 5, y: 10 });
    expect(s.rotation).toBe(180);
  });

  it("turns a quarter for side walls", () => {
    const right = snapToWall(room, { x: 19.5, y: 4 }, { maxDistFt: 3 })!;
    expect(right.point).toEqual({ x: 20, y: 4 });
    expect(Math.abs(right.rotation)).toBe(90);
    const left = snapToWall(room, { x: 0.5, y: 4 }, { maxDistFt: 3 })!;
    expect(left.point).toEqual({ x: 0, y: 4 });
    expect(Math.abs(left.rotation)).toBe(90);
    expect(left.rotation).not.toBe(right.rotation);
  });

  it("returns nothing when the point is far from every wall", () => {
    expect(snapToWall(room, { x: 10, y: 5 }, { maxDistFt: 3 })).toBeNull();
  });

  it("returns nothing without a room", () => {
    expect(snapToWall([], { x: 1, y: 1 }, { maxDistFt: 3 })).toBeNull();
  });

  it("keeps the point inside the wall when it is past a corner", () => {
    const s = snapToWall(room, { x: -0.5, y: 0.5 }, { maxDistFt: 3 })!;
    expect(s.point.x).toBeGreaterThanOrEqual(0);
    expect(s.point.y).toBeGreaterThanOrEqual(0);
  });

  it("works on a wall that is not axis aligned", () => {
    const diamond = [{ x: 10, y: 0 }, { x: 20, y: 10 }, { x: 10, y: 20 }, { x: 0, y: 10 }];
    const s = snapToWall(diamond, { x: 15.5, y: 4.5 }, { maxDistFt: 3 })!;
    expect(s.point.x).toBeCloseTo(15, 1);
    expect(s.point.y).toBeCloseTo(5, 1);
    expect(Math.abs(s.rotation)).toBeCloseTo(45, 0);
  });
});
