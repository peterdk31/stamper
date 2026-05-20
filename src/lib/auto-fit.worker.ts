import { squaredEDT, initEDT, detectThinPixels } from "./edt";

interface Point { x: number; y: number }

interface ShapeData {
  outer: Point[];
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

const RESOLUTION = 0.1;
const MARGIN_MM = 2;
const MIN_THIN_PIXELS = 20;

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
    if (shape.outer.length === 0) continue;
    ctx.beginPath();
    ctx.moveTo(
      shape.outer[0].x * scale / RESOLUTION + marginPx,
      shape.outer[0].y * scale / RESOLUTION + marginPx,
    );
    for (let i = 1; i < shape.outer.length; i++) {
      ctx.lineTo(
        shape.outer[i].x * scale / RESOLUTION + marginPx,
        shape.outer[i].y * scale / RESOLUTION + marginPx,
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

  const sqDistToBg = squaredEDT(initEDT(mask, n, false), gridW, gridH);

  const rPx = nozzleDiameter / 2 / RESOLUTION;
  const radiusSq = rPx * rPx;

  const thin = detectThinPixels(mask, sqDistToBg, gridW, gridH, radiusSq);

  let thinCount = 0;
  for (let i = 0; i < n; i++) {
    if (thin[i]) {
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
