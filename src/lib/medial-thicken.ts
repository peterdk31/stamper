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
 *   3. Grow a disc of radius targetWidth/2 around every thin ridge pixel,
 *      so each thin stroke becomes exactly target-wide wherever it is thin.
 *   4. Trace the grown region back to polygons and union it with the
 *      original vector outline, which keeps all untouched edges exact.
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

  const rSq = rPx * rPx;
  const core = new Uint8Array(n);
  let hasCore = false;
  for (let i = 0; i < n; i++) {
    if (mask[i] && distSq[i] >= rSq) { core[i] = 1; hasCore = true; }
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
// Grown region → polygons
// ---------------------------------------------------------------------------

/** Squared pixel distance to the nearest of the given seed pixels (INF if none). */
function distSqToSeeds(seeds: number[], w: number, h: number): Float32Array {
  const n = w * h;
  const seedMask = new Uint8Array(n);
  for (const i of seeds) seedMask[i] = 1;
  return squaredEDT(initEDT(seedMask, n, true), w, h);
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

/** Polygons (mm) of the region where field > 0. */
function traceField(field: Float32Array, grid: Grid): Point[][] {
  const { w, h, res } = grid;
  return traceIsoContours(field, w, h)
    .map((loop) => simplifyClosed(loop.map((p) => ({ x: grid.x0 + p.x * res, y: grid.y0 + p.y * res })), res * 0.25))
    .filter((loop) => loop.length >= 3);
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

/** Union of the shapes and the added loops. */
function unionWith(shapes: ShapeData[], loops: Point[][]): ShapeData[] {
  const subject: ClipperLib.Paths = [];
  for (const s of shapes) {
    if (s.outer.length < 3) continue;
    subject.push(...normalizeEvenOdd([s.outer, ...s.holes].filter((c) => c.length >= 3).map(toClipperPath)));
  }
  subject.push(...normalizeEvenOdd(loops.map(toClipperPath)));

  const c = new ClipperLib.Clipper();
  c.AddPaths(subject, ClipperLib.PolyType.ptSubject, true);
  const tree = new ClipperLib.PolyTree();
  c.Execute(ClipperLib.ClipType.ctUnion, tree, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);

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

  // Grow discs around the thin ridges, merge, and re-check. Strokes that grow
  // into each other can leave thin necks where they barely touch; later
  // passes grow those the same way. Gaps narrower than the min feature size
  // are closed by the slicer, so the check treats them as filled — otherwise
  // the material between two hairline slits would look like a thin web.
  const gapPx = minFeatureSize / 2 / res;
  const n = w * h;
  // Curve outlines (e.g. glyphs) arrive far denser than needed; thinning them
  // keeps the Clipper unions fast without visibly moving any edge.
  let merged = shapes
    .filter((s) => s.outer.length >= 3)
    .map((s) => ({
      outer: simplifyClosed(s.outer, INPUT_SIMPLIFY_MM),
      holes: s.holes.filter((hl) => hl.length >= 3).map((hl) => simplifyClosed(hl, INPUT_SIMPLIFY_MM)),
    }));
  let growDistSq = minDistSq(rescuedDist, widenedDist, n);
  let residualIndices: number[] = [];
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const passProgress = 0.45 + (0.45 * pass) / MAX_PASSES;
    progress(passProgress, pass === 0 ? "Growing thin features…" : "Filling necks…");
    const field = new Float32Array(n);
    for (let i = 0; i < n; i++) field[i] = rPx - Math.sqrt(growDistSq[i]);
    merged = unionWith(merged, traceField(field, grid));

    progress(passProgress + 0.25 / MAX_PASSES, "Verifying result…");
    const verifyMask = rasterizeShapes(merged, grid);
    if (gapPx > 0) {
      const gaps = closingFill(verifyMask, w, h, gapPx);
      for (let i = 0; i < n; i++) if (gaps[i]) verifyMask[i] = 1;
    }
    residualIndices = findThinRidges(verifyMask, w, h, rPx, VERIFY_TOL_PX).indices;
    if (residualIndices.length === 0) break;
    growDistSq = distSqToSeeds(residualIndices, w, h);
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
