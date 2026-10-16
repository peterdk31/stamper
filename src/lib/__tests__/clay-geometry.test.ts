import { describe, expect, it } from "vitest";
import { clayTopShapes } from "../clay-geometry";

const rect = (x0: number, y0: number, x1: number, y1: number) => [
  { x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 },
];

function area(ring: { x: number; y: number }[]): number {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

const clayArea = (shapes: ReturnType<typeof clayTopShapes>) =>
  shapes.reduce((sum, s) => sum + area(s.outer) - s.holes.reduce((h, r) => h + area(r), 0), 0);

describe("clayTopShapes", () => {
  const tile = rect(0, 0, 40, 40);

  it("is the whole tile without a design", () => {
    expect(clayArea(clayTopShapes(tile, []))).toBeCloseTo(1600);
  });

  it("cuts the design out as a pocket", () => {
    const shapes = clayTopShapes(tile, [{ outer: rect(10, 10, 20, 20), holes: [] }]);
    expect(shapes).toHaveLength(1);
    expect(shapes[0].holes).toHaveLength(1);
    expect(clayArea(shapes)).toBeCloseTo(1500);
  });

  it("keeps the inside of a ring as a clay island", () => {
    const shapes = clayTopShapes(tile, [{ outer: rect(10, 10, 30, 30), holes: [rect(15, 15, 25, 25)] }]);
    expect(shapes).toHaveLength(2);
    expect(clayArea(shapes)).toBeCloseTo(1600 - 400 + 100);
  });

  it("unions overlapping shapes, whatever their winding", () => {
    const shapes = clayTopShapes(tile, [
      { outer: rect(10, 10, 20, 20), holes: [] },
      { outer: rect(15, 10, 25, 20).reverse(), holes: [] },
    ]);
    expect(clayArea(shapes)).toBeCloseTo(1600 - 150);
  });
});
