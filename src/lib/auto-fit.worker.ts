interface Point { x: number; y: number }

interface ShapeData {
  points: Point[];
  holes: Point[][];
}

export interface AutoFitRequest {
  shapes: ShapeData[];
  contentW: number;
  contentH: number;
  nozzleDiameter: number;
}

export interface AutoFitResult {
  type: "result";
  width: number;
}

const INF = 1e10;
const RESOLUTION = 0.1;
const MARGIN_MM = 2;
const MIN_THIN_PIXELS = 20;

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

function hasThinFeatures(
  shapes: ShapeData[],
  scale: number,
  contentW: number,
  contentH: number,
  nozzleDiameter: number,
): boolean {
  const marginPx = Math.ceil(MARGIN_MM / RESOLUTION);
  const gridW = Math.ceil(contentW * scale / RESOLUTION) + marginPx * 2 + 1;
  const gridH = Math.ceil(contentH * scale / RESOLUTION) + marginPx * 2 + 1;
  const n = gridW * gridH;

  const canvas = new OffscreenCanvas(gridW, gridH);
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, gridW, gridH);
  ctx.fillStyle = "white";

  for (const shape of shapes) {
    if (shape.points.length === 0) continue;
    ctx.beginPath();
    ctx.moveTo(
      shape.points[0].x * scale / RESOLUTION + marginPx,
      shape.points[0].y * scale / RESOLUTION + marginPx,
    );
    for (let i = 1; i < shape.points.length; i++) {
      ctx.lineTo(
        shape.points[i].x * scale / RESOLUTION + marginPx,
        shape.points[i].y * scale / RESOLUTION + marginPx,
      );
    }
    ctx.closePath();

    for (const hole of shape.holes) {
      if (hole.length === 0) continue;
      ctx.moveTo(
        hole[0].x * scale / RESOLUTION + marginPx,
        hole[0].y * scale / RESOLUTION + marginPx,
      );
      for (let i = 1; i < hole.length; i++) {
        ctx.lineTo(
          hole[i].x * scale / RESOLUTION + marginPx,
          hole[i].y * scale / RESOLUTION + marginPx,
        );
      }
      ctx.closePath();
    }

    ctx.fill("evenodd");
  }

  const imageData = ctx.getImageData(0, 0, gridW, gridH);
  const mask = new Uint8Array(n);
  let filledCount = 0;
  for (let i = 0; i < n; i++) {
    if (imageData.data[i * 4] > 128) {
      mask[i] = 1;
      filledCount++;
    }
  }
  if (filledCount === 0) return false;

  const dtInput1 = new Float32Array(n);
  for (let i = 0; i < n; i++) dtInput1[i] = mask[i] ? INF : 0;
  const sqDistToBg = squaredEDT(dtInput1, gridW, gridH);

  const rPx = nozzleDiameter / 2 / RESOLUTION;
  const erosionSq = (rPx + 0.5) * (rPx + 0.5);

  let hasEroded = false;
  const eroded = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (mask[i] && sqDistToBg[i] >= erosionSq) {
      eroded[i] = 1;
      hasEroded = true;
    }
  }

  if (!hasEroded) return filledCount >= MIN_THIN_PIXELS;

  const dtInput2 = new Float32Array(n);
  for (let i = 0; i < n; i++) dtInput2[i] = eroded[i] ? 0 : INF;
  const sqDistToEroded = squaredEDT(dtInput2, gridW, gridH);

  const dilationSq = (rPx + 1) * (rPx + 1);
  let thinCount = 0;
  for (let i = 0; i < n; i++) {
    if (mask[i] && sqDistToEroded[i] > dilationSq) {
      thinCount++;
      if (thinCount >= MIN_THIN_PIXELS) return true;
    }
  }

  return false;
}

self.onmessage = (e: MessageEvent<AutoFitRequest>) => {
  const { shapes, contentW, contentH, nozzleDiameter } = e.data;

  let lo = 10;
  let hi = 200;

  for (let iter = 0; iter < 15; iter++) {
    const mid = Math.round((lo + hi) / 2);
    if (mid <= lo) break;

    const scale = mid / contentW;
    if (hasThinFeatures(shapes, scale, contentW, contentH, nozzleDiameter)) {
      lo = mid;
    } else {
      hi = mid;
    }
  }

  self.postMessage({ type: "result", width: hi } as AutoFitResult);
};
