import { describe, it, expect } from "vitest";
import { traceGrid } from "../potrace-trace";
import { fitCurves, type Point } from "../curve-fit";

const SIZE = 400;
const noop = () => {};

/** Rasterize an inside-test into a grid (pixel (x,y) covers [x,x+1]×[y,y+1]). */
function grid(inside: (x: number, y: number) => boolean): Uint8Array {
  const g = new Uint8Array(SIZE * SIZE);
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) if (inside(x + 0.5, y + 0.5)) g[y * SIZE + x] = 1;
  return g;
}

/** Trace and map the output back to grid coordinates (undo trim + y flip). */
function trace(g: Uint8Array): Point[] {
  let minX = SIZE, minY = SIZE;
  for (let i = 0; i < g.length; i++) {
    if (!g[i]) continue;
    minX = Math.min(minX, i % SIZE);
    minY = Math.min(minY, Math.floor(i / SIZE));
  }
  const ox = Math.max(0, minX - 2), oy = Math.max(0, minY - 2);
  const r = traceGrid(g, SIZE, SIZE, noop);
  expect(r.shapes).toHaveLength(1);
  return r.shapes[0].outer.map((p) => ({ x: p.x + ox, y: r.imageHeight - p.y + oy }));
}

function area(p: Point[]): number {
  let a = 0;
  for (let i = p.length - 1, j = 0; j < p.length; i = j++) a += p[i].x * p[j].y - p[j].x * p[i].y;
  return Math.abs(a / 2);
}

function distToPolygon(p: Point, poly: Point[]): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const dx = b.x - a.x, dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
    best = Math.min(best, Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy));
  }
  return best;
}

/** Largest change of direction between consecutive segments, in degrees. */
function maxTurn(p: Point[]): number {
  let max = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[(i - 1 + p.length) % p.length], b = p[i], c = p[(i + 1) % p.length];
    const t = Math.abs(Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(b.y - a.y, b.x - a.x));
    max = Math.max(max, Math.min(t, 2 * Math.PI - t) * 180 / Math.PI);
  }
  return max;
}

describe("Potrace curve fitting", () => {
  it("traces a circle smoothly without shrinking it", () => {
    const [cx, cy, r] = [200, 200, 120];
    const out = trace(grid((x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r));
    expect(Math.abs(area(out) / (Math.PI * r * r) - 1)).toBeLessThan(0.01);
    for (const p of out) expect(Math.abs(Math.hypot(p.x - cx, p.y - cy) - r)).toBeLessThan(0.75);
    expect(maxTurn(out)).toBeLessThan(10); // no visible facets
  });

  it("keeps the corners of a square sharp", () => {
    const sq: Point[] = [{ x: 100, y: 100 }, { x: 300, y: 100 }, { x: 300, y: 300 }, { x: 100, y: 300 }];
    const out = trace(grid((x, y) => x >= 100 && x <= 300 && y >= 100 && y <= 300));
    expect(Math.abs(area(out) / (200 * 200) - 1)).toBeLessThan(0.01);
    for (const c of sq) expect(Math.min(...out.map((p) => Math.hypot(p.x - c.x, p.y - c.y)))).toBeLessThan(0.75);
    for (const p of out) expect(distToPolygon(p, sq)).toBeLessThan(0.75);
  });

  it("keeps the corners of a rotated square sharp", () => {
    const d: Point[] = [{ x: 200, y: 60 }, { x: 340, y: 200 }, { x: 200, y: 340 }, { x: 60, y: 200 }];
    const out = trace(grid((x, y) => Math.abs(x - 200) + Math.abs(y - 200) <= 140));
    expect(Math.abs(area(out) / (2 * 140 * 140) - 1)).toBeLessThan(0.01);
    for (const c of d) expect(Math.min(...out.map((p) => Math.hypot(p.x - c.x, p.y - c.y)))).toBeLessThan(1.5);
    for (const p of out) expect(distToPolygon(p, d)).toBeLessThan(1);
  });

  it("keeps a thin bar at its width", () => {
    const bar: Point[] = [{ x: 50, y: 197 }, { x: 350, y: 197 }, { x: 350, y: 203 }, { x: 50, y: 203 }];
    const out = trace(grid((x, y) => x >= 50 && x <= 350 && y >= 197 && y <= 203));
    expect(Math.abs(area(out) / (300 * 6) - 1)).toBeLessThan(0.01);
    for (const p of out) expect(distToPolygon(p, bar)).toBeLessThan(0.75);
  });

  it("keeps a long tapering fin", () => {
    const fin: Point[] = [{ x: 50, y: 180 }, { x: 350, y: 200 }, { x: 50, y: 220 }];
    const inside = (x: number, y: number) => x >= 50 && x <= 350 && Math.abs(y - 200) <= 20 * (350 - x) / 300;
    const out = trace(grid(inside));
    expect(Math.abs(area(out) / area(fin) - 1)).toBeLessThan(0.02);
    for (const p of out) expect(distToPolygon(p, fin)).toBeLessThan(1);
  });

  it("passes curves through edge midpoints and keeps sharp vertices", () => {
    const tri: Point[] = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 100 }];
    const out = fitCurves(tri);
    for (const v of tri) expect(out).toContainEqual(v);
  });
});
