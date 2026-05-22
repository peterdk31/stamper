import { squaredEDT, initEDT, detectThinPixels } from "./edt";
import { type Point, type ShapeData, thickenShapeClipper } from "./clipper-thicken";

interface BoundsData {
  minX: number; minY: number; maxX: number; maxY: number;
}

interface ThickenRequest {
  shapes: ShapeData[];
  stampWidth: number;
  stampHeight: number;
  nozzleDiameter: number;
  thickenEnabled: boolean;
  smoothEnabled: boolean;
}

interface ThinFeatureMapData {
  hasThinFeatures: boolean;
  pixels: Uint8Array;
  gridW: number;
  gridH: number;
}

type ThickenMessage =
  | { type: "progress"; progress: number; stage: string }
  | { type: "result"; shapesModified: boolean; shapes: ShapeData[]; bounds: BoundsData; thinFeatureMap: ThinFeatureMapData };

const DETECT_RESOLUTION = 0.1;
const RASTER_RESOLUTION = 0.05;
const MIN_THIN_PIXELS = 20;
const GAP_CLOSE_FACTOR = 0.14;

function rasterizeShape(
  shape: ShapeData,
  tctx: OffscreenCanvasRenderingContext2D,
  gridW: number,
  gridH: number,
  stampHeight: number,
  border: number,
): Uint8Array {
  const n = gridW * gridH;
  tctx.clearRect(0, 0, gridW, gridH);
  if (shape.outer.length === 0) return new Uint8Array(n);

  tctx.globalCompositeOperation = "source-over";
  tctx.fillStyle = "white";
  tctx.beginPath();
  tctx.moveTo(shape.outer[0].x / RASTER_RESOLUTION + border, (stampHeight - shape.outer[0].y) / RASTER_RESOLUTION + border);
  for (let i = 1; i < shape.outer.length; i++) {
    tctx.lineTo(shape.outer[i].x / RASTER_RESOLUTION + border, (stampHeight - shape.outer[i].y) / RASTER_RESOLUTION + border);
  }
  tctx.closePath();
  tctx.fill();

  if (shape.holes.length > 0) {
    tctx.globalCompositeOperation = "destination-out";
    for (const hole of shape.holes) {
      if (hole.length === 0) continue;
      tctx.beginPath();
      tctx.moveTo(hole[0].x / RASTER_RESOLUTION + border, (stampHeight - hole[0].y) / RASTER_RESOLUTION + border);
      for (let i = 1; i < hole.length; i++) {
        tctx.lineTo(hole[i].x / RASTER_RESOLUTION + border, (stampHeight - hole[i].y) / RASTER_RESOLUTION + border);
      }
      tctx.closePath();
      tctx.fill();
    }
  }

  const imageData = tctx.getImageData(0, 0, gridW, gridH);
  const shapeMask = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    shapeMask[i] = imageData.data[i * 4] > 128 ? 1 : 0;
  }
  return shapeMask;
}

function morphologicalClose(
  mask: Uint8Array,
  gridW: number,
  gridH: number,
  closeRadiusSq: number,
): Uint8Array {
  const n = gridW * gridH;
  const sqDistToFg = squaredEDT(initEDT(mask, n, true), gridW, gridH);
  const dilated = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (sqDistToFg[i] <= closeRadiusSq) dilated[i] = 1;
  }
  const sqDistToBgInDilated = squaredEDT(initEDT(dilated, n, false), gridW, gridH);
  const closed = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (mask[i] || sqDistToBgInDilated[i] > closeRadiusSq) closed[i] = 1;
  }
  return closed;
}

function buildThinFeatureMap(
  finalMask: Uint8Array,
  sqDistToBg: Float32Array,
  gridW: number,
  gridH: number,
  stampWidth: number,
  stampHeight: number,
  nozzleDiameter: number,
  border: number,
  restrictMask?: Uint8Array,
): ThinFeatureMapData {
  const n = gridW * gridH;
  const rPx = nozzleDiameter / 2 / RASTER_RESOLUTION;
  const radiusSq = rPx * rPx;
  const thin = detectThinPixels(finalMask, sqDistToBg, gridW, gridH, radiusSq);

  if (restrictMask) {
    for (let i = 0; i < n; i++) {
      if (!restrictMask[i]) thin[i] = 0;
    }
  }

  let thinCount = 0;
  for (let i = 0; i < n; i++) if (thin[i]) thinCount++;
  const hasThinFeatures = thinCount >= MIN_THIN_PIXELS;

  const outW = Math.ceil(stampWidth / DETECT_RESOLUTION) + 1;
  const outH = Math.ceil(stampHeight / DETECT_RESOLUTION) + 1;
  const pixels = new Uint8Array(outW * outH * 4);

  if (hasThinFeatures) {
    for (let oy = 0; oy < outH; oy++) {
      const mmY = oy * DETECT_RESOLUTION;
      const gy = Math.round((stampHeight - mmY) / RASTER_RESOLUTION) + border;
      for (let ox = 0; ox < outW; ox++) {
        const mmX = ox * DETECT_RESOLUTION;
        const gx = Math.round(mmX / RASTER_RESOLUTION) + border;
        if (gx >= 0 && gx < gridW && gy >= 0 && gy < gridH) {
          if (thin[gy * gridW + gx]) {
            const idx = (oy * outW + ox) * 4;
            pixels[idx] = 230;
            pixels[idx + 1] = 38;
            pixels[idx + 2] = 38;
            pixels[idx + 3] = 255;
          }
        }
      }
    }
  }

  return { hasThinFeatures, pixels, gridW: outW, gridH: outH };
}

function emptyThinFeatureMap(stampWidth: number, stampHeight: number): ThinFeatureMapData {
  const outW = Math.ceil(stampWidth / DETECT_RESOLUTION) + 1;
  const outH = Math.ceil(stampHeight / DETECT_RESOLUTION) + 1;
  return {
    hasThinFeatures: false,
    pixels: new Uint8Array(outW * outH * 4),
    gridW: outW,
    gridH: outH,
  };
}

self.onmessage = (e: MessageEvent<ThickenRequest>) => {
  const { shapes, stampWidth, stampHeight, nozzleDiameter, thickenEnabled, smoothEnabled: _smoothEnabled } = e.data;
  const post = self.postMessage.bind(self);

  post({ type: "progress", progress: 0, stage: "Rasterizing…" } as ThickenMessage);

  const border = Math.ceil(Math.max(nozzleDiameter / 2, GAP_CLOSE_FACTOR * nozzleDiameter) / RASTER_RESOLUTION) + 2;
  const gridW = Math.ceil(stampWidth / RASTER_RESOLUTION) + border * 2;
  const gridH = Math.ceil(stampHeight / RASTER_RESOLUTION) + border * 2;
  const n = gridW * gridH;

  const tmp = new OffscreenCanvas(gridW, gridH);
  const tctx = tmp.getContext("2d")!;

  const allMask = new Uint8Array(n);
  for (const shape of shapes) {
    const sm = rasterizeShape(shape, tctx, gridW, gridH, stampHeight, border);
    for (let i = 0; i < n; i++) {
      if (sm[i]) allMask[i] = 1;
    }
  }

  const closeRadiusPx = GAP_CLOSE_FACTOR * nozzleDiameter / RASTER_RESOLUTION;
  const closeRadiusSq = closeRadiusPx * closeRadiusPx;
  let mask: Uint8Array;
  if (shapes.length > 0 && closeRadiusPx >= 1) {
    post({ type: "progress", progress: 0.05, stage: "Bridging micro-gaps…" } as ThickenMessage);
    mask = morphologicalClose(allMask, gridW, gridH, closeRadiusSq);
  } else {
    mask = allMask;
  }

  post({ type: "progress", progress: 0.15, stage: "Computing distance fields…" } as ThickenMessage);
  const sqDistToBg = squaredEDT(initEDT(mask, n, false), gridW, gridH);

  let anyThickened = false;
  let resultShapes: ShapeData[] = shapes;

  if (thickenEnabled && shapes.length > 0) {
    post({ type: "progress", progress: 0.25, stage: "Finding thin features…" } as ThickenMessage);

    const radiusPx = nozzleDiameter / 2 / RASTER_RESOLUTION;
    const radiusSq = radiusPx * radiusPx;
    const thin = detectThinPixels(mask, sqDistToBg, gridW, gridH, radiusSq);

    let hasThin = false;
    for (let i = 0; i < n; i++) {
      if (thin[i]) { hasThin = true; break; }
    }

    if (hasThin) {
      post({ type: "progress", progress: 0.4, stage: "Thickening via Clipper offset…" } as ThickenMessage);

      const MIN_THIN_PER_SHAPE = 10;
      const shapeThinInfo: { hasThin: boolean; minHalfWidth: number }[] = [];
      for (const shape of shapes) {
        const sm = rasterizeShape(shape, tctx, gridW, gridH, stampHeight, border);
        let thinCount = 0;
        let maxSqDistInThin = 0;
        for (let i = 0; i < n; i++) {
          if (sm[i] && thin[i]) {
            thinCount++;
            if (sqDistToBg[i] > maxSqDistInThin) maxSqDistInThin = sqDistToBg[i];
          }
        }
        const minHalfWidth = thinCount > 0
          ? Math.sqrt(maxSqDistInThin) * RASTER_RESOLUTION
          : nozzleDiameter;
        shapeThinInfo.push({
          hasThin: thinCount >= MIN_THIN_PER_SHAPE,
          minHalfWidth,
        });
      }

      const thickened: ShapeData[] = [];
      for (let si = 0; si < shapes.length; si++) {
        if (shapeThinInfo[si].hasThin) {
          const result = thickenShapeClipper(
            shapes[si], nozzleDiameter, shapeThinInfo[si].minHalfWidth,
          );
          if (result) {
            thickened.push(result);
            anyThickened = true;
          } else {
            thickened.push(shapes[si]);
          }
        } else {
          thickened.push(shapes[si]);
        }
        if (si % 5 === 0) {
          post({ type: "progress", progress: 0.4 + 0.35 * (si / shapes.length), stage: "Thickening via Clipper offset…" } as ThickenMessage);
        }
      }

      if (anyThickened) {
        resultShapes = thickened;
      }
    }
  }

  post({ type: "progress", progress: 0.8, stage: "Detecting thin features…" } as ThickenMessage);

  const thinFeatureMap = anyThickened
    ? emptyThinFeatureMap(stampWidth, stampHeight)
    : buildThinFeatureMap(mask, sqDistToBg, gridW, gridH, stampWidth, stampHeight, nozzleDiameter, border);

  const shapesModified = anyThickened;
  const finalShapes = shapesModified ? resultShapes : [];

  if (!shapesModified) {
    post({ type: "progress", progress: 1.0, stage: "Done" } as ThickenMessage);
    const noChangeResult: ThickenMessage = {
      type: "result", shapesModified: false,
      shapes: [], bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
      thinFeatureMap,
    };
    self.postMessage(noChangeResult, { transfer: [thinFeatureMap.pixels.buffer] } as unknown as StructuredSerializeOptions);
    return;
  }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of finalShapes) {
    for (const p of s.outer) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  const bounds: BoundsData = minX === Infinity
    ? { minX: 0, minY: 0, maxX: 0, maxY: 0 }
    : { minX, minY, maxX, maxY };

  post({ type: "progress", progress: 1.0, stage: "Done" } as ThickenMessage);
  const result: ThickenMessage = {
    type: "result", shapesModified: true,
    shapes: finalShapes, bounds,
    thinFeatureMap,
  };
  self.postMessage(result, { transfer: [thinFeatureMap.pixels.buffer] } as unknown as StructuredSerializeOptions);
};
