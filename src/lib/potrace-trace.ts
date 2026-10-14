import { hasSelfIntersection } from "./contour-utils";
import { fitCurves } from "./curve-fit";

interface Point {
  x: number;
  y: number;
}

export interface ShapeData {
  outer: Point[];
  holes: Point[][];
}

export type ProgressFn = (progress: number, stage: string) => void;

function signedArea(contour: Point[]): number {
  let area = 0;
  for (let i = 0, j = contour.length - 1; i < contour.length; j = i++) {
    area += (contour[j].x - contour[i].x) * (contour[j].y + contour[i].y);
  }
  return area / 2;
}

function pointInContour(px: number, py: number, contour: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = contour.length - 1; i < contour.length; j = i++) {
    const yi = contour[i].y, yj = contour[j].y;
    if (
      (yi > py) !== (yj > py) &&
      px < ((contour[j].x - contour[i].x) * (py - yi)) / (yj - yi) + contour[i].x
    ) {
      inside = !inside;
    }
  }
  return inside;
}

function nestContours(contours: Point[][]): ShapeData[] {
  if (contours.length === 0) return [];

  const indexed = contours.map((c) => ({ contour: c, absArea: Math.abs(signedArea(c)) }));
  indexed.sort((a, b) => b.absArea - a.absArea);

  const depth = new Array<number>(indexed.length).fill(0);
  const parent = new Array<number>(indexed.length).fill(-1);

  for (let i = 1; i < indexed.length; i++) {
    const p = indexed[i].contour[0];
    for (let j = i - 1; j >= 0; j--) {
      if (pointInContour(p.x, p.y, indexed[j].contour)) {
        parent[i] = j;
        depth[i] = depth[j] + 1;
        break;
      }
    }
  }

  const shapes: ShapeData[] = [];
  const shapeByIndex = new Map<number, ShapeData>();

  for (let i = 0; i < indexed.length; i++) {
    const pts = indexed[i].contour;
    if (depth[i] % 2 === 0) {
      const shape: ShapeData = { outer: pts, holes: [] };
      shapes.push(shape);
      shapeByIndex.set(i, shape);
    } else {
      const parentShape = shapeByIndex.get(parent[i]);
      if (parentShape) parentShape.holes.push(pts);
    }
  }

  return shapes;
}

// ---------------------------------------------------------------------------
// Boundary tracing — walks exact pixel edges with XOR decomposition
// ---------------------------------------------------------------------------

const DX = [1, 0, -1, 0];
const DY = [0, 1, 0, -1];

function getPixel(grid: Uint8Array, w: number, h: number, x: number, y: number): number {
  if (x < 0 || x >= w || y < 0 || y >= h) return 0;
  return grid[y * w + x];
}

function tracePath(
  grid: Uint8Array,
  w: number,
  h: number,
  startX: number,
  startY: number,
): Point[] {
  const path: Point[] = [];
  let cx = startX,
    cy = startY;
  let d = 1;
  const maxSteps = (w + 1) * (h + 1) * 4;

  do {
    path.push({ x: cx, y: cy });
    cx += DX[d];
    cy += DY[d];
    if (path.length >= maxSteps) break;

    const TL = getPixel(grid, w, h, cx - 1, cy - 1);
    const TR = getPixel(grid, w, h, cx, cy - 1);
    const BL = getPixel(grid, w, h, cx - 1, cy);
    const BR = getPixel(grid, w, h, cx, cy);

    const enterDir = (d + 2) & 3;
    const hasBdy = (dir: number): boolean => {
      switch (dir) {
        case 0:
          return TR !== BR;
        case 1:
          return BR !== BL;
        case 2:
          return BL !== TL;
        case 3:
          return TL !== TR;
      }
      return false;
    };

    const rightD = (d + 1) & 3;
    const leftD = (d + 3) & 3;

    if (hasBdy(rightD) && rightD !== enterDir) d = rightD;
    else if (hasBdy(d) && d !== enterDir) {
      /* straight */
    } else if (hasBdy(leftD) && leftD !== enterDir) d = leftD;
    else d = enterDir;
  } while (cx !== startX || cy !== startY);

  return path;
}

function xorFill(grid: Uint8Array, w: number, h: number, path: Point[]): void {
  for (let i = 0; i < path.length; i++) {
    const curr = path[i];
    const next = path[(i + 1) % path.length];
    if (curr.x !== next.x) continue;
    const col = curr.x;
    const row = Math.min(curr.y, next.y);
    if (row < 0 || row >= h) continue;
    const off = row * w;
    const start = Math.max(0, col);
    for (let c = start; c < w; c++) {
      grid[off + c] ^= 1;
    }
  }
}

function decompose(
  grid: Uint8Array,
  w: number,
  h: number,
  report: ProgressFn,
): Point[][] {
  const paths: Point[][] = [];

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (grid[y * w + x] === 1) {
        const path = tracePath(grid, w, h, x, y);
        if (path.length >= 3) {
          paths.push(path);
          xorFill(grid, w, h, path);
        }
      }
    }
    if (y % 20 === 0) report(0.15 + 0.4 * (y / h), "Tracing boundaries…");
  }

  return paths;
}

// ---------------------------------------------------------------------------
// Pre-simplification — reduce huge boundary paths before the O(n²) optimizer
// ---------------------------------------------------------------------------

function rdpSimplify(pts: Point[], tolSq: number): Point[] {
  if (pts.length <= 3) return pts;
  const first = pts[0];
  const last = pts[pts.length - 1];
  const dx = last.x - first.x;
  const dy = last.y - first.y;
  const lenSq = dx * dx + dy * dy;

  let maxDistSq = 0;
  let maxIdx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const ex = pts[i].x - first.x;
    const ey = pts[i].y - first.y;
    const distSq = lenSq === 0
      ? ex * ex + ey * ey
      : (ex * dy - ey * dx) ** 2 / lenSq;
    if (distSq > maxDistSq) {
      maxDistSq = distSq;
      maxIdx = i;
    }
  }

  if (maxDistSq > tolSq) {
    const left = rdpSimplify(pts.slice(0, maxIdx + 1), tolSq);
    const right = rdpSimplify(pts.slice(maxIdx), tolSq);
    return left.slice(0, -1).concat(right);
  }
  return [first, last];
}

const MAX_PATH_POINTS = 4000;

function preSimplify(pts: Point[]): Point[] {
  if (pts.length <= MAX_PATH_POINTS) return pts;
  let tol = 0.25;
  let result = rdpSimplify(pts, tol);
  while (result.length > MAX_PATH_POINTS && tol < 16) {
    tol *= 2;
    result = rdpSimplify(pts, tol);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Polygon optimization — greedy longest-segment forward scan
// ---------------------------------------------------------------------------

// Path points sit on pixel corners, so a staircase along a shallow slope
// deviates up to ~1px from any chord through two of its corners. A 1px
// tolerance absorbs the staircase; adjustVertices then recenters the lines.
const TOL_SQ = 1.0;

/** Index of the sharpest turn along the closed path (a good polygon vertex). */
function sharpestCorner(pts: Point[]): number {
  const n = pts.length;
  const w = Math.max(1, Math.min(4, Math.floor(n / 4)));
  let best = 0, bestCos = Infinity;
  for (let i = 0; i < n; i++) {
    const a = pts[(i - w + n) % n], b = pts[i], c = pts[(i + w) % n];
    const ux = b.x - a.x, uy = b.y - a.y, vx = c.x - b.x, vy = c.y - b.y;
    const cos = (ux * vx + uy * vy) / ((Math.hypot(ux, uy) * Math.hypot(vx, vy)) || 1);
    if (cos < bestCos) { bestCos = cos; best = i; }
  }
  return best;
}

/** For each i, the furthest k (k ≤ n) such that all points between lie within tolerance of chord i→k. */
function computeReach(p: Point[], n: number): Int32Array {
  const reach = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    let maxK = i + 1;
    const x0 = p[i].x, y0 = p[i].y;
    for (let k = i + 2; k <= n; k++) {
      const dx = p[k].x - x0, dy = p[k].y - y0;
      const lenSq = dx * dx + dy * dy;
      if (lenSq === 0) { maxK = k; continue; }
      let ok = true;
      for (let t = i + 1; t < k; t++) {
        const cross = (p[t].x - x0) * dy - (p[t].y - y0) * dx;
        if (cross * cross > TOL_SQ * lenSq) { ok = false; break; }
      }
      if (!ok) break;
      maxK = k;
    }
    reach[i] = maxK;
  }
  return reach;
}

/**
 * Optimal polygon: fewest segments, ties broken by the smallest squared
 * distance of the path points to their segments (Potrace's penalty). The
 * cycle is opened at the sharpest corner so it starts on a true vertex.
 */
function optimizeContour(pts: Point[]): Point[] {
  const n = pts.length;
  if (n <= 4) return pts;

  const s0 = sharpestCorner(pts);
  // Linear copy starting at s0 and closing back on it, relative to s0 for precision
  const o = pts[s0];
  const p: Point[] = [];
  for (let t = 0; t <= n; t++) {
    const q = pts[(s0 + t) % n];
    p.push({ x: q.x - o.x, y: q.y - o.y });
  }

  // Prefix sums for O(1) segment penalties
  const sx = new Float64Array(n + 2), sy = new Float64Array(n + 2);
  const sxx = new Float64Array(n + 2), sxy = new Float64Array(n + 2), syy = new Float64Array(n + 2);
  for (let t = 0; t <= n; t++) {
    const { x, y } = p[t];
    sx[t + 1] = sx[t] + x; sy[t + 1] = sy[t] + y;
    sxx[t + 1] = sxx[t] + x * x; sxy[t + 1] = sxy[t] + x * y; syy[t + 1] = syy[t] + y * y;
  }
  const penalty = (i: number, k: number): number => {
    const dx = p[k].x - p[i].x, dy = p[k].y - p[i].y;
    const len = Math.hypot(dx, dy);
    if (len === 0) return 0;
    const nx = -dy / len, ny = dx / len;
    const c = nx * p[i].x + ny * p[i].y;
    const m = k - i + 1;
    const X = sx[k + 1] - sx[i], Y = sy[k + 1] - sy[i];
    const XX = sxx[k + 1] - sxx[i], XY = sxy[k + 1] - sxy[i], YY = syy[k + 1] - syy[i];
    return nx * nx * XX + 2 * nx * ny * XY + ny * ny * YY - 2 * c * (nx * X + ny * Y) + m * c * c;
  };

  const reach = computeReach(p, n);
  const count = new Int32Array(n + 1).fill(0x7fffffff);
  const pen = new Float64Array(n + 1).fill(Infinity);
  const prev = new Int32Array(n + 1).fill(-1);
  count[0] = 0;
  pen[0] = 0;
  for (let i = 0; i < n; i++) {
    if (count[i] === 0x7fffffff) continue;
    for (let k = i + 1; k <= reach[i]; k++) {
      const c = count[i] + 1;
      const pk = pen[i] + penalty(i, k);
      if (c < count[k] || (c === count[k] && pk < pen[k])) {
        count[k] = c; pen[k] = pk; prev[k] = i;
      }
    }
  }

  const idx: number[] = [];
  for (let k = prev[n]; k > 0; k = prev[k]) idx.push((s0 + k) % n);
  idx.push(s0);
  idx.reverse();
  if (idx.length < 3) return pts;

  return adjustVertices(pts, idx);
}

/**
 * Potrace's vertex adjustment: fit a least-squares line through the path
 * points of each polygon segment, and move each vertex to the intersection of
 * its two adjacent lines, kept within half a pixel of the original vertex.
 * Without this, vertices stay on staircase corners and the polygon wobbles.
 */
function adjustVertices(pts: Point[], idx: number[]): Point[] {
  const n = pts.length;
  const m = idx.length;

  const lines = idx.map((from, s) => {
    const to = idx[(s + 1) % m];
    const count = ((to - from + n) % n) + 1;
    let cx = 0, cy = 0;
    for (let k = 0; k < count; k++) { const p = pts[(from + k) % n]; cx += p.x; cy += p.y; }
    cx /= count; cy /= count;
    let sxx = 0, sxy = 0, syy = 0;
    for (let k = 0; k < count; k++) {
      const p = pts[(from + k) % n];
      const dx = p.x - cx, dy = p.y - cy;
      sxx += dx * dx; sxy += dx * dy; syy += dy * dy;
    }
    // Principal direction of the point cloud
    const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    return { cx, cy, dx: Math.cos(angle), dy: Math.sin(angle) };
  });

  return idx.map((vi, s) => {
    const v = pts[vi];
    const a = lines[(s - 1 + m) % m], b = lines[s];
    const cross = a.dx * b.dy - a.dy * b.dx;
    if (Math.abs(cross) < 1e-6) return v;
    const t = ((b.cx - a.cx) * b.dy - (b.cy - a.cy) * b.dx) / cross;
    const x = a.cx + t * a.dx, y = a.cy + t * a.dy;
    return {
      x: Math.min(v.x + 0.5, Math.max(v.x - 0.5, x)),
      y: Math.min(v.y + 0.5, Math.max(v.y - 0.5, y)),
    };
  });
}

// ---------------------------------------------------------------------------
// Full trace: binary grid → nested, curve-fitted shapes (in grid pixels, y up)
// ---------------------------------------------------------------------------

export interface TraceResult {
  shapes: ShapeData[];
  imageWidth: number;
  imageHeight: number;
}

export function traceGrid(grid: Uint8Array, width: number, height: number, report: ProgressFn): TraceResult {
  report(0.15, "Trimming whitespace…");

  let minX = width,
    minY = height,
    maxX = -1,
    maxY = -1;
  for (let y = 0; y < height; y++) {
    const rowStart = y * width;
    for (let x = 0; x < width; x++) {
      if (grid[rowStart + x] === 1) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < 0) {
    return { shapes: [], imageWidth: width, imageHeight: height };
  }

  const pad = 2;
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(width - 1, maxX + pad);
  maxY = Math.min(height - 1, maxY + pad);
  const trimW = maxX - minX + 1;
  const trimH = maxY - minY + 1;
  const trimmedGrid = new Uint8Array(trimW * trimH);
  for (let y = 0; y < trimH; y++) {
    const srcOff = (y + minY) * width + minX;
    const dstOff = y * trimW;
    trimmedGrid.set(grid.subarray(srcOff, srcOff + trimW), dstOff);
  }

  const paths = decompose(trimmedGrid, trimW, trimH, report);

  report(0.6, "Optimizing polygons…");

  let contours: Point[][] = [];
  for (let i = 0; i < paths.length; i++) {
    const simplified = preSimplify(paths[i]);
    let opt = optimizeContour(simplified);
    if (opt.length >= 3 && hasSelfIntersection(opt)) {
      opt = simplified;
    }
    if (opt.length >= 3 && !hasSelfIntersection(opt)) {
      contours.push(opt);
    }
    if (i % 10 === 0)
      report(0.6 + 0.25 * (i / paths.length), "Optimizing polygons…");
  }

  const minArea = Math.max(4, trimW * trimH * 0.00005);
  contours = contours.filter((c) => Math.abs(signedArea(c)) >= minArea);

  report(0.85, "Fitting curves…");
  contours = contours.map((c) => fitCurves(c));

  const MAX_CONTOURS = 500;
  if (contours.length > MAX_CONTOURS) {
    contours.sort((a, b) => Math.abs(signedArea(b)) - Math.abs(signedArea(a)));
    contours.length = MAX_CONTOURS;
  }

  report(0.9, "Nesting contours…");

  const flipped = contours.map((contour) =>
    contour.map((p) => ({ x: p.x, y: trimH - p.y })),
  );

  return { shapes: nestContours(flipped), imageWidth: trimW, imageHeight: trimH };
}
