import * as THREE from "three";
import type { StampShapeData } from "@/types/stamp";

const INF = 1e10;
const RESOLUTION = 0.1; // mm per pixel

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
      s =
        (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
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

export interface ThinFeatureMap {
  data: Uint8Array;
  gridW: number;
  gridH: number;
  resolution: number;
  hasThinFeatures: boolean;
}

function rasterizeShapes(
  shapes: THREE.Shape[],
  stampWidth: number,
  stampHeight: number,
  resolution: number,
): { mask: Uint8Array; gridW: number; gridH: number } {
  const gridW = Math.ceil(stampWidth / resolution) + 1;
  const gridH = Math.ceil(stampHeight / resolution) + 1;
  const n = gridW * gridH;

  const canvas = document.createElement("canvas");
  canvas.width = gridW;
  canvas.height = gridH;
  const ctx = canvas.getContext("2d")!;

  ctx.clearRect(0, 0, gridW, gridH);
  ctx.fillStyle = "white";

  for (const shape of shapes) {
    ctx.beginPath();
    const pts = shape.getPoints();
    if (pts.length === 0) continue;
    ctx.moveTo(pts[0].x / resolution, pts[0].y / resolution);
    for (let i = 1; i < pts.length; i++) {
      ctx.lineTo(pts[i].x / resolution, pts[i].y / resolution);
    }
    ctx.closePath();

    for (const hole of shape.holes) {
      const hp = hole.getPoints();
      if (hp.length === 0) continue;
      ctx.moveTo(hp[0].x / resolution, hp[0].y / resolution);
      for (let i = 1; i < hp.length; i++) {
        ctx.lineTo(hp[i].x / resolution, hp[i].y / resolution);
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

  return { mask, gridW, gridH };
}

const MIN_THIN_PIXELS = 20;

export function computeThinFeatureMap(
  shapes: THREE.Shape[],
  stampWidth: number,
  stampHeight: number,
  nozzleDiameter: number,
): ThinFeatureMap {
  const resolution = RESOLUTION;
  const { mask, gridW, gridH } = rasterizeShapes(
    shapes,
    stampWidth,
    stampHeight,
    resolution,
  );
  const n = gridW * gridH;

  let filledCount = 0;
  for (let i = 0; i < n; i++) {
    if (mask[i]) filledCount++;
  }
  if (filledCount === 0) {
    return {
      data: new Uint8Array(n),
      gridW,
      gridH,
      resolution,
      hasThinFeatures: false,
    };
  }

  const dtInput1 = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    dtInput1[i] = mask[i] ? INF : 0;
  }
  const sqDistToBg = squaredEDT(dtInput1, gridW, gridH);

  const rPx = nozzleDiameter / 2 / resolution;
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
    return { data: mask, gridW, gridH, resolution, hasThinFeatures: filledCount >= MIN_THIN_PIXELS };
  }

  const dtInput2 = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    dtInput2[i] = eroded[i] ? 0 : INF;
  }
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

  return { data: thin, gridW, gridH, resolution, hasThinFeatures: thinCount >= MIN_THIN_PIXELS };
}

function rasterizeShapeData(
  shapes: StampShapeData[],
  stampWidth: number,
  stampHeight: number,
  resolution: number,
): { mask: Uint8Array; gridW: number; gridH: number } {
  const gridW = Math.ceil(stampWidth / resolution) + 1;
  const gridH = Math.ceil(stampHeight / resolution) + 1;
  const n = gridW * gridH;

  const canvas = document.createElement("canvas");
  canvas.width = gridW;
  canvas.height = gridH;
  const ctx = canvas.getContext("2d")!;

  ctx.clearRect(0, 0, gridW, gridH);
  ctx.fillStyle = "white";

  for (const shape of shapes) {
    if (shape.outer.length === 0) continue;
    ctx.beginPath();
    ctx.moveTo(shape.outer[0].x / resolution, shape.outer[0].y / resolution);
    for (let i = 1; i < shape.outer.length; i++) {
      ctx.lineTo(shape.outer[i].x / resolution, shape.outer[i].y / resolution);
    }
    ctx.closePath();

    for (const hole of shape.holes) {
      if (hole.length === 0) continue;
      ctx.moveTo(hole[0].x / resolution, hole[0].y / resolution);
      for (let i = 1; i < hole.length; i++) {
        ctx.lineTo(hole[i].x / resolution, hole[i].y / resolution);
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

  return { mask, gridW, gridH };
}

export function computeThinFeatureMapFromData(
  shapes: StampShapeData[],
  stampWidth: number,
  stampHeight: number,
  nozzleDiameter: number,
): ThinFeatureMap {
  const resolution = RESOLUTION;
  const { mask, gridW, gridH } = rasterizeShapeData(shapes, stampWidth, stampHeight, resolution);
  const n = gridW * gridH;

  let filledCount = 0;
  for (let i = 0; i < n; i++) {
    if (mask[i]) filledCount++;
  }
  if (filledCount === 0) {
    return { data: new Uint8Array(n), gridW, gridH, resolution, hasThinFeatures: false };
  }

  const dtInput1 = new Float32Array(n);
  for (let i = 0; i < n; i++) dtInput1[i] = mask[i] ? INF : 0;
  const sqDistToBg = squaredEDT(dtInput1, gridW, gridH);

  const rPx = nozzleDiameter / 2 / resolution;
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
    return { data: mask, gridW, gridH, resolution, hasThinFeatures: filledCount >= MIN_THIN_PIXELS };
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

  return { data: thin, gridW, gridH, resolution, hasThinFeatures: thinCount >= MIN_THIN_PIXELS };
}

export function isThinAt(map: ThinFeatureMap, x: number, y: number): boolean {
  const col = Math.round(x / map.resolution);
  const row = Math.round(y / map.resolution);
  if (col < 0 || col >= map.gridW || row < 0 || row >= map.gridH) return false;
  return map.data[row * map.gridW + col] === 1;
}