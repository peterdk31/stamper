import { describe, it, expect } from "vitest";
import { draftLayers } from "../draft-geometry";
import type { ShapeData } from "../clipper-thicken";

type Point = { x: number; y: number };

const rect = (x0: number, y0: number, x1: number, y1: number): Point[] =>
  [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];

function area(p: Point[]): number {
  let a = 0;
  for (let i = p.length - 1, j = 0; j < p.length; i = j++) a += p[i].x * p[j].y - p[j].x * p[i].y;
  return Math.abs(a / 2);
}

const filledArea = (shapes: ShapeData[]) =>
  shapes.reduce((sum, s) => sum + area(s.outer) - s.holes.reduce((h, r) => h + area(r), 0), 0);

const xs = (shapes: ShapeData[]) => shapes.flatMap((s) => s.outer.map((p) => p.x));

describe("draftLayers", () => {
  it("is a single straight layer without draft", () => {
    const shapes = [{ outer: rect(0, 0, 10, 10), holes: [] }];
    expect(draftLayers(shapes, 2, 0)).toEqual([{ z0: 0, z1: 2, shapes }]);
  });

  it("keeps the face exact and flares toward the base", () => {
    const shapes = [{ outer: rect(0, 0, 10, 10), holes: [] }];
    const layers = draftLayers(shapes, 2, 10);
    expect(layers).toHaveLength(20);
    expect(layers.at(-1)!.shapes).toBe(shapes);
    expect(layers.at(-1)!.z1).toBeCloseTo(2);
    // Bottom layer: grown by (2 - 0.1) · tan 10° per side, corners stay square
    const grow = 1.9 * Math.tan(Math.PI / 18);
    expect(Math.min(...xs(layers[0].shapes))).toBeCloseTo(-grow, 2);
    expect(filledArea(layers[0].shapes)).toBeCloseTo((10 + 2 * grow) ** 2, 1);
  });

  it("never overhangs: each layer's area shrinks going up", () => {
    const shapes = [{ outer: rect(0, 0, 10, 10), holes: [rect(3, 3, 7, 7)] }];
    const areas = draftLayers(shapes, 2, 15).map((l) => filledArea(l.shapes));
    for (let i = 1; i < areas.length; i++) expect(areas[i]).toBeLessThan(areas[i - 1]);
  });

  it("shrinks holes toward the base", () => {
    const shapes = [{ outer: rect(0, 0, 10, 10), holes: [rect(3, 3, 7, 7)] }];
    const [bottom] = draftLayers(shapes, 2, 10);
    expect(bottom.shapes).toHaveLength(1);
    expect(bottom.shapes[0].holes).toHaveLength(1);
    expect(area(bottom.shapes[0].holes[0])).toBeLessThan(16);
  });

  it("merges features that grow into each other at the base", () => {
    const shapes = [{ outer: rect(0, 0, 4, 4), holes: [] }, { outer: rect(4.2, 0, 8, 4), holes: [] }];
    expect(draftLayers(shapes, 2, 10)[0].shapes).toHaveLength(1);
  });
});
