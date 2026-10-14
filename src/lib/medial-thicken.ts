/**
 * Medial-axis thickening.
 *
 * Makes every feature at least `targetWidth` wide (the slicer's minimum
 * perimeter width) while leaving features that are already wide enough
 * untouched:
 *
 *   1. Rasterize the full design (outers minus holes) and compute the
 *      distance-to-edge field.
 *   2. Find ridge pixels (the discrete medial axis) whose local width is
 *      below the target. Corners of wide regions are excluded — the slicer
 *      prints those fine.
 *   3. Push every outline edge near a thin ridge straight outward by half
 *      the shortfall between its thickness (measured along the edge's
 *      normal) and the target, so each thin stroke becomes exactly
 *      target-wide. Edges keep their shape: straight sides stay straight
 *      and stroke ends stay square.
 *   4. Union the pushed edges with the original vector outline, which keeps
 *      all untouched edges exact.
 *
 * Also produces an overlay classifying every thin feature as "widened"
 * (between min feature size and target width — Arachne would widen it too)
 * or "rescued" (below min feature size — the slicer would drop it).
 */

import ClipperLib from "clipper-lib";
import { squaredEDT, initEDT } from "./edt";
import { MIN_AREA_SQ, toClipperPath, fromClipperPath, type Point, type ShapeData } from "./clipper-thicken";
import { simplifyContour } from "./simplify";

export interface MedialThickenOptions {
  targetWidth: number; // mm — features thinner than this are thickened to it
  minFeatureSize: number; // mm — features thinner than this would vanish in the slicer
  thicken: boolean; // false = only classify, leave shapes unchanged
  onProgress?: (progress: number, stage: string) => void;
}

export interface FeatureOverlay {
  /** RGBA over the stamp area at OVERLAY_RESOLUTION, row 0 = y 0. Alpha 0 = no change. */
  pixels: Uint8Array;
  gridW: number;
  gridH: number;
  widened: boolean;
  rescued: boolean;
  /** Features still thinner than the target after thickening — indicates a bug. */
  residual: boolean;
  targetWidth: number; // mm
  minFeatureSize: number; // mm
}

export interface MedialThickenResult {
  shapes: ShapeData[];
  modified: boolean;
  overlay: FeatureOverlay;
}

export const OVERLAY_RESOLUTION = 0.1; // mm per overlay pixel

const PX_PER_TARGET = 8; // raster pixels across one target width
const MIN_RESOLUTION = 0.02; // mm — finest raster grid
const MAX_PIXELS = 6_000_000; // keeps EDT passes well under a second
const CORNER_TOL_PX = 1.0; // tolerance for telling corners of wide regions apart from thin strokes
const THIN_TOL_PX = 0.25; // strokes within this of the target count as wide enough
const VERIFY_TOL_PX = 1.0; // raster round-trip tolerance when checking the result
const RESIDUAL_MIN_PIXELS = 3; // ignore single-pixel raster noise in the check
const INPUT_SIMPLIFY_MM = 0.002; // Douglas-Peucker tolerance for incoming outlines
const MAX_PASSES = 3; // grow passes; later passes only fill necks between merged strokes
const MIN_GROWTH = 0.002; // mm — smaller edge pushes are skipped as measurement noise
const GROW_REACH = 3; // edge points within this × rPx of a thin ridge may grow
const RIDGE_SNAP_PX = 2; // search radius around an inscribed disc's center for its ridge pixel
const JUNCTION_WIDTH_GAP_PX = 1.5; // disc wider than the ridge by this reaches into a junction
const TIP_SLOPE = Math.tan((20 * Math.PI) / 180); // sides converging faster than 20° form a tip…
const TIP_MIN_EDGE_STEPS = 4; // tips are checked on edges at least this many samples long; curves bend too fast to tell
const TIP_DISC_SLOPE = Math.tan((10 * Math.PI) / 180); // …if the inscribed disc shrinks with them
const FLAT_END_MIN = 0.8; // flat stroke ends span 0.8–1.25 × the stroke width
const FLAT_END_MAX = 1.25;
const DISC_BIAS_PX = 1.5; // how much wider the traced disc growth comes out than the target, per side
const ON_EDGE_MM = 0.003; // a disc piece's edge within this of a pushed edge lies on it (Clipper rounds to 0.001)
const NOTCH_SHARED_MIN = 0.6; // disc pieces with at least this share of their outline on pushed edges fill a notch
const BRIDGE_TARGETS = 3; // ungrown stretches up to this × target width between grown ones are bridged
const MITER_LIMIT = 2; // × growth — sharper convex corners are bevelled instead

const WIDENED_COLOR = [217, 119, 6];
const RESCUED_COLOR = [220, 38, 38];
const RESIDUAL_COLOR = [147, 51, 234];

// ---------------------------------------------------------------------------
// Raster grid
// ---------------------------------------------------------------------------

export interface Grid {
  x0: number; // mm — x of pixel column 0's center
  y0: number; // mm — y of pixel row 0's center
  res: number; // mm per pixel
  w: number;
  h: number;
}

export function makeGrid(shapes: ShapeData[], targetWidth: number): Grid | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of shapes) {
    for (const p of s.outer) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  if (minX === Infinity) return null;

  let res = Math.max(MIN_RESOLUTION, targetWidth / PX_PER_TARGET);
  const dims = (r: number) => {
    const border = Math.ceil(targetWidth / r) + 3;
    return {
      border,
      w: Math.ceil((maxX - minX) / r) + 1 + border * 2,
      h: Math.ceil((maxY - minY) / r) + 1 + border * 2,
    };
  };
  let d = dims(res);
  if (d.w * d.h > MAX_PIXELS) {
    res *= Math.sqrt((d.w * d.h) / MAX_PIXELS) * 1.01;
    d = dims(res);
  }
  return { x0: minX - d.border * res, y0: minY - d.border * res, res, w: d.w, h: d.h };
}

/** Scanline fill: each shape is filled even-odd (outer + holes); shapes are OR-ed together. */
export function rasterizeShapes(shapes: ShapeData[], grid: Grid): Uint8Array {
  const { x0, y0, res, w, h } = grid;
  const mask = new Uint8Array(w * h);
  const rows = new Map<number, number[]>();

  for (const shape of shapes) {
    rows.clear();
    for (const contour of [shape.outer, ...shape.holes]) {
      const len = contour.length;
      if (len < 3) continue;
      for (let k = 0; k < len; k++) {
        const a = contour[k], b = contour[(k + 1) % len];
        const ya = (a.y - y0) / res, yb = (b.y - y0) / res;
        if (ya === yb) continue;
        const xa = (a.x - x0) / res, xb = (b.x - x0) / res;
        const lo = Math.max(0, Math.ceil(Math.min(ya, yb)));
        const hi = Math.min(h - 1, Math.ceil(Math.max(ya, yb)) - 1);
        const slope = (xb - xa) / (yb - ya);
        for (let j = lo; j <= hi; j++) {
          let xs = rows.get(j);
          if (!xs) { xs = []; rows.set(j, xs); }
          xs.push(xa + (j - ya) * slope);
        }
      }
    }
    for (const [j, xs] of rows) {
      xs.sort((p, q) => p - q);
      const rowOff = j * w;
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const from = Math.max(0, Math.ceil(xs[k]));
        const to = Math.min(w - 1, Math.ceil(xs[k + 1]) - 1);
        for (let i = from; i <= to; i++) mask[rowOff + i] = 1;
      }
    }
  }
  return mask;
}

// ---------------------------------------------------------------------------
// Thin ridge detection
// ---------------------------------------------------------------------------

export interface ThinRidges {
  indices: number[];
  /** Local feature width at each ridge pixel, in pixels. */
  widthsPx: number[];
}

const NEIGHBORS: [number, number, number][] = [
  [-1, 0, 1], [1, 0, 1], [0, -1, 1], [0, 1, 1],
  [-1, -1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [1, 1, Math.SQRT2],
];

/**
 * Medial-axis pixels of features narrower than 2·rPx.
 *
 * A pixel is on the medial axis if its maximal inscribed disc is not
 * contained in a neighbor's disc. It is "thin" if that disc is smaller than
 * the target, unless it sits in a corner of a wide region: along a corner's
 * bisector the disc radius shrinks at ≥ 1/√2 per unit distance from the wide
 * core, whereas along a thin stroke it stays roughly constant.
 */
export function findThinRidges(mask: Uint8Array, w: number, h: number, rPx: number, tolPx: number): ThinRidges {
  const n = w * h;
  const distSq = squaredEDT(initEDT(mask, n, false), w, h);

  // Wide enough within the tolerance counts as wide: a stroke exactly at the
  // target must still have a core, or its corners would read as thin
  const coreSq = Math.min(rPx, rPx - tolPx + 0.5) ** 2;
  const core = new Uint8Array(n);
  let hasCore = false;
  for (let i = 0; i < n; i++) {
    if (mask[i] && distSq[i] >= coreSq) { core[i] = 1; hasCore = true; }
  }
  const coreDistSq = hasCore ? squaredEDT(initEDT(core, n, true), w, h) : null;

  const dist = new Float32Array(n);
  for (let i = 0; i < n; i++) if (mask[i]) dist[i] = Math.sqrt(distSq[i]);

  const indices: number[] = [];
  const widthsPx: number[] = [];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (!mask[i]) continue;
      const s = dist[i];
      // Edge lies ~half a pixel before the nearest background pixel center
      const halfWidth = s - 0.5;
      if (halfWidth >= rPx - tolPx) continue;

      let contained = false;
      for (const [dx, dy, dd] of NEIGHBORS) {
        if (dist[i + dy * w + dx] >= s + dd) { contained = true; break; }
      }
      if (contained) continue;

      if (coreDistSq) {
        const t = Math.sqrt(coreDistSq[i]);
        if (s + t * Math.SQRT1_2 <= rPx + CORNER_TOL_PX) continue;
      }

      indices.push(i);
      widthsPx.push(2 * halfWidth);
    }
  }
  return { indices, widthsPx };
}

/**
 * Width of the feature each ridge pixel belongs to: the widest ridge within
 * radiusPx. The medial axis forks into short, near-zero-width branches at
 * stroke ends and corners; this keeps those from being classified as a
 * separate, vanishing feature.
 */
function neighborhoodMaxWidth(ridges: ThinRidges, w: number, h: number, radiusPx: number): Float32Array {
  const widthAt = new Float32Array(w * h);
  for (let k = 0; k < ridges.indices.length; k++) widthAt[ridges.indices[k]] = ridges.widthsPx[k];

  const out = new Float32Array(w * h);
  const r = Math.ceil(radiusPx);
  const rSq = radiusPx * radiusPx;
  for (const i of ridges.indices) {
    const x = i % w, y = (i - x) / w;
    let best = 0;
    for (let dy = -r; dy <= r; dy++) {
      const yy = y + dy;
      if (yy < 0 || yy >= h) continue;
      for (let dx = -r; dx <= r; dx++) {
        const xx = x + dx;
        if (xx < 0 || xx >= w || dx * dx + dy * dy > rSq) continue;
        const v = widthAt[yy * w + xx];
        if (v > best) best = v;
      }
    }
    out[i] = best;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Edge growth
// ---------------------------------------------------------------------------

/** Squared pixel distance to the nearest of the given seed pixels (INF if none). */
function distSqToSeeds(seeds: number[], w: number, h: number): Float32Array {
  const n = w * h;
  const seedMask = new Uint8Array(n);
  for (const i of seeds) seedMask[i] = 1;
  return squaredEDT(initEDT(seedMask, n, true), w, h);
}

function minDistSq(a: Float32Array | null, b: Float32Array | null, n: number): Float32Array {
  if (!a) return b!;
  if (!b) return a;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.min(a[i], b[i]);
  return out;
}

function simplifyClosed(loop: Point[], tolerance: number): Point[] {
  return simplifyContour([...loop, loop[0]], tolerance).slice(0, -1);
}

function signedArea(p: Point[]): number {
  let a = 0;
  for (let i = p.length - 1, j = 0; j < p.length; i = j++) a += p[i].x * p[j].y - p[j].x * p[i].y;
  return a / 2;
}

/**
 * Closed iso-contours of `field` at 0 (inside where field > 0), in grid
 * coordinates. Assumes the outermost ring of the grid is outside.
 */
export function traceIsoContours(field: Float32Array, w: number, h: number): Point[][] {
  // Edge ids: horizontal edge from (x,y)→(x+1,y) = 2·(y·w+x); vertical (x,y)→(x,y+1) = 2·(y·w+x)+1
  const point = new Map<number, Point>();
  const links = new Map<number, number[]>();

  const edgePoint = (id: number): void => {
    if (point.has(id)) return;
    const base = id >> 1;
    const x = base % w, y = (base - x) / w;
    const a = field[base];
    const b = id & 1 ? field[base + w] : field[base + 1];
    const t = a / (a - b);
    point.set(id, id & 1 ? { x, y: y + t } : { x: x + t, y });
  };
  const link = (e1: number, e2: number) => {
    edgePoint(e1);
    edgePoint(e2);
    let l = links.get(e1); if (!l) { l = []; links.set(e1, l); } l.push(e2);
    l = links.get(e2); if (!l) { l = []; links.set(e2, l); } l.push(e1);
  };

  for (let y = 0; y < h - 1; y++) {
    for (let x = 0; x < w - 1; x++) {
      const i = y * w + x;
      const v0 = field[i], v1 = field[i + 1], v2 = field[i + w + 1], v3 = field[i + w];
      const c = (v0 > 0 ? 1 : 0) | (v1 > 0 ? 2 : 0) | (v2 > 0 ? 4 : 0) | (v3 > 0 ? 8 : 0);
      if (c === 0 || c === 15) continue;
      const bottom = 2 * i, left = 2 * i + 1, top = 2 * (i + w), right = 2 * (i + 1) + 1;
      switch (c) {
        case 1: case 14: link(left, bottom); break;
        case 2: case 13: link(bottom, right); break;
        case 3: case 12: link(left, right); break;
        case 4: case 11: link(right, top); break;
        case 6: case 9: link(bottom, top); break;
        case 7: case 8: link(left, top); break;
        case 5: case 10: {
          // Saddle: decide by the cell center value
          const centerInside = (v0 + v1 + v2 + v3) / 4 > 0;
          if ((c === 5) === centerInside) { link(left, top); link(bottom, right); }
          else { link(left, bottom); link(right, top); }
          break;
        }
      }
    }
  }

  const loops: Point[][] = [];
  const visited = new Set<number>();
  for (const start of links.keys()) {
    if (visited.has(start)) continue;
    const loop: Point[] = [];
    let prev = -1, cur = start;
    while (!visited.has(cur)) {
      visited.add(cur);
      loop.push(point.get(cur)!);
      const nbrs = links.get(cur)!;
      // In a saddle cell an edge has two links; take the one we didn't come from
      const next = nbrs[0] !== prev && !visited.has(nbrs[0]) ? nbrs[0]
        : nbrs.find((e) => e !== prev && !visited.has(e));
      if (next === undefined) break;
      prev = cur;
      cur = next;
    }
    if (loop.length >= 3) loops.push(loop);
  }
  return loops;
}

/** Polygons (mm) of the region where field > 0. */
function traceField(field: Float32Array, grid: Grid): Point[][] {
  const { w, h, res } = grid;
  return traceIsoContours(field, w, h)
    .map((loop) => simplifyClosed(loop.map((p) => ({ x: grid.x0 + p.x * res, y: grid.y0 + p.y * res })), res * 0.25))
    .filter((loop) => loop.length >= 3);
}

interface Edge { ax: number; ay: number; bx: number; by: number }

/** Uniform-grid bucket index of edges, for short ray and disc queries against the outline. */
class EdgeIndex {
  private cells = new Map<number, number[]>();
  private seen: Int32Array;
  private queryId = 0;

  constructor(private edges: Edge[], private cell: number) {
    this.seen = new Int32Array(edges.length);
    edges.forEach((e, k) => {
      const x1 = this.ix(Math.max(e.ax, e.bx)), y1 = this.ix(Math.max(e.ay, e.by));
      for (let y = this.ix(Math.min(e.ay, e.by)); y <= y1; y++) {
        for (let x = this.ix(Math.min(e.ax, e.bx)); x <= x1; x++) {
          const key = this.key(x, y);
          let list = this.cells.get(key);
          if (!list) { list = []; this.cells.set(key, list); }
          list.push(k);
        }
      }
    });
  }

  private ix(v: number): number { return Math.floor(v / this.cell); }
  private key(x: number, y: number): number { return (x + 32768) * 65536 + (y + 32768); }

  /** Calls fn for every edge (other than those in `skip`) whose cell overlaps the box, each once. Stops when fn returns false. */
  private each(x0: number, y0: number, x1: number, y1: number, skip: number | number[], fn: (e: Edge) => boolean): void {
    const skips = (k: number) => (typeof skip === "number" ? k === skip : skip.includes(k));
    const id = ++this.queryId;
    const cx1 = this.ix(x1), cy1 = this.ix(y1);
    for (let y = this.ix(y0); y <= cy1; y++) {
      for (let x = this.ix(x0); x <= cx1; x++) {
        const list = this.cells.get(this.key(x, y));
        if (!list) continue;
        for (const k of list) {
          if (this.seen[k] === id || skips(k)) continue;
          this.seen[k] = id;
          if (!fn(this.edges[k])) return;
        }
      }
    }
  }

  /** Distance from p to the nearest edge, or Infinity if none is within maxR. */
  nearestDist(px: number, py: number, maxR: number): number {
    let bestSq = maxR * maxR;
    this.each(px - maxR, py - maxR, px + maxR, py + maxR, -1, (e) => {
      const ex = e.bx - e.ax, ey = e.by - e.ay;
      const lenSq = ex * ex + ey * ey;
      const u = lenSq > 0 ? Math.min(1, Math.max(0, ((px - e.ax) * ex + (py - e.ay) * ey) / lenSq)) : 0;
      const ox = e.ax + ex * u - px, oy = e.ay + ey * u - py;
      bestSq = Math.min(bestSq, ox * ox + oy * oy);
      return true;
    });
    return bestSq < maxR * maxR ? Math.sqrt(bestSq) : Infinity;
  }

  /** Whether any edge passes within eps of p. */
  near(px: number, py: number, eps: number): boolean {
    let found = false;
    const epsSq = eps * eps;
    this.each(px - eps, py - eps, px + eps, py + eps, -1, (e) => {
      const ex = e.bx - e.ax, ey = e.by - e.ay;
      const lenSq = ex * ex + ey * ey;
      const u = lenSq > 0 ? Math.min(1, Math.max(0, ((px - e.ax) * ex + (py - e.ay) * ey) / lenSq)) : 0;
      const ox = e.ax + ex * u - px, oy = e.ay + ey * u - py;
      found = ox * ox + oy * oy <= epsSq;
      return !found;
    });
    return found;
  }

  /** Distance from p along unit direction d to the nearest edge crossing (other than `skip`), or Infinity beyond maxT. */
  cast(px: number, py: number, dx: number, dy: number, maxT: number, skip: number): number {
    const qx = px + dx * maxT, qy = py + dy * maxT;
    let best = Infinity;
    this.each(Math.min(px, qx), Math.min(py, qy), Math.max(px, qx), Math.max(py, qy), skip, (e) => {
      const ex = e.bx - e.ax, ey = e.by - e.ay;
      const denom = dx * ey - dy * ex;
      if (Math.abs(denom) < 1e-12) return true;
      const wx = e.ax - px, wy = e.ay - py;
      const t = (wx * ey - wy * ex) / denom;
      const u = (wx * dy - wy * dx) / denom;
      if (t > 1e-9 && t < best && u >= 0 && u <= 1) best = t;
      return true;
    });
    return best <= maxT ? best : Infinity;
  }

  /**
   * Radius of the largest disc that touches the outline at p, centered along
   * unit direction d, and crosses no edge other than those in `skip` (capped at maxR).
   */
  discRadius(px: number, py: number, dx: number, dy: number, maxR: number, skip: number | number[]): number {
    // The disc centered at p + d·t with radius t grows until it first touches
    // an edge, either along the edge's line or at one of its endpoints.
    let best = maxR;
    const touchPoint = (qx: number, qy: number) => {
      const wx = px - qx, wy = py - qy;
      const wd = wx * dx + wy * dy;
      if (wd >= 0) return; // the disc grows away from it
      const t = -(wx * wx + wy * wy) / (2 * wd);
      if (t > 1e-9 && t < best) best = t;
    };
    this.each(px - 2 * maxR, py - 2 * maxR, px + 2 * maxR, py + 2 * maxR, skip, (e) => {
      const ex = e.bx - e.ax, ey = e.by - e.ay;
      const len = Math.hypot(ex, ey);
      if (len > 0) {
        const mx = -ey / len, my = ex / len;
        const f0 = (px - e.ax) * mx + (py - e.ay) * my, dm = dx * mx + dy * my;
        // Signed distance from the center to the line is f0 + t·dm; it touches when that is ±t
        for (const t of [f0 / (1 - dm), -f0 / (1 + dm)]) {
          if (!(t > 1e-9 && t < best)) continue;
          const cx = px + dx * t, cy = py + dy * t;
          const u = ((cx - e.ax) * ex + (cy - e.ay) * ey) / (len * len);
          if (u >= 0 && u <= 1) best = t;
        }
      }
      touchPoint(e.ax, e.ay);
      touchPoint(e.bx, e.by);
      return true;
    });
    return best;
  }
}

/** Stroke widths (px) at medial-axis pixels; looked up to size the growth of the outline they belong to. */
interface RidgeWidths {
  grid: Grid;
  widthPx: Float32Array; // 0 off the ridge
}

/** Widest ridge within snapPx of a point (mm), in mm, or 0 if there is none. */
function ridgeWidthNear(ridges: RidgeWidths, x: number, y: number, snapPx: number): number {
  const { grid, widthPx } = ridges;
  const gx = Math.round((x - grid.x0) / grid.res), gy = Math.round((y - grid.y0) / grid.res);
  let best = 0;
  for (let dy = -snapPx; dy <= snapPx; dy++) {
    const yy = gy + dy;
    if (yy < 0 || yy >= grid.h) continue;
    for (let dx = -snapPx; dx <= snapPx; dx++) {
      const xx = gx + dx;
      if (xx < 0 || xx >= grid.w) continue;
      const v = widthPx[yy * grid.w + xx];
      if (v > best) best = v;
    }
  }
  return best * grid.res;
}

/**
 * Fills runs of ungrown samples (at most maxRun long) between grown ones on
 * the same straight edge by interpolating, so the edge stays one straight
 * line — e.g. a serif's base, which is only thin either side of the stem.
 */
function bridgeGaps(grow: Float64Array, maxRun: number): void {
  let last = -1;
  for (let i = 0; i < grow.length; i++) {
    if (grow[i] <= MIN_GROWTH) continue;
    if (last >= 0 && i - last > 1 && i - last - 1 <= maxRun) {
      for (let j = last + 1; j < i; j++) grow[j] = grow[last] + ((grow[i] - grow[last]) * (j - last)) / (i - last);
    }
    last = i;
  }
}

/** Width (mm) of the first thin ridge met walking from p along d, up to the disc's center; 0 if none. */
function firstRidgeInward(ridges: RidgeWidths, px: number, py: number, dx: number, dy: number, disc: number): number {
  const res = ridges.grid.res;
  for (let t = 0; ; t = Math.min(disc, t + res)) {
    const width = ridgeWidthNear(ridges, px + dx * t, py + dy * t, 1);
    if (width > 0) return width;
    if (t >= disc) return ridgeWidthNear(ridges, px + dx * disc, py + dy * disc, RIDGE_SNAP_PX);
  }
}

/**
 * Loops that push the edges of too-thin strokes straight outward until each
 * stroke is targetWidth across. Edges keep their shape, so straight sides
 * stay straight and stroke ends keep their outline.
 *
 * How much an edge point grows depends on the stroke it belongs to:
 *  - Long straight edges (at least as long as the stroke is wide) measure
 *    the material straight across along their normal. That is the stroke
 *    width for a side, but long for a flat stroke end, so ends stay square
 *    and don't get longer.
 *  - Short edges (curves) take the width of the medial ridge their
 *    inscribed disc is centered on. Round caps grow into round caps of the
 *    target width, and outline points near a corner grow like the rest of
 *    their stroke instead of bulging.
 * Edge points that aren't near a thin ridge never grow, so wide regions —
 * including their sharp corners, which print fine — keep their exact edges.
 */
function edgeGrowthLoops(
  shapes: ShapeData[], targetWidth: number, grid: Grid, ridgePixels: number[], nearRidge: (x: number, y: number) => boolean,
): Point[][] {
  const step = grid.res;
  const rings: { pts: Point[]; sign: number }[] = [];
  for (const s of shapes) {
    rings.push({ pts: s.outer, sign: signedArea(s.outer) > 0 ? 1 : -1 });
    for (const hl of s.holes) rings.push({ pts: hl, sign: signedArea(hl) > 0 ? -1 : 1 });
  }
  const edges: Edge[] = [];
  for (const { pts } of rings) {
    for (let k = 0; k < pts.length; k++) {
      const a = pts[k], b = pts[(k + 1) % pts.length];
      edges.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y });
    }
  }
  const index = new EdgeIndex(edges, targetWidth);
  const half = targetWidth / 2;
  const loops: Point[][] = [];

  // The raster only says where the ridge is; its width comes from the outline
  // itself (raster widths are off by up to ~2 px). Each pixel then takes the
  // widest ridge around it, so short branches into corners report the stroke.
  const exact: ThinRidges = { indices: ridgePixels, widthsPx: ridgePixels.map((i) => {
    const gx = i % grid.w, gy = (i - gx) / grid.w;
    const d = index.nearestDist(grid.x0 + gx * grid.res, grid.y0 + gy * grid.res, targetWidth);
    return d === Infinity ? 0 : (2 * d) / grid.res;
  }) };
  const ridges: RidgeWidths = { grid, widthPx: neighborhoodMaxWidth(exact, grid.w, grid.h, half / grid.res) };

  // Sides converging faster than a taper form a sharp tip: pushing them out
  // only moves the tip, so it's left to the rounding pass. Both the width
  // across and the inscribed disc shrink there — unlike a round cap (disc
  // constant) or the outer corner of a bend (width across constant).
  const isTipAt = (a: Point, dx: number, dy: number, len: number, t: number, nxk: number, nyk: number, edgeId: number) => {
    const t0 = Math.max(0, t - step / 2 / len), t1 = Math.min(1, t + step / 2 / len);
    const span = (t1 - t0) * len;
    if (span < 1e-6) return false;
    const ax = a.x + dx * t0, ay = a.y + dy * t0, bx = a.x + dx * t1, by = a.y + dy * t1;
    const c0 = index.cast(ax, ay, -nxk, -nyk, targetWidth, edgeId), c1 = index.cast(bx, by, -nxk, -nyk, targetWidth, edgeId);
    if (!Number.isFinite(c0) || !Number.isFinite(c1) || Math.abs(c1 - c0) <= TIP_SLOPE * span) return false;
    // A tip narrows steadily; a jump in width (the far side changing at a junction) is not one
    const tm = (t0 + t1) / 2;
    const cm = index.cast(a.x + dx * tm, a.y + dy * tm, -nxk, -nyk, targetWidth, edgeId);
    if (!Number.isFinite(cm) || Math.abs(cm - (c0 + c1) / 2) > 0.25 * Math.abs(c1 - c0)) return false;
    const d0 = index.discRadius(ax, ay, -nxk, -nyk, half, edgeId), d1 = index.discRadius(bx, by, -nxk, -nyk, half, edgeId);
    return Math.abs(d1 - d0) > TIP_DISC_SLOPE * span;
  };

  let edgeBase = 0;
  for (const { pts, sign } of rings) {
    const n = pts.length;
    // Per edge: outward normal (away from the material) and growth at both ends
    const nx = new Float64Array(n), ny = new Float64Array(n);
    const startGrow = new Float64Array(n), endGrow = new Float64Array(n);
    const pushedEdge: (Point[] | null)[] = new Array(n).fill(null);
    for (let k = 0; k < n; k++) {
      const a = pts[k], b = pts[(k + 1) % n];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len < 1e-9) continue;
      nx[k] = (sign * (b.y - a.y)) / len;
      ny[k] = (-sign * (b.x - a.x)) / len;
    }
    // Vertex k (between edges k−1 and k) is convex when edge k turns away from edge k−1's normal
    const convex = (k: number) => {
      const prev = (k + n - 1) % n, v = pts[k], next = pts[(k + 1) % n];
      return nx[prev] * (next.x - v.x) + ny[prev] * (next.y - v.y) < 0;
    };
    for (let k = 0; k < n; k++) {
      const a = pts[k], b = pts[(k + 1) % n];
      const dx = b.x - a.x, dy = b.y - a.y;
      const len = Math.hypot(dx, dy);
      if (len < 1e-9) continue;
      const edgeId = edgeBase + k;
      // Near a convex corner the disc would be cut off by the edge round the
      // corner and measure the corner instead of the stroke, so those
      // neighbours don't count. (At a sharp tip the disc then doesn't shrink
      // either, which leaves tips to the rounding pass.)
      const skip = [edgeId];
      if (convex(k)) skip.push(edgeBase + (k + n - 1) % n);
      if (convex((k + 1) % n)) skip.push(edgeBase + (k + 1) % n);

      const inward = (x: number, y: number) => index.discRadius(x, y, -nx[k], -ny[k], half, skip);
      const across = (x: number, y: number) => index.cast(x, y, -nx[k], -ny[k], targetWidth, edgeId);
      // A flat stroke end spans the stroke's width and faces along the stroke
      const midDisc = index.discRadius(a.x + dx / 2, a.y + dy / 2, -nx[k], -ny[k], half, edgeId);
      const flatEnd = len >= 2 * midDisc * FLAT_END_MIN && len <= 2 * midDisc * FLAT_END_MAX
        && across(a.x + dx / 2, a.y + dy / 2) === Infinity;

      const m = Math.max(1, Math.ceil(len / step));
      const grow = new Float64Array(m);
      let any = false;
      for (let i = 0; i < m && !flatEnd; i++) {
        const t = (i + 0.5) / m;
        const px = a.x + dx * t, py = a.y + dy * t;
        if (!nearRidge(px, py)) continue;
        const disc = inward(px, py);
        // The disc is exact, but near a junction it reaches into the junction;
        // the stroke's own ridge, first met walking inward, knows its width.
        // Where the ridge is dropped altogether (the junction counts as wide),
        // the width straight across still measures the stroke.
        const ridge = firstRidgeInward(ridges, px, py, -nx[k], -ny[k], disc);
        const width = ridge === 0 ? across(px, py)
          : ridge < 2 * disc - JUNCTION_WIDTH_GAP_PX * ridges.grid.res ? ridge : 2 * disc;
        if (width >= targetWidth) continue;
        if (len >= TIP_MIN_EDGE_STEPS * step && isTipAt(a, dx, dy, len, t, nx[k], ny[k], edgeId)) continue;
        grow[i] = half - width / 2;
        if (grow[i] > MIN_GROWTH) any = true;
      }
      if (any) bridgeGaps(grow, Math.floor((BRIDGE_TARGETS * targetWidth) / (len / m)));
      startGrow[k] = grow[0];
      endGrow[k] = grow[m - 1];
      if (!any) continue;

      // The pushed edge: its two corners and every sample, moved out along the normal
      const out: Point[] = [{ x: a.x + nx[k] * grow[0], y: a.y + ny[k] * grow[0] }];
      for (let i = 0; i < m; i++) {
        const t = (i + 0.5) / m;
        out.push({ x: a.x + dx * t + nx[k] * grow[i], y: a.y + dy * t + ny[k] * grow[i] });
      }
      out.push({ x: b.x + nx[k] * grow[m - 1], y: b.y + ny[k] * grow[m - 1] });
      pushedEdge[k] = out;
    }

    // Outward corner between the pushed edges k−1 and k at vertex k: the miter
    // point, or none (a bevel) when the miter would spike
    const miterAt = (k: number): Point | null => {
      const prev = (k + n - 1) % n, v = pts[k];
      const g0 = endGrow[prev], g1 = startGrow[k];
      const det = nx[prev] * ny[k] - ny[prev] * nx[k];
      if (Math.abs(det) <= 1e-9) return null;
      const mx = (g0 * ny[k] - g1 * ny[prev]) / det, my = (g1 * nx[prev] - g0 * nx[k]) / det;
      return Math.hypot(mx, my) <= MITER_LIMIT * Math.max(g0, g1) ? { x: v.x + mx, y: v.y + my } : null;
    };
    // Joins at vertices where a run of pushed edges starts or ends (or a run
    // wraps the whole ring), as separate triangles: one quad could twist into
    // a bow-tie whose reversed lobe would cancel the strip next to it
    const join = (k: number) => {
      const prev = (k + n - 1) % n, v = pts[k];
      if ((endGrow[prev] <= MIN_GROWTH && startGrow[k] <= MIN_GROWTH) || !convex(k)) return;
      const p0 = { x: v.x + nx[prev] * endGrow[prev], y: v.y + ny[prev] * endGrow[prev] };
      const p1 = { x: v.x + nx[k] * startGrow[k], y: v.y + ny[k] * startGrow[k] };
      const miter = miterAt(k);
      const tris = miter ? [[v, p0, miter], [v, miter, p1]] : [[v, p0, p1]];
      for (const tri of tris) loops.push(signedArea(tri) < 0 ? tri.reverse() : tri);
    };

    // Each run of consecutive pushed edges becomes one band: the ring along
    // the run, then back along the pushed edges with the corners between them
    // (miter at outward corners, the ring vertex itself at inward ones).
    // Far fewer, larger polygons keep the final union fast.
    const pushedCount = pushedEdge.filter(Boolean).length;
    if (pushedCount > 0) {
      let start = 0;
      if (pushedCount < n) {
        while (!pushedEdge[start]) start++;
        while (pushedEdge[(start + n - 1) % n]) start = (start + n - 1) % n; // back up to the run's first edge
      }
      for (let i = 0; i < n; ) {
        const k0 = (start + i) % n;
        if (!pushedEdge[k0]) { i++; continue; }
        let len = 0;
        while (i + len < n && pushedEdge[(start + i + len) % n]) len++;
        const band: Point[] = [];
        for (let j = 0; j <= len; j++) band.push(pts[(k0 + j) % n]);
        for (let j = len - 1; j >= 0; j--) {
          const k = (k0 + j) % n;
          band.push(...pushedEdge[k]!.slice().reverse());
          if (j > 0) {
            if (convex(k)) {
              const miter = miterAt(k);
              if (miter) band.push(miter);
            } else {
              band.push(pts[k]);
            }
          }
        }
        // Samples along straight or gently curved stretches are redundant once
        // pushed; inward corners can make the band cross itself, resolved per band
        const thinned = simplifyClosed(band, INPUT_SIMPLIFY_MM);
        const simple = ClipperLib.Clipper.SimplifyPolygon(toClipperPath(thinned), ClipperLib.PolyFillType.pftNonZero);
        for (const path of simple) loops.push(fromClipperPath(path));
        join(k0);
        join((k0 + len) % n);
        i += len;
      }
    }
    edgeBase += n;
  }
  return loops;
}

/**
 * The parts of the disc-grown region (`discLoops`, traced contours) that fill
 * notches in the edge-pushed shapes, as nested contours (inner loops are holes).
 *
 * Pushing edges leaves wedge-shaped notches where strokes meet at a junction;
 * growing discs around the ridges fills those, but also rounds stroke ends
 * and bulges out where a stroke is barely thin. Every piece the discs add
 * beyond the pushed shapes is one or the other: a notch filler is tucked in
 * between pushed edges, so most of its outline lies on them, while a bulge
 * sits on the outside and shares only its base. Only notch fillers are kept.
 */
function junctionFill(pushed: ShapeData[], discLoops: Point[][], targetWidth: number): Point[][] {
  const pushedPaths: ClipperLib.Paths = [];
  const edges: Edge[] = [];
  for (const s of pushed) {
    for (const ring of [s.outer, ...s.holes]) {
      if (ring.length < 3) continue;
      pushedPaths.push(toClipperPath(ring));
      for (let k = 0; k < ring.length; k++) {
        const a = ring[k], b = ring[(k + 1) % ring.length];
        edges.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y });
      }
    }
  }
  const c = new ClipperLib.Clipper();
  c.AddPaths(normalizeEvenOdd(discLoops.map(toClipperPath)), ClipperLib.PolyType.ptSubject, true);
  c.AddPaths(pushedPaths, ClipperLib.PolyType.ptClip, true);
  const tree = executeToTree(c, ClipperLib.ClipType.ctDifference, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftEvenOdd);
  const pieces: ShapeData[] = [];
  polyTreeToShapes(tree, pieces);

  const index = new EdgeIndex(edges, targetWidth);
  const fill: Point[][] = [];
  for (const piece of pieces) {
    let shared = 0, total = 0;
    for (const ring of [piece.outer, ...piece.holes]) {
      for (let k = 0; k < ring.length; k++) {
        const a = ring[k], b = ring[(k + 1) % ring.length];
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        total += len;
        if (index.near((a.x + b.x) / 2, (a.y + b.y) / 2, ON_EDGE_MM)) shared += len;
      }
    }
    if (total > 0 && shared / total >= NOTCH_SHARED_MIN) fill.push(piece.outer, ...piece.holes);
  }
  return fill;
}

/** Background pixels filled by a morphological closing with the given radius. */
export function closingFill(mask: Uint8Array, w: number, h: number, radiusPx: number): Uint8Array {
  const n = w * h;
  const rSq = radiusPx * radiusPx;
  const distToFg = squaredEDT(initEDT(mask, n, true), w, h);
  const dilated = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (distToFg[i] <= rSq) dilated[i] = 1;
  const distToOutside = squaredEDT(initEDT(dilated, n, false), w, h);
  const fill = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (!mask[i] && distToOutside[i] > rSq) fill[i] = 1;
  return fill;
}

function normalizeEvenOdd(paths: ClipperLib.Paths): ClipperLib.Paths {
  const c = new ClipperLib.Clipper();
  c.AddPaths(paths, ClipperLib.PolyType.ptSubject, true);
  const out: ClipperLib.Paths = [];
  c.Execute(ClipperLib.ClipType.ctUnion, out, ClipperLib.PolyFillType.pftEvenOdd, ClipperLib.PolyFillType.pftEvenOdd);
  return out;
}

/**
 * Runs the clip into a PolyTree. Clipper fixes up the tree's nesting every
 * time it splits an output polygon, testing every other output ring with a
 * full point-in-polygon walk. Pushed edges lying on the original outline
 * split off hundreds of rounding slivers, which took minutes (a 0.8 mm nozzle
 * on a line-art tree). So clip to flat paths, drop the slivers, and nest the
 * rest in a second, cheap union.
 */
function executeToTree(c: ClipperLib.Clipper, clipType: number, subjFill: number, clipFill: number): ClipperLib.PolyTree {
  const flat: ClipperLib.Paths = [];
  c.Execute(clipType, flat, subjFill, clipFill);
  const nest = new ClipperLib.Clipper();
  nest.AddPaths(flat.filter((p) => Math.abs(ClipperLib.Clipper.Area(p)) >= MIN_AREA_SQ), ClipperLib.PolyType.ptSubject, true);
  const tree = new ClipperLib.PolyTree();
  nest.Execute(ClipperLib.ClipType.ctUnion, tree, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
  return tree;
}

function polyTreeToShapes(node: ClipperLib.PolyNode, out: ShapeData[]): void {
  for (const outerNode of node.Childs()) {
    const outerPath = outerNode.Contour();
    if (Math.abs(ClipperLib.Clipper.Area(outerPath)) < MIN_AREA_SQ) continue;
    const holes: Point[][] = [];
    for (const holeNode of outerNode.Childs()) {
      const holePath = holeNode.Contour();
      if (Math.abs(ClipperLib.Clipper.Area(holePath)) >= MIN_AREA_SQ) holes.push(fromClipperPath(holePath));
      polyTreeToShapes(holeNode, out); // islands inside the hole
    }
    out.push({ outer: fromClipperPath(outerPath), holes });
  }
}

/**
 * Union of the shapes and the added loops. How the loops are read:
 *  - "solid": each loop counts as solid, whatever its direction; loops may overlap.
 *  - "nested": traced contours whose inner loops are holes.
 *  - "oriented": simple loops whose direction already says outer (counter-clockwise) or hole.
 */
function unionWith(shapes: ShapeData[], loops: Point[][], mode: "solid" | "nested" | "oriented" = "solid"): ShapeData[] {
  const subject: ClipperLib.Paths = [];
  for (const s of shapes) {
    if (s.outer.length < 3) continue;
    subject.push(...normalizeEvenOdd([s.outer, ...s.holes].filter((c) => c.length >= 3).map(toClipperPath)));
  }
  if (mode === "nested") {
    subject.push(...normalizeEvenOdd(loops.map(toClipperPath)));
  } else {
    for (const loop of loops) {
      const path = toClipperPath(loop);
      if (mode === "solid" && ClipperLib.Clipper.Area(path) < 0) path.reverse();
      subject.push(path);
    }
  }

  const c = new ClipperLib.Clipper();
  c.AddPaths(subject, ClipperLib.PolyType.ptSubject, true);
  const tree = executeToTree(c, ClipperLib.ClipType.ctUnion, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);

  const out: ShapeData[] = [];
  polyTreeToShapes(tree, out);
  return out;
}

// ---------------------------------------------------------------------------
// Overlay
// ---------------------------------------------------------------------------

interface OverlayLayer {
  distSq: Float32Array;
  color: number[];
}

function buildOverlay(
  grid: Grid, layers: OverlayLayer[], rPx: number, stampWidth: number, stampHeight: number,
): { pixels: Uint8Array; gridW: number; gridH: number } {
  const outW = Math.ceil(stampWidth / OVERLAY_RESOLUTION) + 1;
  const outH = Math.ceil(stampHeight / OVERLAY_RESOLUTION) + 1;
  const pixels = new Uint8Array(outW * outH * 4);
  if (layers.length === 0) return { pixels, gridW: outW, gridH: outH };

  const rSq = rPx * rPx;
  for (let oy = 0; oy < outH; oy++) {
    const gy = Math.round((oy * OVERLAY_RESOLUTION - grid.y0) / grid.res);
    if (gy < 0 || gy >= grid.h) continue;
    for (let ox = 0; ox < outW; ox++) {
      const gx = Math.round((ox * OVERLAY_RESOLUTION - grid.x0) / grid.res);
      if (gx < 0 || gx >= grid.w) continue;
      const gi = gy * grid.w + gx;
      // First matching layer wins
      for (const layer of layers) {
        if (layer.distSq[gi] <= rSq) {
          const o = (oy * outW + ox) * 4;
          pixels[o] = layer.color[0];
          pixels[o + 1] = layer.color[1];
          pixels[o + 2] = layer.color[2];
          pixels[o + 3] = 255;
          break;
        }
      }
    }
  }
  return { pixels, gridW: outW, gridH: outH };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function medialThicken(
  shapes: ShapeData[],
  stampWidth: number,
  stampHeight: number,
  options: MedialThickenOptions,
): MedialThickenResult {
  const { targetWidth, minFeatureSize, thicken, onProgress } = options;
  const progress = onProgress ?? (() => {});

  const emptyOverlay = (): FeatureOverlay => ({
    ...buildOverlay({ x0: 0, y0: 0, res: 1, w: 0, h: 0 }, [], 0, stampWidth, stampHeight),
    widened: false, rescued: false, residual: false, targetWidth, minFeatureSize,
  });

  const grid = makeGrid(shapes, targetWidth);
  if (!grid || targetWidth <= 0) return { shapes, modified: false, overlay: emptyOverlay() };
  const { w, h, res } = grid;
  const rPx = targetWidth / 2 / res;

  progress(0.05, "Rasterizing…");
  const mask = rasterizeShapes(shapes, grid);

  progress(0.15, "Finding thin features…");
  const ridges = findThinRidges(mask, w, h, rPx, THIN_TOL_PX);
  if (ridges.indices.length === 0) return { shapes, modified: false, overlay: emptyOverlay() };

  const minFeaturePx = minFeatureSize / res;
  const featureWidth = neighborhoodMaxWidth(ridges, w, h, rPx);
  const rescuedSeeds: number[] = [];
  const widenedSeeds: number[] = [];
  for (const i of ridges.indices) {
    (featureWidth[i] < minFeaturePx ? rescuedSeeds : widenedSeeds).push(i);
  }

  progress(0.35, "Classifying features…");
  const rescuedDist = rescuedSeeds.length > 0 ? distSqToSeeds(rescuedSeeds, w, h) : null;
  const widenedDist = widenedSeeds.length > 0 ? distSqToSeeds(widenedSeeds, w, h) : null;
  const layers: OverlayLayer[] = [];
  if (rescuedDist) layers.push({ distSq: rescuedDist, color: RESCUED_COLOR });
  if (widenedDist) layers.push({ distSq: widenedDist, color: WIDENED_COLOR });

  const classified = {
    widened: widenedSeeds.length > 0,
    rescued: rescuedSeeds.length > 0,
  };

  if (!thicken) {
    return {
      shapes,
      modified: false,
      overlay: { ...buildOverlay(grid, layers, rPx, stampWidth, stampHeight), ...classified, residual: false, targetWidth, minFeatureSize },
    };
  }

  // Push the edges of thin strokes outward, merge, and re-check. Strokes that
  // grow into each other can leave thin necks where they barely touch, and
  // tips sharper than a printable corner stay thin; later passes round those
  // off with a disc of the target width. Gaps narrower than the min feature
  // size are closed by the slicer, so the check treats them as filled —
  // otherwise the material between two hairline slits would look like a thin web.
  const gapPx = minFeatureSize / 2 / res;
  const n = w * h;
  // Curve outlines (e.g. glyphs) arrive far denser than needed; thinning them
  // keeps the Clipper unions fast without visibly moving any edge. The union
  // up front keeps overlapping sources from measuring as thin crossings.
  let merged = unionWith(shapes
    .filter((s) => s.outer.length >= 3)
    .map((s) => ({
      outer: simplifyClosed(s.outer, INPUT_SIMPLIFY_MM),
      holes: s.holes.filter((hl) => hl.length >= 3).map((hl) => simplifyClosed(hl, INPUT_SIMPLIFY_MM)),
    })), []);
  let residualIndices: number[] = [];
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const passProgress = 0.45 + (0.45 * pass) / MAX_PASSES;
    if (pass === 0) {
      progress(passProgress, "Growing thin features…");
      const seedDist = minDistSq(rescuedDist, widenedDist, n);
      const nearSeedSq = (rPx * GROW_REACH) ** 2;
      const nearRidge = (x: number, y: number) => {
        const gx = Math.round((x - grid.x0) / res), gy = Math.round((y - grid.y0) / res);
        return gx >= 0 && gy >= 0 && gx < w && gy < h && seedDist[gy * w + gx] <= nearSeedSq;
      };
      const pushed = unionWith(merged, edgeGrowthLoops(merged, targetWidth, grid, ridges.indices, nearRidge), "oriented");
      // Discs around a ridge pixel band trace out ~1.5 px wider than the
      // target; trimmed so they only stand out where the pushed edges fall short.
      const field = new Float32Array(n);
      for (let i = 0; i < n; i++) field[i] = rPx - DISC_BIAS_PX - Math.sqrt(seedDist[i]);
      merged = unionWith(pushed, junctionFill(pushed, traceField(field, grid), targetWidth), "nested");
    } else {
      progress(passProgress, "Filling necks…");
      const seedDist = distSqToSeeds(residualIndices, w, h);
      const field = new Float32Array(n);
      for (let i = 0; i < n; i++) field[i] = rPx - Math.sqrt(seedDist[i]);
      merged = unionWith(merged, traceField(field, grid), "nested");
    }

    progress(passProgress + 0.25 / MAX_PASSES, "Verifying result…");
    const verifyMask = rasterizeShapes(merged, grid);
    if (gapPx > 0) {
      const gaps = closingFill(verifyMask, w, h, gapPx);
      for (let i = 0; i < n; i++) if (gaps[i]) verifyMask[i] = 1;
    }
    residualIndices = findThinRidges(verifyMask, w, h, rPx, VERIFY_TOL_PX).indices;
    if (residualIndices.length === 0) break;
  }

  const residual = residualIndices.length >= RESIDUAL_MIN_PIXELS;
  if (residual) {
    layers.unshift({ distSq: distSqToSeeds(residualIndices, w, h), color: RESIDUAL_COLOR });
  }

  progress(0.95, "Building overlay…");
  return {
    shapes: merged,
    modified: true,
    overlay: { ...buildOverlay(grid, layers, rPx, stampWidth, stampHeight), ...classified, residual, targetWidth, minFeatureSize },
  };
}
