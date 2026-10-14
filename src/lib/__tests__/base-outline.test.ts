import { describe, it, expect } from "vitest";
import { computeBaseOutline, type BaseOutlineInput } from "../base-outline";
import { cutterRing, cutterZRange } from "../cutter-geometry";

type Point = { x: number; y: number };

const pts = (xy: number[][]): Point[] => xy.map(([x, y]) => ({ x, y }));
const rect = (x0: number, y0: number, x1: number, y1: number) => pts([[x0, y0], [x1, y0], [x1, y1], [x0, y1]]);

function area(p: Point[]): number {
  let a = 0;
  for (let i = p.length - 1, j = 0; j < p.length; i = j++) a += p[i].x * p[j].y - p[j].x * p[i].y;
  return Math.abs(a / 2);
}

function bbox(p: Point[]) {
  return {
    x0: Math.min(...p.map(q => q.x)), x1: Math.max(...p.map(q => q.x)),
    y0: Math.min(...p.map(q => q.y)), y1: Math.max(...p.map(q => q.y)),
  };
}

function inside(p: Point, poly: Point[]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}

// U shape filling a 30 × 30 design area: two 8 mm posts joined at the bottom,
// leaving a 14 × 22 notch open at the top.
const U = pts([[0, 0], [30, 0], [30, 30], [22, 30], [22, 8], [8, 8], [8, 30], [0, 30]]);

const input = (over: Partial<BaseOutlineInput>): BaseOutlineInput => ({
  shapes: [{ outer: U, holes: [] }],
  width: 30, height: 30, margin: 3, fidelity: 100, threadDiameter: null,
  ...over,
});

describe("computeBaseOutline", () => {
  it("returns null without a design", () => {
    expect(computeBaseOutline(input({ shapes: [] }))).toBeNull();
  });

  it("follows the design at fidelity 100, grown by the margin", () => {
    const outline = computeBaseOutline(input({ fidelity: 100 }))!;
    // The notch stays open: its centre is outside the base.
    expect(inside({ x: 18, y: 25 }, outline)).toBe(false);
    // Outline area ≈ U grown by 3 mm with round corners.
    const uArea = area(U);
    expect(area(outline)).toBeGreaterThan(uArea);
    expect(area(outline)).toBeLessThan(36 * 36);
  });

  it("is today's rounded-rect plate at fidelity 0", () => {
    const outline = computeBaseOutline(input({ fidelity: 0 }))!;
    const b = bbox(outline);
    expect(b.x0).toBeCloseTo(0, 1);
    expect(b.y0).toBeCloseTo(0, 1);
    expect(b.x1).toBeCloseTo(36, 1);
    expect(b.y1).toBeCloseTo(36, 1);
    // Corners rounded by the margin: 36² − (4 − π)·3², less the arcs' chord sag
    expect(Math.abs(area(outline) - (36 * 36 - (4 - Math.PI) * 9))).toBeLessThan(2);
  });

  it("never shrinks as fidelity drops", () => {
    const areas = [100, 90, 75, 60, 50, 25, 0].map(f => area(computeBaseOutline(input({ fidelity: f }))!));
    for (let i = 1; i < areas.length; i++) expect(areas[i]).toBeGreaterThanOrEqual(areas[i - 1] - 0.5);
    // The notch is filled by fidelity 50 (U's hull is the full square).
    expect(inside({ x: 18, y: 25 }, computeBaseOutline(input({ fidelity: 50 }))!)).toBe(true);
  });

  it("bridges islands into one ring", () => {
    const shapes = [{ outer: rect(0, 0, 10, 10), holes: [] }, { outer: rect(20, 0, 30, 10), holes: [] }];
    const outline = computeBaseOutline(input({ shapes, width: 30, height: 10, margin: 0, fidelity: 100 }))!;
    expect(inside({ x: 5, y: 5 }, outline)).toBe(true);
    expect(inside({ x: 25, y: 5 }, outline)).toBe(true);
    expect(inside({ x: 15, y: 5 }, outline)).toBe(true);
  });

  it("ignores holes in the design", () => {
    const shapes = [{ outer: rect(0, 0, 30, 30), holes: [rect(10, 10, 20, 20)] }];
    const outline = computeBaseOutline(input({ shapes, fidelity: 100 }))!;
    expect(inside({ x: 18, y: 18 }, outline)).toBe(true);
  });

  it("keeps the thread disc inside the base for a thin design", () => {
    // A 2 mm bar along the top of a 30 × 30 area: the plate centre is far outside it.
    const shapes = [{ outer: rect(0, 26, 30, 28), holes: [] }];
    const outline = computeBaseOutline(input({ shapes, margin: 1, fidelity: 100, threadDiameter: 10 }))!;
    const cx = 15 + 1, cy = 15 + 1; // plate coordinates
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      expect(inside({ x: cx + 6.9 * Math.cos(a), y: cy + 6.9 * Math.sin(a) }, outline)).toBe(true);
    }
  });
});

describe("cutterRing", () => {
  it("sits the clearance outside the base, one wall thick", () => {
    const ring = cutterRing(rect(0, 0, 20, 10), 0.3, 1.2)!;
    const inner = bbox(ring.inner), outer = bbox(ring.outer);
    expect(inner.x0).toBeCloseTo(-0.3, 2);
    expect(inner.x1).toBeCloseTo(20.3, 2);
    expect(outer.y0).toBeCloseTo(-1.5, 2);
    expect(outer.y1).toBeCloseTo(11.5, 2);
  });

  it("spans from the grip height up the base to one clay thickness below the face", () => {
    expect(cutterZRange(6, 4, 6)).toEqual({ bottom: 2, top: 12 });
    expect(cutterZRange(6, 10, 6).bottom).toBe(0);
  });
});
