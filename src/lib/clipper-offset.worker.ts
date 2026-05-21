import ClipperLib from "clipper-lib";
import { squaredEDT, initEDT, detectThinPixels } from "./edt";

interface Point {
  x: number;
  y: number;
}

interface ShapeData {
  outer: Point[];
  holes: Point[][];
  source?: "image" | "text";
}

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
const CLIPPER_SCALE = 1000;
const MIN_AREA_SQ = 0.01 * CLIPPER_SCALE * CLIPPER_SCALE;

function toClipperPath(contour: Point[]): ClipperLib.Path {
  return contour.map((p) => ({ X: Math.round(p.x * CLIPPER_SCALE), Y: Math.round(p.y * CLIPPER_SCALE) }));
}

function fromClipperPath(path: ClipperLib.Path): Point[] {
  return path.map((p) => ({ x: p.X / CLIPPER_SCALE, y: p.Y / CLIPPER_SCALE }));
}

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

function computePathMetrics(path: ClipperLib.Path): { area: number; perimeter: number; halfWidth: number } {
  const area = Math.abs(ClipperLib.Clipper.Area(path));
  let perimeter = 0;
  for (let i = 0; i < path.length; i++) {
    const j = (i + 1) % path.length;
    const dx = path[j].X - path[i].X;
    const dy = path[j].Y - path[i].Y;
    perimeter += Math.sqrt(dx * dx + dy * dy);
  }
  const halfWidth = perimeter > 0 ? area / perimeter / CLIPPER_SCALE : 0;
  return { area, perimeter, halfWidth };
}

function thickenShapeClipper(
  shape: ShapeData,
  nozzleDiameter: number,
): ShapeData | null {
  const maxOffset = nozzleDiameter / 2;
  let modified = false;
  let newOuter = shape.outer;
  const newHoles: Point[][] = [];

  // Expand thin outer contours outward
  const outerPath = toClipperPath(shape.outer);
  const outerMetrics = computePathMetrics(outerPath);

  if (outerMetrics.area > MIN_AREA_SQ && outerMetrics.halfWidth < maxOffset) {
    const expandOffset = maxOffset - outerMetrics.halfWidth;
    if (expandOffset >= 0.01) {
      const co = new ClipperLib.ClipperOffset(2, 0.25);
      co.AddPath(outerPath, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
      const expanded: ClipperLib.Paths = [];
      co.Execute(expanded, expandOffset * CLIPPER_SCALE);

      const survived = expanded.filter((p) => Math.abs(ClipperLib.Clipper.Area(p)) > MIN_AREA_SQ);
      if (survived.length > 0) {
        let largest = survived[0];
        let largestArea = Math.abs(ClipperLib.Clipper.Area(survived[0]));
        for (let i = 1; i < survived.length; i++) {
          const a = Math.abs(ClipperLib.Clipper.Area(survived[i]));
          if (a > largestArea) { largest = survived[i]; largestArea = a; }
        }
        if (ClipperLib.Clipper.Area(largest) < 0) {
          largest.reverse();
        }
        newOuter = fromClipperPath(largest);
        modified = true;
      }
    }
  }

  // Shrink holes inward
  for (const hole of shape.holes) {
    const holePath = toClipperPath(hole);
    const holeMetrics = computePathMetrics(holePath);

    if (holeMetrics.area < MIN_AREA_SQ * 4) {
      newHoles.push(hole);
      continue;
    }

    const cappedOffset = Math.min(maxOffset, holeMetrics.halfWidth * 0.6);

    if (cappedOffset < 0.01) {
      newHoles.push(hole);
      continue;
    }

    const co = new ClipperLib.ClipperOffset(2, 0.25);
    co.AddPath(holePath, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
    const shrunk: ClipperLib.Paths = [];
    co.Execute(shrunk, -cappedOffset * CLIPPER_SCALE);

    const survived = shrunk.filter((p) => Math.abs(ClipperLib.Clipper.Area(p)) > MIN_AREA_SQ);

    if (survived.length === 0) {
      newHoles.push(hole);
    } else {
      for (const p of survived) {
        if (ClipperLib.Clipper.Area(p) > 0) {
          p.reverse();
        }
        newHoles.push(fromClipperPath(p));
      }
      modified = true;
    }
  }

  if (!modified) return null;

  return { outer: newOuter, holes: newHoles, source: shape.source };
}

self.onmessage = (e: MessageEvent<ThickenRequest>) => {
  const { shapes, stampWidth, stampHeight, nozzleDiameter, thickenEnabled, smoothEnabled: _smoothEnabled } = e.data;
  const post = self.postMessage.bind(self);

  const imageShapes = shapes.filter((s) => s.source !== "text");
  const textShapes = shapes.filter((s) => s.source === "text");

  post({ type: "progress", progress: 0, stage: "Rasterizing…" } as ThickenMessage);

  const border = Math.ceil(Math.max(nozzleDiameter / 2, GAP_CLOSE_FACTOR * nozzleDiameter) / RASTER_RESOLUTION) + 2;
  const gridW = Math.ceil(stampWidth / RASTER_RESOLUTION) + border * 2;
  const gridH = Math.ceil(stampHeight / RASTER_RESOLUTION) + border * 2;
  const n = gridW * gridH;

  const tmp = new OffscreenCanvas(gridW, gridH);
  const tctx = tmp.getContext("2d")!;

  const imageMask = new Uint8Array(n);
  for (const shape of imageShapes) {
    const sm = rasterizeShape(shape, tctx, gridW, gridH, stampHeight, border);
    for (let i = 0; i < n; i++) {
      if (sm[i]) imageMask[i] = 1;
    }
  }

  const closeRadiusPx = GAP_CLOSE_FACTOR * nozzleDiameter / RASTER_RESOLUTION;
  const closeRadiusSq = closeRadiusPx * closeRadiusPx;
  let closedImageMask: Uint8Array;
  if (imageShapes.length > 0 && closeRadiusPx >= 1) {
    post({ type: "progress", progress: 0.05, stage: "Bridging micro-gaps…" } as ThickenMessage);
    closedImageMask = morphologicalClose(imageMask, gridW, gridH, closeRadiusSq);
  } else {
    closedImageMask = imageMask;
  }

  const mask = new Uint8Array(closedImageMask);
  const textMask = new Uint8Array(n);
  for (const shape of textShapes) {
    const sm = rasterizeShape(shape, tctx, gridW, gridH, stampHeight, border);
    for (let i = 0; i < n; i++) {
      if (sm[i]) { mask[i] = 1; textMask[i] = 1; }
    }
  }

  post({ type: "progress", progress: 0.15, stage: "Computing distance fields…" } as ThickenMessage);
  const sqDistToBg = squaredEDT(initEDT(mask, n, false), gridW, gridH);

  let anyThickened = false;
  let resultImageShapes: ShapeData[] = imageShapes;

  if (thickenEnabled && imageShapes.length > 0) {
    post({ type: "progress", progress: 0.25, stage: "Finding thin features…" } as ThickenMessage);

    const radiusPx = nozzleDiameter / 2 / RASTER_RESOLUTION;
    const radiusSq = radiusPx * radiusPx;
    const thin = detectThinPixels(mask, sqDistToBg, gridW, gridH, radiusSq);

    let hasThin = false;
    for (let i = 0; i < n; i++) {
      if (thin[i] && !textMask[i]) { hasThin = true; break; }
    }

    if (hasThin) {
      post({ type: "progress", progress: 0.4, stage: "Thickening via Clipper offset…" } as ThickenMessage);

      // Determine which shapes have thin features by checking their rasterized masks
      const shapesWithThin: boolean[] = [];
      for (const shape of imageShapes) {
        const sm = rasterizeShape(shape, tctx, gridW, gridH, stampHeight, border);
        let shapeHasThin = false;
        for (let i = 0; i < n; i++) {
          if (sm[i] && thin[i]) { shapeHasThin = true; break; }
        }
        shapesWithThin.push(shapeHasThin);
      }

      const thickened: ShapeData[] = [];
      for (let si = 0; si < imageShapes.length; si++) {
        if (shapesWithThin[si]) {
          const result = thickenShapeClipper(imageShapes[si], nozzleDiameter);
          if (result) {
            thickened.push(result);
            anyThickened = true;
          } else {
            thickened.push(imageShapes[si]);
          }
        } else {
          thickened.push(imageShapes[si]);
        }
        if (si % 5 === 0) {
          post({ type: "progress", progress: 0.4 + 0.35 * (si / imageShapes.length), stage: "Thickening via Clipper offset…" } as ThickenMessage);
        }
      }

      if (anyThickened) {
        resultImageShapes = thickened;
      }
    }
  }

  post({ type: "progress", progress: 0.8, stage: "Detecting thin features…" } as ThickenMessage);

  const thinFeatureMap = anyThickened
    ? (textShapes.length > 0
        ? buildThinFeatureMap(mask, sqDistToBg, gridW, gridH, stampWidth, stampHeight, nozzleDiameter, border, textMask)
        : emptyThinFeatureMap(stampWidth, stampHeight))
    : buildThinFeatureMap(mask, sqDistToBg, gridW, gridH, stampWidth, stampHeight, nozzleDiameter, border);

  const shapesModified = anyThickened;
  const resultShapes = shapesModified
    ? [...resultImageShapes, ...textShapes]
    : [];

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
  for (const s of resultShapes) {
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
    shapes: resultShapes, bounds,
    thinFeatureMap,
  };
  self.postMessage(result, { transfer: [thinFeatureMap.pixels.buffer] } as unknown as StructuredSerializeOptions);
};
