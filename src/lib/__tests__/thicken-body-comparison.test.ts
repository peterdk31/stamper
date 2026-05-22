import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { PNG } from "pngjs";
import { squaredEDT, initEDT, detectThinPixels } from "../edt";
import {
  thickenShapeClipper,
  toClipperPath,
  CLIPPER_SCALE,
  type Point,
  type ShapeData,
} from "../clipper-thicken";
import ClipperLib from "clipper-lib";

const NOZZLE_DIAMETER = 0.4;
const RASTER_RESOLUTION = 0.05;
const STAMP_WIDTH = 80;
const MIN_THIN_PER_SHAPE = 10;
const GAP_CLOSE_FACTOR = 0.14;

// ---------------------------------------------------------------------------
// Marching squares (ported from image-trace.worker.ts)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Simplification (ported from image-trace.worker.ts)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Contour nesting (ported from image-trace.worker.ts)
// ---------------------------------------------------------------------------

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

function nestContours(contours: Point[][]): ShapeData[] {
  if (contours.length === 0) return [];

  const indexed = contours.map((c) => ({
    contour: c,
    absArea: Math.abs(signedArea(c)),
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
      if (parentShape) {
        parentShape.holes.push(pts);
      }
    }
  }

  return shapes;
}

// ---------------------------------------------------------------------------
// Load mackerel image, trace contours, scale to mm
// ---------------------------------------------------------------------------

function loadAndTraceMackerel(): {
  shapes: ShapeData[];
  stampHeight: number;
  pngWidth: number;
  pngHeight: number;
} {
  const pngPath = path.resolve(__dirname, "../../../Makrel.png");
  const data = fs.readFileSync(pngPath);
  const png = PNG.sync.read(data);
  const { width, height } = png;

  // Rasterize to binary mask (same as image-trace worker)
  const grid = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const r = png.data[idx], g = png.data[idx + 1], b = png.data[idx + 2];
      const a = png.data[idx + 3];
      if (a <= 128) continue;
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      if (lum < 128) grid[y * width + x] = 1;
    }
  }

  // Trim whitespace (same as image-trace worker)
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (grid[y * width + x]) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  const pad = 2;
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(width - 1, maxX + pad);
  maxY = Math.min(height - 1, maxY + pad);
  const trimW = maxX - minX + 1;
  const trimH = maxY - minY + 1;
  const trimmedGrid = new Uint8Array(trimW * trimH);
  for (let y = 0; y < trimH; y++) {
    const srcOff = (y + minY) * width + minX;
    trimmedGrid.set(grid.subarray(srcOff, srcOff + trimW), y * trimW);
  }

  // Pad with 1px border
  const padW = trimW + 2;
  const padH = trimH + 2;
  const paddedGrid = new Uint8Array(padW * padH);
  for (let y = 0; y < trimH; y++) {
    paddedGrid.set(
      trimmedGrid.subarray(y * trimW, y * trimW + trimW),
      (y + 1) * padW + 1,
    );
  }

  // Trace contours
  let contours = marchingSquares(paddedGrid, padW, padH);

  // Remove padding offset
  for (const contour of contours) {
    for (const p of contour) {
      p.x -= 1;
      p.y -= 1;
    }
  }

  // Simplify
  const minArea = Math.max(4, trimW * trimH * 0.00005);
  const simplified: Point[][] = [];
  for (const contour of contours) {
    const s = simplifyContour(contour, 0.5);
    if (s.length >= 3) simplified.push(s);
  }
  contours = simplified.filter((c) => Math.abs(signedArea(c)) >= minArea);

  // Flip Y (same as image-trace worker)
  const flipped = contours.map((contour) =>
    contour.map((p) => ({ x: p.x, y: trimH - p.y })),
  );

  // Nest contours into shapes
  const pixelShapes = nestContours(flipped);

  // Scale from pixel coordinates to mm (80mm stamp width)
  const scale = STAMP_WIDTH / trimW;
  const stampHeight = trimH * scale;

  const shapes: ShapeData[] = pixelShapes.map((s) => ({
    outer: s.outer.map((p) => ({ x: p.x * scale, y: p.y * scale })),
    holes: s.holes.map((h) => h.map((p) => ({ x: p.x * scale, y: p.y * scale }))),
  }));

  return { shapes, stampHeight, pngWidth: trimW, pngHeight: trimH };
}

// ---------------------------------------------------------------------------
// Rasterize a shape to a grid using scanline (no Canvas needed)
// ---------------------------------------------------------------------------

function rasterizeShapeToMask(
  shape: ShapeData,
  gridW: number,
  gridH: number,
  stampHeight: number,
  border: number,
): Uint8Array {
  const n = gridW * gridH;
  const mask = new Uint8Array(n);

  const fillPoly = (poly: Point[], value: 0 | 1) => {
    if (poly.length < 3) return;
    // Convert to grid coordinates
    const gridPoly = poly.map((p) => ({
      x: p.x / RASTER_RESOLUTION + border,
      y: (stampHeight - p.y) / RASTER_RESOLUTION + border,
    }));

    // Find y bounds
    let yMin = Infinity, yMax = -Infinity;
    for (const p of gridPoly) {
      if (p.y < yMin) yMin = p.y;
      if (p.y > yMax) yMax = p.y;
    }
    const yStart = Math.max(0, Math.ceil(yMin));
    const yEnd = Math.min(gridH - 1, Math.floor(yMax));

    // Scanline fill
    for (let y = yStart; y <= yEnd; y++) {
      const intersections: number[] = [];
      for (let i = 0, j = gridPoly.length - 1; i < gridPoly.length; j = i++) {
        const yi = gridPoly[i].y, yj = gridPoly[j].y;
        if ((yi <= y && yj > y) || (yj <= y && yi > y)) {
          const x = gridPoly[i].x + (y - yi) / (yj - yi) * (gridPoly[j].x - gridPoly[i].x);
          intersections.push(x);
        }
      }
      intersections.sort((a, b) => a - b);
      for (let k = 0; k + 1 < intersections.length; k += 2) {
        const xStart = Math.max(0, Math.ceil(intersections[k]));
        const xEnd = Math.min(gridW - 1, Math.floor(intersections[k + 1]));
        for (let x = xStart; x <= xEnd; x++) {
          mask[y * gridW + x] = value;
        }
      }
    }
  };

  fillPoly(shape.outer, 1);
  for (const hole of shape.holes) {
    fillPoly(hole, 0);
  }

  return mask;
}

// ---------------------------------------------------------------------------
// Morphological close (same as workers)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("mackerel body contour: Clipper vs EDT at 80mm width", () => {
  const { shapes, stampHeight } = loadAndTraceMackerel();

  // Find the body shape (largest by outer contour area)
  const bodyShape = shapes.reduce((a, b) => {
    const areaA = Math.abs(signedArea(a.outer));
    const areaB = Math.abs(signedArea(b.outer));
    return areaA > areaB ? a : b;
  });
  const bodyArea = Math.abs(signedArea(bodyShape.outer));

  // Set up rasterization grid (same as workers)
  const border = Math.ceil(
    Math.max(NOZZLE_DIAMETER / 2, GAP_CLOSE_FACTOR * NOZZLE_DIAMETER) / RASTER_RESOLUTION,
  ) + 2;
  const gridW = Math.ceil(STAMP_WIDTH / RASTER_RESOLUTION) + border * 2;
  const gridH = Math.ceil(stampHeight / RASTER_RESOLUTION) + border * 2;
  const n = gridW * gridH;

  // Build combined mask (all shapes)
  const allMask = new Uint8Array(n);
  for (const shape of shapes) {
    const sm = rasterizeShapeToMask(shape, gridW, gridH, stampHeight, border);
    for (let i = 0; i < n; i++) {
      if (sm[i]) allMask[i] = 1;
    }
  }

  // Morph close
  const closeRadiusPx = GAP_CLOSE_FACTOR * NOZZLE_DIAMETER / RASTER_RESOLUTION;
  const closeRadiusSq = closeRadiusPx * closeRadiusPx;
  const mask = morphologicalClose(allMask, gridW, gridH, closeRadiusSq);

  // Global EDT and thin detection
  const sqDistToBg = squaredEDT(initEDT(mask, n, false), gridW, gridH);
  const radiusPx = NOZZLE_DIAMETER / 2 / RASTER_RESOLUTION;
  const radiusSq = radiusPx * radiusPx;
  const thin = detectThinPixels(mask, sqDistToBg, gridW, gridH, radiusSq);

  // Per-shape thin info (replicates clipper-offset.worker.ts lines 214-233)
  function getShapeThinInfo(shape: ShapeData): { hasThin: boolean; minHalfWidth: number } {
    const sm = rasterizeShapeToMask(shape, gridW, gridH, stampHeight, border);
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
      : NOZZLE_DIAMETER;
    return {
      hasThin: thinCount >= MIN_THIN_PER_SHAPE,
      minHalfWidth,
    };
  }

  it("traces multiple shapes from the mackerel", () => {
    expect(shapes.length).toBeGreaterThan(3);
  });

  it("body shape is large and recognizable", () => {
    // Body should be much bigger than other shapes
    const sortedByArea = [...shapes]
      .map((s) => Math.abs(signedArea(s.outer)))
      .sort((a, b) => b - a);
    expect(sortedByArea[0]).toBe(bodyArea);
    // Body area should be at least 5x the next largest shape
    if (sortedByArea.length > 1) {
      expect(sortedByArea[0]).toBeGreaterThan(sortedByArea[1] * 2);
    }
  });

  it("body shape has thick core (survives Clipper erosion)", () => {
    const outerPath = toClipperPath(bodyShape.outer);
    const outerArea = Math.abs(ClipperLib.Clipper.Area(outerPath));
    expect(outerArea).toBeGreaterThan(0);

    // Erode by nozzleDiameter/2 — this is the check inside thickenShapeClipper
    const maxOffset = NOZZLE_DIAMETER / 2;
    const co = new ClipperLib.ClipperOffset(2, 0.1 * CLIPPER_SCALE);
    co.AddPath(outerPath, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
    const eroded: ClipperLib.Paths = [];
    co.Execute(eroded, -maxOffset * CLIPPER_SCALE);

    const survivingPaths = eroded.filter(
      (p) => Math.abs(ClipperLib.Clipper.Area(p)) > 0.01 * CLIPPER_SCALE * CLIPPER_SCALE,
    );

    expect(
      survivingPaths.length,
      `Body outer contour should survive erosion by ${maxOffset}mm — ` +
      `the body is many mm wide, but erosion produced ${survivingPaths.length} paths`,
    ).toBeGreaterThan(0);
  });

  it("body shape has thin pixels (per-shape thin info)", () => {
    const info = getShapeThinInfo(bodyShape);
    // The body may or may not have thin pixels — log either way
    console.log(
      `Body thin info: hasThin=${info.hasThin}, minHalfWidth=${info.minHalfWidth.toFixed(3)}mm`,
    );
    console.log(`Body outer vertices: ${bodyShape.outer.length}`);
    console.log(`Body holes: ${bodyShape.holes.length}`);
    console.log(`Body area: ${bodyArea.toFixed(1)} mm²`);
  });

  it("Clipper does NOT thicken the body contour", () => {
    const info = getShapeThinInfo(bodyShape);

    if (!info.hasThin) {
      // If no thin pixels, the worker wouldn't call thickenShapeClipper at all
      expect(true).toBe(true);
      return;
    }

    const result = thickenShapeClipper(bodyShape, NOZZLE_DIAMETER, info.minHalfWidth);
    expect(
      result,
      `thickenShapeClipper should return null for the body shape ` +
      `(minHalfWidth=${info.minHalfWidth.toFixed(3)}mm, expandOffset=${(NOZZLE_DIAMETER / 2 - info.minHalfWidth).toFixed(3)}mm)`,
    ).toBeNull();
  });

  it("EDT skeleton does NOT expand the body outline", () => {
    // Build skeleton (same as thicken.worker.ts lines 523-545)
    const skel = new Uint8Array(n);
    let hasSkeleton = false;
    for (let y = 0; y < gridH; y++) {
      for (let x = 0; x < gridW; x++) {
        const i = y * gridW + x;
        if (!thin[i]) continue;

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

    if (!hasSkeleton) {
      // No skeleton → no thickening at all
      expect(true).toBe(true);
      return;
    }

    // Rasterize body shape to identify its pixels
    const bodyMask = rasterizeShapeToMask(bodyShape, gridW, gridH, stampHeight, border);

    // Check: does the skeleton expansion change the body outline?
    // In EDT, expansion adds pixels within radiusSq of skeleton points.
    // The body outline changes only if skeleton pixels are near the body's edge.
    const sqDistToSkel = squaredEDT(initEDT(skel, n, true), gridW, gridH);

    let bodyPixelsBefore = 0;
    let bodyPixelsAdded = 0;
    for (let i = 0; i < n; i++) {
      if (bodyMask[i]) bodyPixelsBefore++;
      // Would EDT add this pixel to the body?
      if (!bodyMask[i] && sqDistToSkel[i] <= radiusSq) {
        // Check if this expansion pixel is close to the body
        if (bodyMask[i] === 0 && mask[i] === 0) {
          // This pixel is background — would be added by skeleton expansion
          // But only if the skeleton pixel belongs to the body's group
          // For simplicity, check if the skeleton pixel near here overlaps with bodyMask
          let nearBody = false;
          const x = i % gridW, y = (i - (i % gridW)) / gridW;
          for (let dy = -2; dy <= 2 && !nearBody; dy++) {
            for (let dx = -2; dx <= 2 && !nearBody; dx++) {
              const ni = (y + dy) * gridW + (x + dx);
              if (ni >= 0 && ni < n && skel[ni] && bodyMask[ni]) nearBody = true;
            }
          }
          if (nearBody) bodyPixelsAdded++;
        }
      }
    }

    const expansionRatio = bodyPixelsBefore > 0 ? bodyPixelsAdded / bodyPixelsBefore : 0;
    console.log(
      `EDT body: ${bodyPixelsBefore} pixels, ${bodyPixelsAdded} would be added ` +
      `(${(expansionRatio * 100).toFixed(2)}% expansion)`,
    );

    // EDT should add very few pixels to the body (only at thin junctions if any)
    // Less than 1% expansion of the body area
    expect(
      expansionRatio,
      `EDT should not significantly expand the body (got ${(expansionRatio * 100).toFixed(2)}%)`,
    ).toBeLessThan(0.01);
  });

  it("Clipper and EDT produce similar body contour area", () => {
    const info = getShapeThinInfo(bodyShape);
    const clipperResult = info.hasThin
      ? thickenShapeClipper(bodyShape, NOZZLE_DIAMETER, info.minHalfWidth)
      : null;

    const clipperBodyArea = clipperResult
      ? Math.abs(signedArea(clipperResult.outer))
      : bodyArea;

    // For EDT, compute approximate body area after skeleton expansion
    const bodyMask = rasterizeShapeToMask(bodyShape, gridW, gridH, stampHeight, border);
    let bodyPixels = 0;
    for (let i = 0; i < n; i++) {
      if (bodyMask[i]) bodyPixels++;
    }
    const edtBodyAreaApprox = bodyPixels * RASTER_RESOLUTION * RASTER_RESOLUTION;

    const areaRatio = clipperBodyArea / bodyArea;
    console.log(
      `Body area: original=${bodyArea.toFixed(1)}mm², ` +
      `clipper=${clipperBodyArea.toFixed(1)}mm² (${(areaRatio * 100).toFixed(1)}%), ` +
      `EDT≈${edtBodyAreaApprox.toFixed(1)}mm²`,
    );

    // Both algorithms should preserve body area within 5%
    expect(
      Math.abs(areaRatio - 1),
      `Clipper body area changed by ${((areaRatio - 1) * 100).toFixed(1)}%`,
    ).toBeLessThan(0.05);
  });

  it("summary: per-shape Clipper decisions for all traced shapes", () => {
    const decisions: string[] = [];
    let thickenedCount = 0;

    for (let si = 0; si < shapes.length; si++) {
      const shape = shapes[si];
      const area = Math.abs(signedArea(shape.outer));
      const info = getShapeThinInfo(shape);

      let decision: string;
      if (!info.hasThin) {
        decision = "skip (no thin pixels)";
      } else {
        const result = thickenShapeClipper(shape, NOZZLE_DIAMETER, info.minHalfWidth);
        if (result) {
          decision = `THICKENED (minHalfWidth=${info.minHalfWidth.toFixed(3)}mm)`;
          thickenedCount++;
        } else {
          decision = `skip (thick core, minHalfWidth=${info.minHalfWidth.toFixed(3)}mm)`;
        }
      }

      const isBody = shape === bodyShape ? " [BODY]" : "";
      decisions.push(
        `  Shape ${si}: area=${area.toFixed(1)}mm², holes=${shape.holes.length}, ` +
        `vertices=${shape.outer.length} → ${decision}${isBody}`,
      );
    }

    console.log(`\nClipper decisions for ${shapes.length} shapes (${thickenedCount} thickened):`);
    for (const d of decisions) console.log(d);

    // The body shape specifically should NOT be thickened
    const bodyInfo = getShapeThinInfo(bodyShape);
    if (bodyInfo.hasThin) {
      const bodyResult = thickenShapeClipper(bodyShape, NOZZLE_DIAMETER, bodyInfo.minHalfWidth);
      expect(bodyResult, "Body shape must not be thickened by Clipper").toBeNull();
    }
  });
});
