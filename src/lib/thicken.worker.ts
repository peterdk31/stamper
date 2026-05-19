interface Point {
  x: number;
  y: number;
}

interface ShapeData {
  points: Point[];
  holes: Point[][];
}

export interface ThickenRequest {
  shapes: ShapeData[];
  stampWidth: number;
  stampHeight: number;
  nozzleDiameter: number;
}

export type ThickenMessage =
  | { type: "progress"; progress: number; stage: string }
  | { type: "result"; contours: Point[][] };

const RESOLUTION = 0.05; // mm per pixel
const INF = 1e10;

function dt1d(f: Float32Array, n: number): Float32Array {
  const d = new Float32Array(n);
  const v = new Int32Array(n);
  const z = new Float32Array(n + 1);

  let k = 0;
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;

  for (let q = 1; q < n; q++) {
    let s: number;
    for (;;) {
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      if (s > z[k]) break;
      k--;
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }

  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }

  return d;
}

function squaredEDT(grid: Float32Array, w: number, h: number): Float32Array {
  const result = new Float32Array(w * h);
  result.set(grid);

  const buf = new Float32Array(Math.max(w, h));

  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) buf[y] = result[y * w + x];
    const d = dt1d(buf, h);
    for (let y = 0; y < h; y++) result[y * w + x] = d[y];
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) buf[x] = result[y * w + x];
    const d = dt1d(buf, w);
    for (let x = 0; x < w; x++) result[y * w + x] = d[x];
  }

  return result;
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

const CASE_TABLE = [
  0, -1, -1, -1, -1,
  1,  0,  3, -1, -1,
  1,  0,  1, -1, -1,
  1,  1,  3, -1, -1,
  1,  1,  2, -1, -1,
  2,  0,  3,  1,  2,
  1,  0,  2, -1, -1,
  1,  2,  3, -1, -1,
  1,  2,  3, -1, -1,
  1,  0,  2, -1, -1,
  2,  0,  1,  2,  3,
  1,  1,  2, -1, -1,
  1,  1,  3, -1, -1,
  1,  0,  1, -1, -1,
  1,  0,  3, -1, -1,
  0, -1, -1, -1, -1,
];

function marchingSquares(grid: Uint8Array, w: number, h: number): Point[][] {
  const cellsW = w - 1;
  const cellsH = h - 1;
  const hCount = h * cellsW;
  const totalEdges = hCount + cellsH * w;

  const link1 = new Int32Array(totalEdges).fill(-1);
  const link2 = new Int32Array(totalEdges).fill(-1);

  for (let cy = 0; cy < cellsH; cy++) {
    const rowOff = cy * w;
    const nextRowOff = rowOff + w;
    const hTop = cy * cellsW;
    const hBot = (cy + 1) * cellsW;
    const vRow = hCount + cy * w;

    for (let cx = 0; cx < cellsW; cx++) {
      const caseIdx =
        grid[rowOff + cx] |
        (grid[rowOff + cx + 1] << 1) |
        (grid[nextRowOff + cx + 1] << 2) |
        (grid[nextRowOff + cx] << 3);

      const off = caseIdx * 5;
      const count = CASE_TABLE[off];
      if (count === 0) continue;

      const edgeIds0 = hTop + cx;
      const edgeIds1 = vRow + cx + 1;
      const edgeIds2 = hBot + cx;
      const edgeIds3 = vRow + cx;

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
  }

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

    if (ids.length < 3) continue;

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

self.onmessage = (e: MessageEvent<ThickenRequest>) => {
  const { shapes, stampWidth, stampHeight, nozzleDiameter } = e.data;
  const post = self.postMessage.bind(self);

  post({ type: "progress", progress: 0, stage: "Rasterizing…" } as ThickenMessage);

  const gridW = Math.ceil(stampWidth / RESOLUTION) + 2;
  const gridH = Math.ceil(stampHeight / RESOLUTION) + 2;
  const n = gridW * gridH;

  const canvas = new OffscreenCanvas(gridW, gridH);
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, gridW, gridH);
  ctx.fillStyle = "white";

  for (const shape of shapes) {
    if (shape.points.length === 0) continue;
    ctx.beginPath();
    ctx.moveTo(shape.points[0].x / RESOLUTION + 1, (stampHeight - shape.points[0].y) / RESOLUTION + 1);
    for (let i = 1; i < shape.points.length; i++) {
      ctx.lineTo(shape.points[i].x / RESOLUTION + 1, (stampHeight - shape.points[i].y) / RESOLUTION + 1);
    }
    ctx.closePath();

    for (const hole of shape.holes) {
      if (hole.length === 0) continue;
      ctx.moveTo(hole[0].x / RESOLUTION + 1, (stampHeight - hole[0].y) / RESOLUTION + 1);
      for (let i = 1; i < hole.length; i++) {
        ctx.lineTo(hole[i].x / RESOLUTION + 1, (stampHeight - hole[i].y) / RESOLUTION + 1);
      }
      ctx.closePath();
    }

    ctx.fill("evenodd");
  }

  const imageData = ctx.getImageData(0, 0, gridW, gridH);
  const mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    mask[i] = imageData.data[i * 4] > 128 ? 1 : 0;
  }

  post({ type: "progress", progress: 0.2, stage: "Computing distance field…" } as ThickenMessage);

  const dtInput = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    dtInput[i] = mask[i] ? 0 : INF;
  }
  const sqDistToFilled = squaredEDT(dtInput, gridW, gridH);

  post({ type: "progress", progress: 0.4, stage: "Dilating features…" } as ThickenMessage);

  const radiusPx = nozzleDiameter / 2 / RESOLUTION;
  const radiusSq = radiusPx * radiusPx;

  const dilated = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (mask[i] || sqDistToFilled[i] <= radiusSq) {
      dilated[i] = 1;
    }
  }

  post({ type: "progress", progress: 0.5, stage: "Tracing contours…" } as ThickenMessage);

  const rawContours = marchingSquares(dilated, gridW, gridH);

  post({ type: "progress", progress: 0.8, stage: "Simplifying…" } as ThickenMessage);

  const contours: Point[][] = [];
  for (const contour of rawContours) {
    const s = simplifyContour(contour, 0.5);
    if (s.length >= 3) {
      contours.push(s.map((p) => ({
        x: (p.x - 1) * RESOLUTION,
        y: stampHeight - (p.y - 1) * RESOLUTION,
      })));
    }
  }

  post({ type: "progress", progress: 1.0, stage: "Done" } as ThickenMessage);
  post({ type: "result", contours } as ThickenMessage);
};
