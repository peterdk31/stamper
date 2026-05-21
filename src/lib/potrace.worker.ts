import { hasSelfIntersection } from "./contour-utils";

interface Point {
  x: number;
  y: number;
}

interface ShapeData {
  outer: Point[];
  holes: Point[][];
}

export type TraceMessage =
  | { type: "progress"; progress: number; stage: string }
  | { type: "result"; shapes: ShapeData[]; imageWidth: number; imageHeight: number };

type ProgressFn = (progress: number, stage: string) => void;

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

const TOL_SQ = 0.25;

function computeLon(pts: Point[], n: number): Int32Array {
  const lon = new Int32Array(n);

  for (let i = 0; i < n; i++) {
    let maxJ = i + 1;
    const x0 = pts[i].x,
      y0 = pts[i].y;

    for (let j = i + 2; j <= i + n - 1; j++) {
      const jm = j % n;
      const dx = pts[jm].x - x0;
      const dy = pts[jm].y - y0;
      const lenSq = dx * dx + dy * dy;

      if (lenSq === 0) {
        maxJ = j;
        continue;
      }

      let ok = true;
      for (let k = i + 1; k < j; k++) {
        const km = k % n;
        const ex = pts[km].x - x0;
        const ey = pts[km].y - y0;
        const cross = ex * dy - ey * dx;
        if (cross * cross > TOL_SQ * lenSq) {
          ok = false;
          break;
        }
      }

      if (!ok) break;
      maxJ = j;
    }

    lon[i] = maxJ;
  }

  return lon;
}

function optimizeContour(pts: Point[]): Point[] {
  const n = pts.length;
  if (n <= 4) return pts;

  const lon = computeLon(pts, n);

  const breakpoints: number[] = [0];
  let cur = 0;
  let stepsTotal = 0;

  while (stepsTotal < n - 1 && breakpoints.length < n) {
    const maxStep = lon[cur] - cur;
    const remaining = n - stepsTotal;
    const step = Math.min(maxStep, remaining);

    stepsTotal += step;
    if (stepsTotal >= n) break;

    cur = (cur + step) % n;
    breakpoints.push(cur);
  }

  if (breakpoints.length < 3) return pts;

  return breakpoints.map((i) => pts[i]);
}

// ---------------------------------------------------------------------------
// Main worker
// ---------------------------------------------------------------------------

interface TraceRequest {
  bitmap: ImageBitmap;
  threshold: number;
  brightness: number;
  contrast: number;
  redWeight: number;
  greenWeight: number;
  blueWeight: number;
  invert: boolean;
}

function adjustPixel(value: number, brightness: number, contrastFactor: number, invert: boolean): number {
  if (invert) value = 255 - value;
  value += brightness;
  value = (value - 128) * contrastFactor + 128;
  return value < 0 ? 0 : value > 255 ? 255 : value;
}

self.onmessage = (e: MessageEvent<TraceRequest>) => {
  const { bitmap, threshold, brightness = 0, contrast = 0, redWeight = 30, greenWeight = 59, blueWeight = 11, invert = false } = e.data;

  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  bitmap.close();

  const width = imageData.width;
  const height = imageData.height;
  const data = imageData.data;

  const post = self.postMessage.bind(self);
  let lastReported = -1;
  const report: ProgressFn = (progress, stage) => {
    const rounded = Math.round(progress * 100);
    if (rounded === lastReported) return;
    lastReported = rounded;
    post({ type: "progress", progress, stage } as TraceMessage);
  };

  report(0, "Building pixel grid…");

  const contrastFactor = (259 * (contrast + 255)) / (255 * (259 - contrast));
  const hasAdjustments = brightness !== 0 || contrast !== 0 || invert;
  const wSum = redWeight + greenWeight + blueWeight;
  const wr = wSum > 0 ? redWeight / wSum : 1/3;
  const wg = wSum > 0 ? greenWeight / wSum : 1/3;
  const wb = wSum > 0 ? blueWeight / wSum : 1/3;

  const total = width * height;
  const grid = new Uint8Array(total);
  for (let y = 0; y < height; y++) {
    const rowStart = y * width;
    const dataRowStart = rowStart * 4;
    for (let x = 0; x < width; x++) {
      const off = dataRowStart + x * 4;
      let r = data[off], g = data[off + 1], b = data[off + 2];
      if (hasAdjustments) {
        r = adjustPixel(r, brightness, contrastFactor, invert);
        g = adjustPixel(g, brightness, contrastFactor, invert);
        b = adjustPixel(b, brightness, contrastFactor, invert);
      }
      const luminance = wr * r + wg * g + wb * b;
      grid[rowStart + x] = data[off + 3] > 128 && luminance < threshold ? 1 : 0;
    }
    if (y % 50 === 0) report(0.15 * (y / height), "Building pixel grid…");
  }

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
    post({
      type: "result",
      shapes: [],
      imageWidth: width,
      imageHeight: height,
    } as TraceMessage);
    return;
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

  const MAX_CONTOURS = 500;
  if (contours.length > MAX_CONTOURS) {
    contours.sort((a, b) => Math.abs(signedArea(b)) - Math.abs(signedArea(a)));
    contours.length = MAX_CONTOURS;
  }

  report(0.9, "Nesting contours…");

  const flipped = contours.map((contour) =>
    contour.map((p) => ({ x: p.x, y: trimH - p.y })),
  );

  const shapes = nestContours(flipped);

  post({
    type: "result",
    shapes,
    imageWidth: trimW,
    imageHeight: trimH,
  } as TraceMessage);
};
