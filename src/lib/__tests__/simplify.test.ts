import { describe, it, expect } from "vitest";
import { simplifyContour, simplifyShape } from "../simplify";
import { ringsCross } from "../contour-utils";

type Point = { x: number; y: number };

const pts = (xy: number[][]): Point[] => xy.map(([x, y]) => ({ x, y }));
const square = (x0: number, y0: number, x1: number, y1: number): Point[] =>
  pts([[x0, y0], [x1, y0], [x1, y1], [x0, y1]]);

function area(p: Point[]): number {
  let a = 0;
  for (let i = p.length - 1, j = 0; j < p.length; i = j++) a += p[i].x * p[j].y - p[j].x * p[i].y;
  return Math.abs(a / 2);
}

// Gap between two fin rays of the Makrel at 60 mm wide, after medial thickening:
// a long narrow wedge that 0.05 mm Douglas-Peucker folds into a bow-tie
const FIN_GAP = pts([
  [19.883, 2.736], [19.89, 2.746], [19.682, 2.885], [19.68, 2.883], [19.511, 3.006], [19.509, 3.004],
  [19.288, 3.185], [19.137, 3.325], [19.042, 3.418], [18.812, 3.663], [18.813, 3.663], [18.606, 3.908],
  [18.426, 4.138], [18.427, 4.139], [18.178, 4.502], [18.01, 4.766], [18.012, 4.767], [17.914, 4.93],
  [17.873, 5.021], [17.821, 4.999], [17.857, 5.025], [17.953, 5.032], [18.093, 5.019], [18.219, 4.991],
  [18.329, 4.949], [18.421, 4.891], [18.406, 4.875], [18.418, 4.863], [18.455, 4.805], [18.464, 4.796],
  [18.46, 4.792], [18.583, 4.657], [18.563, 4.681], [18.695, 4.546], [18.96, 4.304], [19.071, 4.205],
  [19.249, 4.059], [19.453, 3.91], [19.621, 3.806], [19.671, 3.778], [19.638, 3.794], [19.872, 3.662],
  [19.929, 3.636], [19.951, 3.682], [19.927, 3.192], [19.927, 3.172], [19.944, 3.171], [19.926, 3.172],
  [19.91, 2.928], [19.908, 2.91], [19.894, 2.773], [19.901, 2.772], [19.886, 2.715],
]);

describe("ringsCross", () => {
  it("finds no crossing in a square with a hole", () => {
    expect(ringsCross([square(0, 0, 10, 10), square(2, 2, 4, 4)])).toBe(false);
  });

  it("finds a bow-tie", () => {
    expect(ringsCross([pts([[0, 0], [2, 2], [2, 0], [0, 2]])])).toBe(true);
  });

  it("finds a hole crossing its outer", () => {
    expect(ringsCross([square(0, 0, 10, 10), square(8, 2, 12, 4)])).toBe(true);
  });
});

describe("simplifyShape", () => {
  it("doesn't fold a narrow wedge hole into a bow-tie", () => {
    // The plain per-ring simplification is what used to make the stamp fill the gap
    expect(ringsCross([simplifyContour(FIN_GAP, 0.05)])).toBe(true);

    const outer = square(15, 0, 25, 8);
    const s = simplifyShape(outer, [FIN_GAP], 0.05)!;
    expect(s.holes).toHaveLength(1);
    expect(ringsCross([s.outer, ...s.holes])).toBe(false);
    expect(area(s.holes[0])).toBeCloseTo(area(FIN_GAP), 1);
  });

  it("simplifies at the full tolerance when nothing crosses", () => {
    const circle = Array.from({ length: 400 }, (_, i) => {
      const a = (i / 400) * 2 * Math.PI;
      return { x: 5 + 4 * Math.cos(a), y: 5 + 4 * Math.sin(a) };
    });
    const s = simplifyShape(circle, [], 0.05)!;
    expect(s.outer).toEqual(simplifyContour(circle, 0.05));
  });
});
