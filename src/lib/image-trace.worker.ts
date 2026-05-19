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

const DIRECTIONS = [
  { dx: 1, dy: 0 },
  { dx: 1, dy: 1 },
  { dx: 0, dy: 1 },
  { dx: -1, dy: 1 },
  { dx: -1, dy: 0 },
  { dx: -1, dy: -1 },
  { dx: 0, dy: -1 },
  { dx: 1, dy: -1 },
];

function followContour(
  grid: boolean[],
  width: number,
  height: number,
  startX: number,
  startY: number,
  visited: Set<string>,
): Point[] {
  const contour: Point[] = [];
  let x = startX;
  let y = startY;
  let dir = 0;

  do {
    const key = `${x},${y}`;
    if (!visited.has(key)) {
      visited.add(key);
      contour.push({ x, y });
    }

    let found = false;
    for (let i = 0; i < DIRECTIONS.length; i++) {
      const tryDir = (dir + DIRECTIONS.length - 1 + i) % DIRECTIONS.length;
      const nx = x + DIRECTIONS[tryDir].dx;
      const ny = y + DIRECTIONS[tryDir].dy;

      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      if (!grid[ny * width + nx]) continue;

      const isEdge =
        nx === 0 || ny === 0 || nx === width - 1 || ny === height - 1 ||
        !grid[ny * width + (nx - 1)] ||
        !grid[ny * width + (nx + 1)] ||
        !grid[(ny - 1) * width + nx] ||
        !grid[(ny + 1) * width + nx];

      if (!isEdge) continue;

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

function traceContours(grid: boolean[], width: number, height: number): Point[][] {
  const visited = new Set<string>();
  const contours: Point[][] = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!grid[y * width + x]) continue;

      const isEdge =
        x === 0 || y === 0 || x === width - 1 || y === height - 1 ||
        !grid[y * width + (x - 1)] ||
        !grid[y * width + (x + 1)] ||
        !grid[(y - 1) * width + x] ||
        !grid[(y + 1) * width + x];

      if (!isEdge) continue;

      const key = `${x},${y}`;
      if (visited.has(key)) continue;

      const contour = followContour(grid, width, height, x, y, visited);
      if (contour.length >= 3) {
        contours.push(contour);
      }
    }
  }

  return contours;
}

self.onmessage = (e: MessageEvent<TraceRequest>) => {
  const { width, height, data, targetWidth, targetHeight, simplification, threshold } = e.data;

  const ctx = self as unknown as Worker;

  ctx.postMessage({ type: "progress", progress: 0.1, stage: "Building pixel grid…" });

  const grid: boolean[] = new Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    const a = data[i * 4 + 3];
    const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
    grid[i] = a > 128 && luminance < threshold;
  }

  ctx.postMessage({ type: "progress", progress: 0.3, stage: "Tracing contours…" });

  let contours = traceContours(grid, width, height);

  ctx.postMessage({ type: "progress", progress: 0.7, stage: "Simplifying…" });

  if (simplification > 0) {
    const tolerance = simplification * 5;
    contours = contours
      .map((c) => simplifyContour(c, tolerance))
      .filter((c) => c.length >= 3);
  }

  const scaleX = targetWidth / width;
  const scaleY = targetHeight / height;
  const scaledContours = contours.map((contour) =>
    contour.map((p) => ({ x: p.x * scaleX, y: (height - p.y) * scaleY })),
  );

  ctx.postMessage({ type: "result", contours: scaledContours });
};
