import { hasSelfIntersection } from "./contour-utils";

interface Point {
  x: number;
  y: number;
}

function perpendicularDistance(point: Point, lineStart: Point, lineEnd: Point): number {
  const dx = lineEnd.x - lineStart.x;
  const dy = lineEnd.y - lineStart.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) {
    const ex = point.x - lineStart.x;
    const ey = point.y - lineStart.y;
    return Math.sqrt(ex * ex + ey * ey);
  }
  const t = ((point.x - lineStart.x) * dx + (point.y - lineStart.y) * dy) / lengthSq;
  const projX = lineStart.x + t * dx;
  const projY = lineStart.y + t * dy;
  const ex = point.x - projX;
  const ey = point.y - projY;
  return Math.sqrt(ex * ex + ey * ey);
}

function simplifyContour(points: Point[], tolerance: number): Point[] {
  if (points.length <= 2) return points;
  let maxDist = 0;
  let maxIndex = 0;
  const last = points.length - 1;
  for (let i = 1; i < last; i++) {
    const dist = perpendicularDistance(points[i], points[0], points[last]);
    if (dist > maxDist) {
      maxDist = dist;
      maxIndex = i;
    }
  }
  if (maxDist > tolerance) {
    const left = simplifyContour(points.slice(0, maxIndex + 1), tolerance);
    const right = simplifyContour(points.slice(maxIndex), tolerance);
    return left.slice(0, -1).concat(right);
  }
  return [points[0], points[last]];
}

interface ShapeData {
  outer: Point[];
  holes: Point[][];
}

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
    if ((yi > py) !== (yj > py) &&
        px < (contour[j].x - contour[i].x) * (py - yi) / (yj - yi) + contour[i].x) {
      inside = !inside;
    }
  }
  return inside;
}

function nestContours(contours: Point[][]): ShapeData[] {
  if (contours.length === 0) return [];

  const indexed = contours.map((c) => ({
    contour: c,
    absArea: Math.abs(signedArea(c)),
  }));
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
      if (parentShape) {
        parentShape.holes.push(pts);
      }
    }
  }

  return shapes;
}

export interface TraceRequest {
  bitmap: ImageBitmap;
  threshold: number;
}

export type TraceMessage =
  | { type: "progress"; progress: number; stage: string }
  | { type: "result"; shapes: ShapeData[]; imageWidth: number; imageHeight: number };

type ProgressFn = (progress: number, stage: string) => void;

// Marching squares case table.
// Corner bits: bit0=TL, bit1=TR, bit2=BR, bit3=BL.
// Edges: 0=top, 1=right, 2=bottom, 3=left.
// Each row: [segmentCount, e1a, e1b, e2a, e2b] (-1 = unused).
const CASE_TABLE = [
  0, -1, -1, -1, -1, //  0: all outside
  1,  0,  3, -1, -1, //  1: TL
  1,  0,  1, -1, -1, //  2: TR
  1,  1,  3, -1, -1, //  3: TL+TR
  1,  1,  2, -1, -1, //  4: BR
  2,  0,  3,  1,  2, //  5: TL+BR (saddle)
  1,  0,  2, -1, -1, //  6: TR+BR
  1,  2,  3, -1, -1, //  7: TL+TR+BR
  1,  2,  3, -1, -1, //  8: BL
  1,  0,  2, -1, -1, //  9: TL+BL
  2,  0,  1,  2,  3, // 10: TR+BL (saddle)
  1,  1,  2, -1, -1, // 11: TL+TR+BL
  1,  1,  3, -1, -1, // 12: BR+BL
  1,  0,  1, -1, -1, // 13: TL+BR+BL
  1,  0,  3, -1, -1, // 14: TR+BR+BL
  0, -1, -1, -1, -1, // 15: all inside
];

function marchingSquares(
  grid: Uint8Array,
  w: number,
  h: number,
  report: ProgressFn,
): Point[][] {
  const cellsW = w - 1;
  const cellsH = h - 1;

  // Edge-point ID layout:
  //   Horizontal edges: id = ey * cellsW + ex   (ey ∈ [0,h), ex ∈ [0,cellsW))
  //   Vertical edges:   id = hCount + ey * w + ex (ey ∈ [0,cellsH), ex ∈ [0,w))
  const hCount = h * cellsW;
  const totalEdges = hCount + cellsH * w;

  // Adjacency — each edge point connects to at most 2 others.
  const link1 = new Int32Array(totalEdges).fill(-1);
  const link2 = new Int32Array(totalEdges).fill(-1);

  for (let cy = 0; cy < cellsH; cy++) {
    const rowOff = cy * w;
    const nextRowOff = rowOff + w;

    // Pre-compute the 4 base edge IDs that only depend on the row.
    const hTop = cy * cellsW;             // + cx for edge 0
    const hBot = (cy + 1) * cellsW;       // + cx for edge 2
    const vRow = hCount + cy * w;          // + cx for edge 3, + (cx+1) for edge 1

    for (let cx = 0; cx < cellsW; cx++) {
      const caseIdx =
        grid[rowOff + cx] |
        (grid[rowOff + cx + 1] << 1) |
        (grid[nextRowOff + cx + 1] << 2) |
        (grid[nextRowOff + cx] << 3);

      const off = caseIdx * 5;
      const count = CASE_TABLE[off];
      if (count === 0) continue;

      // Resolve edge index → global edge-point ID (inlined, no function call).
      const edgeIds0 = hTop + cx;          // edge 0 (top)
      const edgeIds1 = vRow + cx + 1;      // edge 1 (right)
      const edgeIds2 = hBot + cx;          // edge 2 (bottom)
      const edgeIds3 = vRow + cx;          // edge 3 (left)

      const resolve = (e: number) =>
        e === 0 ? edgeIds0 : e === 1 ? edgeIds1 : e === 2 ? edgeIds2 : edgeIds3;

      const a = resolve(CASE_TABLE[off + 1]);
      const b = resolve(CASE_TABLE[off + 2]);
      if (link1[a] === -1) link1[a] = b; else link2[a] = b;
      if (link1[b] === -1) link1[b] = a; else link2[b] = a;

      if (count === 2) {
        const c = resolve(CASE_TABLE[off + 3]);
        const d = resolve(CASE_TABLE[off + 4]);
        if (link1[c] === -1) link1[c] = d; else link2[c] = d;
        if (link1[d] === -1) link1[d] = c; else link2[d] = c;
      }
    }

    if (cy % 40 === 0) report(0.15 + 0.45 * (cy / cellsH), "Tracing contours…");
  }

  report(0.60, "Building contours…");

  // Chain linked edge points into closed contours.
  const visited = new Uint8Array(totalEdges);
  const contours: Point[][] = [];

  for (let start = 0; start < totalEdges; start++) {
    if (visited[start] || link1[start] === -1) continue;

    const ids: number[] = [start];
    visited[start] = 1;

    let cur = link1[start];
    let prev = start;

    while (cur !== -1 && cur !== start && !visited[cur]) {
      ids.push(cur);
      visited[cur] = 1;
      const next = link1[cur] === prev ? link2[cur] : link1[cur];
      prev = cur;
      cur = next;
    }

    if (ids.length < 3 || cur !== start) continue;

    const points: Point[] = new Array(ids.length);
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      if (id < hCount) {
        const ey = (id / cellsW) | 0;
        const ex = id - ey * cellsW;
        points[i] = { x: ex + 0.5, y: ey };
      } else {
        const vid = id - hCount;
        const ey = (vid / w) | 0;
        const ex = vid - ey * w;
        points[i] = { x: ex, y: ey + 0.5 };
      }
    }
    contours.push(points);
  }

  return contours;
}

self.onmessage = (e: MessageEvent<TraceRequest>) => {
  const { bitmap, threshold } = e.data;

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

  const n = width * height;
  const grid = new Uint8Array(n);
  for (let y = 0; y < height; y++) {
    const rowStart = y * width;
    const dataRowStart = rowStart * 4;
    for (let x = 0; x < width; x++) {
      const off = dataRowStart + x * 4;
      const luminance = 0.299 * data[off] + 0.587 * data[off + 1] + 0.114 * data[off + 2];
      grid[rowStart + x] = (data[off + 3] > 128 && luminance < threshold) ? 1 : 0;
    }
    if (y % 50 === 0) report(0.15 * (y / height), "Building pixel grid…");
  }

  report(0.15, "Trimming whitespace…");

  let minX = width, minY = height, maxX = -1, maxY = -1;
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

  let trimmedGrid = grid;
  let trimW = width;
  let trimH = height;

  if (maxX >= 0) {
    const pad = 2;
    minX = Math.max(0, minX - pad);
    minY = Math.max(0, minY - pad);
    maxX = Math.min(width - 1, maxX + pad);
    maxY = Math.min(height - 1, maxY + pad);
    trimW = maxX - minX + 1;
    trimH = maxY - minY + 1;
    trimmedGrid = new Uint8Array(trimW * trimH);
    for (let y = 0; y < trimH; y++) {
      const srcOff = (y + minY) * width + minX;
      const dstOff = y * trimW;
      trimmedGrid.set(grid.subarray(srcOff, srcOff + trimW), dstOff);
    }
  }

  // Pad grid with 1px zero border so contours touching image edges close properly.
  // Without this, boundary edge points get only 1 link and produce open chains.
  const padW = trimW + 2;
  const padH = trimH + 2;
  const paddedGrid = new Uint8Array(padW * padH);
  for (let y = 0; y < trimH; y++) {
    paddedGrid.set(
      trimmedGrid.subarray(y * trimW, y * trimW + trimW),
      (y + 1) * padW + 1,
    );
  }

  let contours = marchingSquares(paddedGrid, padW, padH, report);

  for (const contour of contours) {
    for (const p of contour) {
      p.x -= 1;
      p.y -= 1;
    }
  }

  report(0.70, "Simplifying…");

  if (contours.length > 0) {
    const total = contours.length;
    const simplified: Point[][] = [];
    for (let i = 0; i < total; i++) {
      let s = simplifyContour(contours[i], 0.5);
      if (s.length >= 3 && hasSelfIntersection(s)) {
        s = simplifyContour(contours[i], 0.15);
      }
      if (s.length >= 3 && !hasSelfIntersection(s)) simplified.push(s);
      if (i % 20 === 0) report(0.70 + 0.20 * (i / total), "Simplifying…");
    }
    const minArea = Math.max(4, trimW * trimH * 0.00005);
    contours = simplified.filter((c) => Math.abs(signedArea(c)) >= minArea);

    const MAX_CONTOURS = 500;
    if (contours.length > MAX_CONTOURS) {
      contours.sort((a, b) => Math.abs(signedArea(b)) - Math.abs(signedArea(a)));
      contours.length = MAX_CONTOURS;
    }
  }

  report(0.90, "Nesting contours…");

  const flipped = contours.map((contour) =>
    contour.map((p) => ({ x: p.x, y: trimH - p.y })),
  );

  const shapes = nestContours(flipped);

  post({ type: "result", shapes, imageWidth: trimW, imageHeight: trimH } as TraceMessage);
};
