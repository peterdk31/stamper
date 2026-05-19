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

export interface TraceRequest {
  width: number;
  height: number;
  data: Uint8ClampedArray;
  targetWidth: number;
  targetHeight: number;
  simplification: number;
  threshold: number;
}

export type TraceMessage =
  | { type: "progress"; progress: number; stage: string }
  | { type: "result"; contours: Point[][] };

const DX = [1, 1, 0, -1, -1, -1, 0, 1];
const DY = [0, 1, 1, 1, 0, -1, -1, -1];

function followContour(
  edge: Uint8Array,
  width: number,
  height: number,
  startX: number,
  startY: number,
  visited: Uint8Array,
): Point[] {
  const contour: Point[] = [];
  let x = startX;
  let y = startY;
  let dir = 0;

  do {
    const idx = y * width + x;
    if (!visited[idx]) {
      visited[idx] = 1;
      contour.push({ x, y });
    }

    let found = false;
    for (let i = 0; i < 8; i++) {
      const tryDir = (dir + 7 + i) & 7;
      const nx = x + DX[tryDir];
      const ny = y + DY[tryDir];

      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      if (!edge[ny * width + nx]) continue;

      x = nx;
      y = ny;
      dir = tryDir;
      found = true;
      break;
    }

    if (!found) break;
  } while (x !== startX || y !== startY);

  return contour;
}

type ProgressFn = (progress: number, stage: string) => void;

function traceContours(
  grid: Uint8Array,
  width: number,
  height: number,
  report: ProgressFn,
): Point[][] {
  const n = width * height;
  const edge = new Uint8Array(n);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (!grid[idx]) continue;
      if (
        x === 0 || y === 0 || x === width - 1 || y === height - 1 ||
        !grid[idx - 1] || !grid[idx + 1] ||
        !grid[idx - width] || !grid[idx + width]
      ) {
        edge[idx] = 1;
      }
    }
    if (y % 50 === 0) report(0.15 + 0.15 * (y / height), "Detecting edges…");
  }

  const visited = new Uint8Array(n);
  const contours: Point[][] = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (!edge[idx] || visited[idx]) continue;

      const contour = followContour(edge, width, height, x, y, visited);
      if (contour.length >= 3) {
        contours.push(contour);
      }
    }
    if (y % 50 === 0) report(0.30 + 0.40 * (y / height), "Tracing contours…");
  }

  return contours;
}

self.onmessage = (e: MessageEvent<TraceRequest>) => {
  const { width, height, data, targetWidth, targetHeight, simplification, threshold } = e.data;

  const post = self.postMessage.bind(self);
  let lastReported = -1;
  const report: ProgressFn = (progress, stage) => {
    const rounded = Math.round(progress * 100);
    if (rounded === lastReported) return;
    lastReported = rounded;
    post({ type: "progress", progress, stage } satisfies TraceMessage);
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

  let contours = traceContours(grid, width, height, report);

  report(0.70, "Simplifying…");

  if (simplification > 0 && contours.length > 0) {
    const tolerance = simplification * 5;
    const total = contours.length;
    const simplified: Point[][] = [];
    for (let i = 0; i < total; i++) {
      const s = simplifyContour(contours[i], tolerance);
      if (s.length >= 3) simplified.push(s);
      if (i % 20 === 0) report(0.70 + 0.20 * (i / total), "Simplifying…");
    }
    contours = simplified;
  }

  report(0.90, "Scaling…");

  const scaleX = targetWidth / width;
  const scaleY = targetHeight / height;
  const scaledContours = contours.map((contour) =>
    contour.map((p) => ({ x: p.x * scaleX, y: (height - p.y) * scaleY })),
  );

  post({ type: "result", contours: scaledContours } satisfies TraceMessage);
};
