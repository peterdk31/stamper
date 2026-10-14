import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { FontLoader } from "three/examples/jsm/loaders/FontLoader.js";
import { medialThicken, makeGrid, rasterizeShapes, findThinRidges, closingFill } from "../medial-thicken";
import { squaredEDT, initEDT } from "../edt";
import type { Point, ShapeData } from "../clipper-thicken";

const NOZZLE = 0.4;
const TARGET = NOZZLE * 0.85; // PrusaSlicer default min perimeter width
const MIN_FEATURE = NOZZLE * 0.25; // PrusaSlicer default min feature size
const STAMP = 10;

const rect = (x0: number, y0: number, x1: number, y1: number): Point[] =>
  [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];

const circle = (cx: number, cy: number, r: number, ccw = true): Point[] =>
  Array.from({ length: 96 }, (_, i) => {
    const a = (ccw ? 1 : -1) * (i / 96) * 2 * Math.PI;
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  });

function run(shapes: ShapeData[], thicken = true) {
  return medialThicken(shapes, STAMP, STAMP, { targetWidth: TARGET, minFeatureSize: MIN_FEATURE, thicken });
}

/**
 * Thin ridge pixels left in the shapes, checked with a 1px raster tolerance.
 * Gaps below min feature size count as filled, as the slicer closes them.
 */
function residualThin(shapes: ShapeData[]): number {
  const grid = makeGrid(shapes, TARGET)!;
  const mask = rasterizeShapes(shapes, grid);
  const gaps = closingFill(mask, grid.w, grid.h, MIN_FEATURE / 2 / grid.res);
  for (let i = 0; i < mask.length; i++) if (gaps[i]) mask[i] = 1;
  return findThinRidges(mask, grid.w, grid.h, TARGET / 2 / grid.res, 1.0).indices.length;
}

/** Widest inscribed disc diameter (mm) of the shapes inside a probe box. */
function maxWidthIn(shapes: ShapeData[], box: [number, number, number, number]): number {
  const grid = makeGrid(shapes, TARGET)!;
  const mask = rasterizeShapes(shapes, grid);
  const d = squaredEDT(initEDT(mask, grid.w * grid.h, false), grid.w, grid.h);
  let best = 0;
  for (let y = 0; y < grid.h; y++) {
    const my = grid.y0 + y * grid.res;
    if (my < box[1] || my > box[3]) continue;
    for (let x = 0; x < grid.w; x++) {
      const mx = grid.x0 + x * grid.res;
      if (mx < box[0] || mx > box[2]) continue;
      best = Math.max(best, d[y * grid.w + x]);
    }
  }
  return (2 * Math.sqrt(best) - 1) * grid.res;
}

function areaOf(shapes: ShapeData[]): number {
  const signed = (p: Point[]) => {
    let a = 0;
    for (let i = p.length - 1, j = 0; j < p.length; i = j++) a += p[i].x * p[j].y - p[j].x * p[i].y;
    return Math.abs(a / 2);
  };
  return shapes.reduce((sum, s) => sum + signed(s.outer) - s.holes.reduce((hs, h) => hs + signed(h), 0), 0);
}

describe("medialThicken — synthetic shapes", () => {
  it("thickens a 0.2mm bar to the target width without overshooting", () => {
    const shapes = [{ outer: rect(1, 4, 9, 4.2), holes: [] }];
    expect(residualThin(shapes)).toBeGreaterThan(0);
    const r = run(shapes);
    expect(r.modified).toBe(true);
    expect(residualThin(r.shapes)).toBe(0);
    const width = maxWidthIn(r.shapes, [3, 3, 7, 5]);
    expect(width).toBeGreaterThanOrEqual(TARGET - 0.05);
    expect(width).toBeLessThanOrEqual(TARGET + 0.1);
    expect(r.overlay.widened).toBe(true);
    expect(r.overlay.rescued).toBe(false);
    expect(r.overlay.residual).toBe(false);
  });

  it("thickens the thinnest end of a tapered stroke", () => {
    const taper: Point[] = [{ x: 1, y: 5 }, { x: 9, y: 4.95 }, { x: 9, y: 5.25 }, { x: 1, y: 5.05 }];
    const r = run([{ outer: taper, holes: [] }]);
    expect(r.modified).toBe(true);
    expect(residualThin(r.shapes)).toBe(0);
    expect(maxWidthIn(r.shapes, [1.5, 4, 2, 6])).toBeGreaterThanOrEqual(TARGET - 0.05);
    // The 0.1mm end is right at min feature size — the 0.05..0.1 part is rescued
    expect(r.overlay.rescued).toBe(true);
  });

  it("thickens the wall of an 'o' ring (thinness comes from the hole)", () => {
    const shapes = [{ outer: circle(5, 5, 1.5), holes: [circle(5, 5, 1.3, false)] }];
    const r = run(shapes);
    expect(r.modified).toBe(true);
    expect(residualThin(r.shapes)).toBe(0);
    expect(r.shapes).toHaveLength(1);
    expect(r.shapes[0].holes).toHaveLength(1); // counter stays open
  });

  it("thickens only the thin crossbar of a 'T', leaving the stem alone", () => {
    const T: Point[] = [
      { x: 4.5, y: 1 }, { x: 5.5, y: 1 }, { x: 5.5, y: 6 }, { x: 8, y: 6 },
      { x: 8, y: 6.2 }, { x: 2, y: 6.2 }, { x: 2, y: 6 }, { x: 4.5, y: 6 },
    ];
    const r = run([{ outer: T, holes: [] }]);
    expect(r.modified).toBe(true);
    expect(residualThin(r.shapes)).toBe(0);
    // Stem bottom (far from the bar) must keep its exact original edge
    const stemBottom = r.shapes[0].outer.filter((p) => Math.abs(p.y - 1) < 1e-3);
    expect(stemBottom.map((p) => p.x).sort()).toEqual([4.5, 5.5]);
  });

  it("leaves wide shapes with right-angle corners untouched", () => {
    const shapes = [
      { outer: rect(1, 1, 4, 4), holes: [] },
      { outer: [{ x: 7, y: 1 }, { x: 9.1, y: 3.1 }, { x: 7, y: 5.2 }, { x: 4.9, y: 3.1 }], holes: [] },
    ];
    const r = run(shapes);
    expect(r.modified).toBe(false);
    expect(r.overlay.widened || r.overlay.rescued).toBe(false);
  });

  it("only rounds the tips of sharp corners", () => {
    const shapes = [{ outer: [{ x: 2, y: 1 }, { x: 8, y: 1 }, { x: 2, y: 7 }], holes: [] }]; // two 45° tips
    const r = run(shapes);
    expect(residualThin(r.shapes)).toBe(0);
    // Each tip is widened to printable width over its first ~0.4mm, nothing else changes
    expect(areaOf(r.shapes) - areaOf(shapes)).toBeLessThan(0.3);
  });

  it("classifies a hairline below min feature size as rescued", () => {
    const r = run([{ outer: rect(1, 5, 9, 5.06), holes: [] }]);
    expect(r.modified).toBe(true);
    expect(r.overlay.rescued).toBe(true);
    expect(residualThin(r.shapes)).toBe(0);
  });

  it("only classifies when thickening is disabled", () => {
    const shapes = [{ outer: rect(1, 4, 9, 4.2), holes: [] }];
    const r = run(shapes, false);
    expect(r.modified).toBe(false);
    expect(r.shapes).toBe(shapes);
    expect(r.overlay.widened).toBe(true);
  });

  it("paints overlay pixels only around thin features", () => {
    const r = run([
      { outer: rect(1, 1, 4, 4), holes: [] },
      { outer: rect(5, 5, 9, 5.2), holes: [] },
    ]);
    const { pixels, gridW } = r.overlay;
    const alphaAt = (x: number, y: number) => pixels[(Math.round(y / 0.1) * gridW + Math.round(x / 0.1)) * 4 + 3];
    expect(alphaAt(2.5, 2.5)).toBe(0); // wide square
    expect(alphaAt(7, 5.1)).toBe(255); // thin bar
  });
});

describe("medialThicken — small text", () => {
  const loader = new FontLoader();
  const load = (file: string) =>
    loader.parse(JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../../public/fonts", file), "utf8")));

  const glyphShapes = (file: string, text: string, size: number): ShapeData[] =>
    load(file).generateShapes(text, size).map((s) => ({
      outer: s.getPoints(48).map((p) => ({ x: p.x + 0.5, y: p.y + 2 })),
      holes: s.holes.map((hl) => hl.getPoints(48).map((p) => ({ x: p.x + 0.5, y: p.y + 2 }))),
    }));

  for (const [file, size] of [
    ["droid_serif_regular.typeface.json", 2.5],
    ["nunito_regular.typeface.json", 2],
  ] as const) {
    it(`${file} at ${size}mm has no thin features left`, () => {
      const shapes = glyphShapes(file, "aeo8Rgs", size);
      const before = residualThin(shapes);
      expect(before).toBeGreaterThan(0);
      const t0 = performance.now();
      const r = run(shapes);
      const ms = performance.now() - t0;
      expect(r.modified).toBe(true);
      expect(r.overlay.residual).toBe(false);
      expect(residualThin(r.shapes)).toBe(0);
      // Thickening only adds material
      expect(areaOf(r.shapes)).toBeGreaterThan(areaOf(shapes));
      expect(ms).toBeLessThan(3000);
    });
  }
});
