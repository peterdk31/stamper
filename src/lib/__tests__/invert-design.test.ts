import { describe, it, expect } from "vitest";
import { invertWithinSilhouette } from "../invert-design";
import type { DesignData, StampShapeData } from "@/types/stamp";

type Point = { x: number; y: number };

const rect = (x0: number, y0: number, x1: number, y1: number): Point[] =>
  [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];

function area(p: Point[]): number {
  let a = 0;
  for (let i = p.length - 1, j = 0; j < p.length; i = j++) a += p[i].x * p[j].y - p[j].x * p[i].y;
  return Math.abs(a / 2);
}

const filledArea = (shapes: StampShapeData[]) =>
  shapes.reduce((sum, s) => sum + area(s.outer) - s.holes.reduce((h, r) => h + area(r), 0), 0);

const data = (shapes: StampShapeData[]): DesignData => ({
  shapes,
  bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
  sourceAspectRatio: 1,
});

describe("invertWithinSilhouette", () => {
  it("turns a ring into the disc it encloses", () => {
    const out = invertWithinSilhouette(data([{ outer: rect(0, 0, 10, 10), holes: [rect(1, 1, 9, 9)] }]));
    expect(out.shapes).toHaveLength(1);
    expect(out.shapes[0].holes).toHaveLength(0);
    expect(filledArea(out.shapes)).toBeCloseTo(64, 3);
    expect(out.bounds).toEqual({ minX: 1, minY: 1, maxX: 9, maxY: 9 });
  });

  it("splits an outline crossed by a line into two filled halves", () => {
    // Square frame 1 wide with a vertical bar through the middle: two 3.5×8 windows
    const shape = { outer: rect(0, 0, 10, 10), holes: [rect(1, 1, 4.5, 9), rect(5.5, 1, 9, 9)] };
    const out = invertWithinSilhouette(data([shape]));
    expect(out.shapes).toHaveLength(2);
    expect(filledArea(out.shapes)).toBeCloseTo(2 * 3.5 * 8, 3);
  });

  it("inverts separate subjects on their own and leaves the background empty", () => {
    const out = invertWithinSilhouette(data([
      { outer: rect(0, 0, 10, 10), holes: [rect(1, 1, 9, 9)] },
      { outer: rect(20, 0, 30, 10), holes: [rect(22, 2, 28, 8)] },
    ]));
    expect(out.shapes).toHaveLength(2);
    expect(filledArea(out.shapes)).toBeCloseTo(64 + 36, 3);
  });

  it("turns an island inside a hole into a hole in the relief", () => {
    // Frame with a dot in the middle: the window becomes relief, the dot a hole in it
    const out = invertWithinSilhouette(data([
      { outer: rect(0, 0, 10, 10), holes: [rect(1, 1, 9, 9)] },
      { outer: rect(4, 4, 6, 6), holes: [] },
    ]));
    expect(out.shapes).toHaveLength(1);
    expect(out.shapes[0].holes).toHaveLength(1);
    expect(filledArea(out.shapes)).toBeCloseTo(64 - 4, 3);
  });

  it("leaves nothing for a solid shape", () => {
    const out = invertWithinSilhouette(data([{ outer: rect(0, 0, 10, 10), holes: [] }]));
    expect(out.shapes).toHaveLength(0);
  });
});
