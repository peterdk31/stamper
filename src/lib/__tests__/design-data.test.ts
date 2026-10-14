import { describe, it, expect } from "vitest";
import { designDataToShapes } from "../design-data";
import type { DesignData } from "@/types/stamp";

type Point = { x: number; y: number };

const pts = (xy: number[][]): Point[] => xy.map(([x, y]) => ({ x, y }));

function area(p: Point[]): number {
  let a = 0;
  for (let i = p.length - 1, j = 0; j < p.length; i = j++) a += p[i].x * p[j].y - p[j].x * p[i].y;
  return Math.abs(a / 2);
}

const data = (outer: Point[], holes: Point[][]): DesignData => ({
  shapes: [{ outer, holes }],
  bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
  sourceAspectRatio: null,
});

// Gap between two tail fin rays of the Makrel at 66 mm wide, after medial
// thickening. Clipper's rounding left a 0.01 mm spike at points 43–46 that
// crosses back over the previous edge.
const TAIL_GAP = pts([
  [58.19, 13.684], [58.15, 13.695], [58.136, 13.708], [58.146, 13.728], [58.18, 13.758], [58.238, 13.801],
  [58.294, 13.832], [58.366, 13.857], [58.492, 13.913], [58.494, 13.909], [58.886, 14.078], [58.887, 14.077],
  [59.251, 14.226], [59.933, 14.514], [60.206, 14.638], [60.58, 14.816], [61.534, 15.3], [62.017, 15.557],
  [62.243, 15.685], [62.406, 15.789], [62.404, 15.792], [62.417, 15.797], [62.38, 15.707], [62.378, 15.708],
  [62.295, 15.529], [62.294, 15.53], [62.167, 15.258], [62.098, 15.1], [62.017, 14.905], [62.019, 14.904],
  [61.906, 14.624], [61.863, 14.474], [61.835, 14.419], [61.737, 14.364], [61.55, 14.302], [61.537, 14.351],
  [61.242, 14.265], [60.818, 14.163], [60.392, 14.069], [59.883, 13.964], [59.095, 13.806], [58.729, 13.738],
  [58.729, 13.736], [58.429, 13.687], [58.43, 13.677], [58.43, 13.682], [58.412, 13.682], [58.343, 13.675],
  [58.256, 13.673],
]);

describe("designDataToShapes", () => {
  it("keeps a hole whose outline crosses itself instead of filling it", () => {
    const outer = pts([[57, 13], [63, 13], [63, 16.5], [57, 16.5]]);
    const shapes = designDataToShapes(data(outer, [TAIL_GAP]));
    expect(shapes).toHaveLength(1);
    expect(shapes[0].holes).toHaveLength(1);
    expect(area(shapes[0].holes[0].getPoints())).toBeCloseTo(area(TAIL_GAP), 2);
  });

  it("keeps a self-crossing outer", () => {
    // Bow-tie: two triangles meeting at (1, 1)
    const shapes = designDataToShapes(data(pts([[0, 0], [2, 2], [2, 0], [0, 2]]), []));
    expect(shapes).toHaveLength(2);
  });
});
