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

export interface ThickenRequest {
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

export type ThickenMessage =
  | { type: "progress"; progress: number; stage: string }
  | { type: "result"; shapesModified: boolean; shapes: ShapeData[]; bounds: BoundsData; thinFeatureMap: ThinFeatureMapData };

const RESOLUTION = 0.05; // mm per pixel
const DETECT_RESOLUTION = 0.1; // mm per pixel for thin-feature texture
const MIN_THIN_PIXELS = 20;

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

function resampleContour(points: Point[], maxSegLen: number): Point[] {
  if (points.length < 2) return points;
  const result: Point[] = [];
  for (let i = 0; i < points.length; i++) {
    const p0 = points[i];
    const p1 = points[(i + 1) % points.length];
    result.push(p0);
    const dx = p1.x - p0.x;
    const dy = p1.y - p0.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > maxSegLen) {
      const segments = Math.ceil(dist / maxSegLen);
      for (let j = 1; j < segments; j++) {
        const t = j / segments;
        result.push({ x: p0.x + dx * t, y: p0.y + dy * t });
      }
    }
  }
  return result;
}

function taubinSmooth(points: Point[], iterations: number): Point[] {
  if (points.length < 3) return points;
  const lambda = 0.5;
  const mu = -0.53;
  const n = points.length;
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  for (let i = 0; i < n; i++) { xs[i] = points[i].x; ys[i] = points[i].y; }

  for (let iter = 0; iter < iterations; iter++) {
    const factor = iter % 2 === 0 ? lambda : mu;
    const nx = new Float64Array(n);
    const ny = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const prev = (i - 1 + n) % n;
      const next = (i + 1) % n;
      const lx = (xs[prev] + xs[next]) / 2 - xs[i];
      const ly = (ys[prev] + ys[next]) / 2 - ys[i];
      nx[i] = xs[i] + factor * lx;
      ny[i] = ys[i] + factor * ly;
    }
    for (let i = 0; i < n; i++) { xs[i] = nx[i]; ys[i] = ny[i]; }
  }

  const result: Point[] = new Array(n);
  for (let i = 0; i < n; i++) result[i] = { x: xs[i], y: ys[i] };
  return result;
}

function nestContoursToShapes(contours: Point[][]): ShapeData[] {
  if (contours.length === 0) return [];

  const indexed = contours.map((c, i) => ({
    contour: c,
    absArea: Math.abs(signedArea(c)),
    index: i,
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
      if (parentShape) parentShape.holes.push(pts);
    }
  }

  return shapes;
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
  const rPx = nozzleDiameter / 2 / RESOLUTION;
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
      const gy = Math.round((stampHeight - mmY) / RESOLUTION) + border;
      for (let ox = 0; ox < outW; ox++) {
        const mmX = ox * DETECT_RESOLUTION;
        const gx = Math.round(mmX / RESOLUTION) + border;
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
  tctx.moveTo(shape.outer[0].x / RESOLUTION + border, (stampHeight - shape.outer[0].y) / RESOLUTION + border);
  for (let i = 1; i < shape.outer.length; i++) {
    tctx.lineTo(shape.outer[i].x / RESOLUTION + border, (stampHeight - shape.outer[i].y) / RESOLUTION + border);
  }
  tctx.closePath();
  tctx.fill();

  if (shape.holes.length > 0) {
    tctx.globalCompositeOperation = "destination-out";
    for (const hole of shape.holes) {
      if (hole.length === 0) continue;
      tctx.beginPath();
      tctx.moveTo(hole[0].x / RESOLUTION + border, (stampHeight - hole[0].y) / RESOLUTION + border);
      for (let i = 1; i < hole.length; i++) {
        tctx.lineTo(hole[i].x / RESOLUTION + border, (stampHeight - hole[i].y) / RESOLUTION + border);
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

function traceAndSimplify(
  grid: Uint8Array,
  gridW: number,
  gridH: number,
  stampHeight: number,
  smoothEnabled: boolean,
  border: number,
): ShapeData[] {
  const rawContours = marchingSquares(grid, gridW, gridH);

  const MIN_CONTOUR_AREA = 4;
  const DEDUP_SQ = RESOLUTION * RESOLUTION * 0.25;

  const contours: Point[][] = [];
  for (const contour of rawContours) {
    if (Math.abs(signedArea(contour)) < MIN_CONTOUR_AREA) continue;

    const s = simplifyContour(contour, 0.5);
    if (s.length < 3) continue;

    const mm = s.map((p) => ({
      x: (p.x - border) * RESOLUTION,
      y: stampHeight - (p.y - border) * RESOLUTION,
    }));

    const clean: Point[] = [mm[0]];
    for (let i = 1; i < mm.length; i++) {
      const prev = clean[clean.length - 1];
      const dx = mm[i].x - prev.x;
      const dy = mm[i].y - prev.y;
      if (dx * dx + dy * dy > DEDUP_SQ) clean.push(mm[i]);
    }
    if (clean.length >= 3) contours.push(clean);
  }

  const TAUBIN_ITERATIONS = 12;
  const RESAMPLE_MAX_SEG = 0.3;
  const finalContours = smoothEnabled
    ? contours.map((c) => taubinSmooth(resampleContour(c, RESAMPLE_MAX_SEG), TAUBIN_ITERATIONS))
    : contours;

  return nestContoursToShapes(finalContours);
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
  const { shapes, stampWidth, stampHeight, nozzleDiameter, thickenEnabled, smoothEnabled } = e.data;
  const post = self.postMessage.bind(self);

  const imageShapes = shapes.filter((s) => s.source !== "text");
  const textShapes = shapes.filter((s) => s.source === "text");

  post({ type: "progress", progress: 0, stage: "Rasterizing…" } as ThickenMessage);

  const border = Math.ceil(nozzleDiameter / 2 / RESOLUTION) + 2;
  const gridW = Math.ceil(stampWidth / RESOLUTION) + border * 2;
  const gridH = Math.ceil(stampHeight / RESOLUTION) + border * 2;
  const n = gridW * gridH;

  const tmp = new OffscreenCanvas(gridW, gridH);
  const tctx = tmp.getContext("2d")!;

  const shapeMasks: Uint8Array[] = [];
  const imageMask = new Uint8Array(n);
  for (const shape of imageShapes) {
    const sm = rasterizeShape(shape, tctx, gridW, gridH, stampHeight, border);
    shapeMasks.push(sm);
    for (let i = 0; i < n; i++) {
      if (sm[i]) imageMask[i] = 1;
    }
  }

  const mask = new Uint8Array(imageMask);
  const textMask = new Uint8Array(n);
  for (const shape of textShapes) {
    const sm = rasterizeShape(shape, tctx, gridW, gridH, stampHeight, border);
    for (let i = 0; i < n; i++) {
      if (sm[i]) { mask[i] = 1; textMask[i] = 1; }
    }
  }

  post({ type: "progress", progress: 0.15, stage: "Computing distance fields…" } as ThickenMessage);

  const sqDistToBg = squaredEDT(initEDT(mask, n, false), gridW, gridH);

  // Build skeleton for thin-feature thickening (computed globally, applied per-group)
  let skeleton: Uint8Array | null = null;
  let radiusSq = 0;
  if (thickenEnabled) {
    post({ type: "progress", progress: 0.25, stage: "Finding thin features…" } as ThickenMessage);

    const radiusPx = nozzleDiameter / 2 / RESOLUTION;
    radiusSq = radiusPx * radiusPx;
    const thin = detectThinPixels(mask, sqDistToBg, gridW, gridH, radiusSq);

    const skel = new Uint8Array(n);
    let hasSkeleton = false;
    for (let y = 0; y < gridH; y++) {
      for (let x = 0; x < gridW; x++) {
        const i = y * gridW + x;
        if (!thin[i] || textMask[i]) continue;

        const val = sqDistToBg[i];
        let isMax = true;
        for (let dy = -1; dy <= 1 && isMax; dy++) {
          for (let dx = -1; dx <= 1 && isMax; dx++) {
            if (dx === 0 && dy === 0) continue;
            const ny = y + dy, nx = x + dx;
            if (ny < 0 || ny >= gridH || nx < 0 || nx >= gridW) continue;
            const ni = ny * gridW + nx;
            if (mask[ni] && sqDistToBg[ni] > val) isMax = false;
          }
        }
        if (isMax) { skel[i] = 1; hasSkeleton = true; }
      }
    }

    if (hasSkeleton) skeleton = skel;
  }

  // Detect overlapping shapes via union-find — only merge groups that
  // share boundary pixels (coincident walls), keep isolated shapes as-is
  // to preserve thin gaps between them
  post({ type: "progress", progress: 0.5, stage: "Analyzing shape boundaries…" } as ThickenMessage);

  const uf = new Int16Array(imageShapes.length);
  for (let i = 0; i < uf.length; i++) uf[i] = i;
  const ufFind = (x: number): number => {
    while (uf[x] !== x) { uf[x] = uf[uf[x]]; x = uf[x]; }
    return x;
  };
  const ufUnion = (a: number, b: number) => {
    const ra = ufFind(a), rb = ufFind(b);
    if (ra !== rb) uf[ra] = rb;
  };

  if (imageShapes.length > 1) {
    const firstOwner = new Int16Array(n).fill(-1);
    for (let si = 0; si < shapeMasks.length; si++) {
      const sm = shapeMasks[si];
      for (let i = 0; i < n; i++) {
        if (!sm[i]) continue;
        if (firstOwner[i] === -1) {
          firstOwner[i] = si;
        } else {
          ufUnion(firstOwner[i], si);
        }
      }
    }
  }

  const groups = new Map<number, number[]>();
  for (let si = 0; si < imageShapes.length; si++) {
    const root = ufFind(si);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(si);
  }

  // Process each overlap group: merge multi-shape groups via retrace,
  // apply per-group thickening with gap exclusion, keep untouched singletons as-is
  let anyMerge = false;
  let anyThicken = false;
  const mergedImageShapes: ShapeData[] = [];

  for (const [, members] of groups) {
    const groupMask = new Uint8Array(n);
    for (const si of members) {
      const sm = shapeMasks[si];
      for (let i = 0; i < n; i++) {
        if (sm[i]) groupMask[i] = 1;
      }
    }

    let groupThickened = false;
    if (skeleton) {
      let hasGroupSkel = false;
      const groupSkel = new Uint8Array(n);
      for (let i = 0; i < n; i++) {
        if (skeleton[i] && groupMask[i]) { groupSkel[i] = 1; hasGroupSkel = true; }
      }
      if (hasGroupSkel) {
        post({ type: "progress", progress: 0.55, stage: "Thickening…" } as ThickenMessage);
        const sqDist = squaredEDT(initEDT(groupSkel, n, true), gridW, gridH);

        // Compute distance to other groups' shapes so dilation doesn't
        // extend into gaps between separate design elements
        const otherMask = new Uint8Array(n);
        let hasOther = false;
        for (let i = 0; i < n; i++) {
          if (imageMask[i] && !groupMask[i]) { otherMask[i] = 1; hasOther = true; }
        }
        const sqDistToOther = hasOther
          ? squaredEDT(initEDT(otherMask, n, true), gridW, gridH)
          : null;

        for (let i = 0; i < n; i++) {
          if (!groupMask[i] && !textMask[i] && sqDist[i] <= radiusSq) {
            if (!sqDistToOther || sqDistToOther[i] > radiusSq) {
              groupMask[i] = 1;
              groupThickened = true;
            }
          }
        }
        if (groupThickened) anyThicken = true;
      }
    }

    if (members.length > 1 || groupThickened) {
      anyMerge = true;
      mergedImageShapes.push(
        ...traceAndSimplify(groupMask, gridW, gridH, stampHeight, smoothEnabled, border),
      );
    } else {
      mergedImageShapes.push(imageShapes[members[0]]);
    }
  }

  let resultShapes: ShapeData[];
  let shapesModified: boolean;
  if (anyMerge) {
    resultShapes = [...mergedImageShapes, ...textShapes];
    shapesModified = true;
  } else {
    resultShapes = [];
    shapesModified = false;
  }

  post({ type: "progress", progress: 0.8, stage: "Detecting thin features…" } as ThickenMessage);
  const thinFeatureMap = anyThicken
    ? (textShapes.length > 0
        ? buildThinFeatureMap(mask, sqDistToBg, gridW, gridH, stampWidth, stampHeight, nozzleDiameter, border, textMask)
        : emptyThinFeatureMap(stampWidth, stampHeight))
    : buildThinFeatureMap(mask, sqDistToBg, gridW, gridH, stampWidth, stampHeight, nozzleDiameter, border);

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
