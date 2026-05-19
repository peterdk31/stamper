interface Point { x: number; y: number }
interface ShapeData { outer: Point[]; holes: Point[][] }

export interface ThinFeatureRequest {
  shapes: ShapeData[];
  stampWidth: number;
  stampHeight: number;
  nozzleDiameter: number;
}

export type ThinFeatureMessage =
  | { type: "result"; hasThinFeatures: boolean; pixels: Uint8Array; gridW: number; gridH: number }
  | { type: "empty" };

const INF = 1e10;
const RESOLUTION = 0.1;
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

self.onmessage = (e: MessageEvent<ThinFeatureRequest>) => {
  const { shapes, stampWidth, stampHeight, nozzleDiameter } = e.data;
  const post = self.postMessage.bind(self);

  const gridW = Math.ceil(stampWidth / RESOLUTION) + 1;
  const gridH = Math.ceil(stampHeight / RESOLUTION) + 1;
  const n = gridW * gridH;

  const canvas = new OffscreenCanvas(gridW, gridH);
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, gridW, gridH);
  ctx.fillStyle = "white";

  for (const shape of shapes) {
    if (shape.outer.length === 0) continue;
    ctx.beginPath();
    ctx.moveTo(shape.outer[0].x / RESOLUTION, shape.outer[0].y / RESOLUTION);
    for (let i = 1; i < shape.outer.length; i++) {
      ctx.lineTo(shape.outer[i].x / RESOLUTION, shape.outer[i].y / RESOLUTION);
    }
    ctx.closePath();

    for (const hole of shape.holes) {
      if (hole.length === 0) continue;
      ctx.moveTo(hole[0].x / RESOLUTION, hole[0].y / RESOLUTION);
      for (let i = 1; i < hole.length; i++) {
        ctx.lineTo(hole[i].x / RESOLUTION, hole[i].y / RESOLUTION);
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

  let filledCount = 0;
  for (let i = 0; i < n; i++) {
    if (mask[i]) filledCount++;
  }
  if (filledCount === 0) {
    post({ type: "empty" } as ThinFeatureMessage);
    return;
  }

  const dtInput1 = new Float32Array(n);
  for (let i = 0; i < n; i++) dtInput1[i] = mask[i] ? INF : 0;
  const sqDistToBg = squaredEDT(dtInput1, gridW, gridH);

  const rPx = nozzleDiameter / 2 / RESOLUTION;
  const erosionSq = (rPx + 0.5) * (rPx + 0.5);

  const eroded = new Uint8Array(n);
  let hasEroded = false;
  for (let i = 0; i < n; i++) {
    if (mask[i] && sqDistToBg[i] >= erosionSq) {
      eroded[i] = 1;
      hasEroded = true;
    }
  }

  if (!hasEroded) {
    const hasThin = filledCount >= MIN_THIN_PIXELS;
    const pixels = buildPixels(mask, gridW, gridH, hasThin);
    post({ type: "result", hasThinFeatures: hasThin, pixels, gridW, gridH } as ThinFeatureMessage, { transfer: [pixels.buffer] });
    return;
  }

  const dtInput2 = new Float32Array(n);
  for (let i = 0; i < n; i++) dtInput2[i] = eroded[i] ? 0 : INF;
  const sqDistToEroded = squaredEDT(dtInput2, gridW, gridH);

  const dilationSq = (rPx + 1) * (rPx + 1);
  const thin = new Uint8Array(n);
  let thinCount = 0;
  for (let i = 0; i < n; i++) {
    if (mask[i] && sqDistToEroded[i] > dilationSq) {
      thin[i] = 1;
      thinCount++;
    }
  }

  const hasThin = thinCount >= MIN_THIN_PIXELS;
  const pixels = buildPixels(thin, gridW, gridH, hasThin);
  post({ type: "result", hasThinFeatures: hasThin, pixels, gridW, gridH } as ThinFeatureMessage, { transfer: [pixels.buffer] });
};

function buildPixels(thinData: Uint8Array, gridW: number, gridH: number, hasThin: boolean): Uint8Array {
  const pixels = new Uint8Array(gridW * gridH * 4);
  if (!hasThin) return pixels;
  for (let i = 0; i < gridW * gridH; i++) {
    if (thinData[i]) {
      pixels[i * 4] = 230;
      pixels[i * 4 + 1] = 38;
      pixels[i * 4 + 2] = 38;
      pixels[i * 4 + 3] = 255;
    }
  }
  return pixels;
}
