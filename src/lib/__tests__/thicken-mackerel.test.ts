import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { PNG } from "pngjs";
import { squaredEDT, initEDT, detectThinPixels } from "../edt";
import { thickenShapeClipper, type Point, type ShapeData } from "../clipper-thicken";

const NOZZLE_DIAMETER = 0.4;
const RASTER_RESOLUTION = 0.05;
const STAMP_WIDTH = 80;
const MIN_THIN_PER_SHAPE = 10;

function loadMackerelMask(): {
  mask: Uint8Array;
  gridW: number;
  gridH: number;
  border: number;
  stampHeight: number;
} {
  const pngPath = path.resolve(__dirname, "../../../Makrel.png");
  const data = fs.readFileSync(pngPath);
  const png = PNG.sync.read(data);

  const scale = STAMP_WIDTH / png.width;
  const stampHeight = png.height * scale;

  const border = Math.ceil(NOZZLE_DIAMETER / 2 / RASTER_RESOLUTION) + 2;
  const gridW = Math.ceil(STAMP_WIDTH / RASTER_RESOLUTION) + border * 2;
  const gridH = Math.ceil(stampHeight / RASTER_RESOLUTION) + border * 2;
  const n = gridW * gridH;
  const mask = new Uint8Array(n);

  for (let gy = 0; gy < gridH; gy++) {
    const mmY = (gy - border) * RASTER_RESOLUTION;
    const srcY = Math.round((stampHeight - mmY) / scale);
    if (srcY < 0 || srcY >= png.height) continue;

    for (let gx = 0; gx < gridW; gx++) {
      const mmX = (gx - border) * RASTER_RESOLUTION;
      const srcX = Math.round(mmX / scale);
      if (srcX < 0 || srcX >= png.width) continue;

      const idx = (srcY * png.width + srcX) * 4;
      const r = png.data[idx], g = png.data[idx + 1], b = png.data[idx + 2];
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      if (lum < 128) {
        mask[gy * gridW + gx] = 1;
      }
    }
  }

  return { mask, gridW, gridH, border, stampHeight };
}

function labelComponents(
  mask: Uint8Array,
  gridW: number,
  gridH: number,
): { labels: Int32Array; count: number } {
  const n = gridW * gridH;
  const labels = new Int32Array(n);
  let nextLabel = 1;

  for (let i = 0; i < n; i++) {
    if (!mask[i] || labels[i]) continue;
    const stack = [i];
    labels[i] = nextLabel;
    while (stack.length > 0) {
      const ci = stack.pop()!;
      const cx = ci % gridW;
      const cy = (ci - cx) / gridW;
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || nx >= gridW || ny < 0 || ny >= gridH) continue;
        const ni = ny * gridW + nx;
        if (mask[ni] && !labels[ni]) {
          labels[ni] = nextLabel;
          stack.push(ni);
        }
      }
    }
    nextLabel++;
  }

  return { labels, count: nextLabel - 1 };
}

/**
 * Create a rectangle polygon of a given width and length in mm.
 */
function makeRectangle(cx: number, cy: number, width: number, length: number): Point[] {
  const hw = width / 2, hl = length / 2;
  return [
    { x: cx - hl, y: cy - hw },
    { x: cx + hl, y: cy - hw },
    { x: cx + hl, y: cy + hw },
    { x: cx - hl, y: cy + hw },
  ];
}

/**
 * Generate a curved line (annular arc sector) as a polygon.
 */
function generateCurvedLine(
  cx: number, cy: number, radius: number, lineWidth: number,
  startAngle: number, endAngle: number, segments: number,
): Point[] {
  const innerR = radius - lineWidth / 2;
  const outerR = radius + lineWidth / 2;
  const points: Point[] = [];
  for (let i = 0; i <= segments; i++) {
    const angle = startAngle + (endAngle - startAngle) * (i / segments);
    points.push({ x: cx + outerR * Math.cos(angle), y: cy + outerR * Math.sin(angle) });
  }
  for (let i = segments; i >= 0; i--) {
    const angle = startAngle + (endAngle - startAngle) * (i / segments);
    points.push({ x: cx + innerR * Math.cos(angle), y: cy + innerR * Math.sin(angle) });
  }
  return points;
}

describe("mackerel Clipper thickening at 80mm width", () => {
  const { mask, gridW, gridH } = loadMackerelMask();
  const n = gridW * gridH;

  const sqDistToBg = squaredEDT(initEDT(mask, n, false), gridW, gridH);
  const radiusPx = NOZZLE_DIAMETER / 2 / RASTER_RESOLUTION;
  const radiusSq = radiusPx * radiusPx;
  const thin = detectThinPixels(mask, sqDistToBg, gridW, gridH, radiusSq);

  const { labels, count: componentCount } = labelComponents(mask, gridW, gridH);

  interface ComponentInfo {
    label: number;
    pixelCount: number;
    maxSqDistToBg: number;
    thinPixelCount: number;
    maxSqDistInThin: number;
  }

  const components: ComponentInfo[] = [];
  for (let label = 1; label <= componentCount; label++) {
    let pixelCount = 0, maxSqDistToBg = 0, thinPixelCount = 0, maxSqDistInThin = 0;
    for (let i = 0; i < n; i++) {
      if (labels[i] !== label) continue;
      pixelCount++;
      if (sqDistToBg[i] > maxSqDistToBg) maxSqDistToBg = sqDistToBg[i];
      if (thin[i]) {
        thinPixelCount++;
        if (sqDistToBg[i] > maxSqDistInThin) maxSqDistInThin = sqDistToBg[i];
      }
    }
    if (pixelCount > 50) {
      components.push({ label, pixelCount, maxSqDistToBg, thinPixelCount, maxSqDistInThin });
    }
  }

  it("finds multiple components in the mackerel", () => {
    expect(components.length).toBeGreaterThan(3);
  });

  it("the mackerel body (thickest component) has mixed thin/thick features", () => {
    // The body is the largest component
    const body = components.reduce((a, b) => (a.pixelCount > b.pixelCount ? a : b));
    const bodyWidth = 2 * Math.sqrt(body.maxSqDistToBg) * RASTER_RESOLUTION;

    // Body should be significantly wider than nozzle diameter
    expect(bodyWidth).toBeGreaterThan(NOZZLE_DIAMETER * 2);

    // Body should also have some thin features (fin details, junctions)
    expect(body.thinPixelCount).toBeGreaterThan(MIN_THIN_PER_SHAPE);
  });

  it("Clipper skips shapes at the mackerel body width (mixed thin/thick)", () => {
    const body = components.reduce((a, b) => (a.pixelCount > b.pixelCount ? a : b));
    const bodyWidth = 2 * Math.sqrt(body.maxSqDistToBg) * RASTER_RESOLUTION;
    const minHalfWidth = Math.sqrt(body.maxSqDistInThin) * RASTER_RESOLUTION;

    // Create a rectangle at the body's thickest width
    const rect = makeRectangle(40, 20, bodyWidth, 30);
    const shape: ShapeData = { outer: rect, holes: [] };

    const result = thickenShapeClipper(shape, NOZZLE_DIAMETER, minHalfWidth);
    // Should return null: the shape has a thick core after erosion → mixed → skip
    expect(result).toBeNull();
  });

  it("Clipper skips shapes at widths found in thick mackerel components", () => {
    // Test every thick component: create shapes at their measured widths
    const thickComponents = components.filter(
      (c) => Math.sqrt(c.maxSqDistToBg) * RASTER_RESOLUTION > NOZZLE_DIAMETER / 2,
    );
    expect(thickComponents.length).toBeGreaterThan(0);

    for (const comp of thickComponents) {
      const width = 2 * Math.sqrt(comp.maxSqDistToBg) * RASTER_RESOLUTION;
      const minHalfWidth = comp.thinPixelCount >= MIN_THIN_PER_SHAPE
        ? Math.sqrt(comp.maxSqDistInThin) * RASTER_RESOLUTION
        : NOZZLE_DIAMETER;

      // Test with a rectangle at this width
      const rect = makeRectangle(40, 20, width, 20);
      const rectShape: ShapeData = { outer: rect, holes: [] };
      const rectResult = thickenShapeClipper(rectShape, NOZZLE_DIAMETER, minHalfWidth);
      expect(
        rectResult,
        `Rectangle ${width.toFixed(2)}mm wide (component ${comp.label}) should not be thickened`,
      ).toBeNull();

      // Also test with a curved line at this width
      const curve = generateCurvedLine(40, 20, 10, width, 0, Math.PI / 2, 80);
      const curveShape: ShapeData = { outer: curve, holes: [] };
      const curveResult = thickenShapeClipper(curveShape, NOZZLE_DIAMETER, minHalfWidth);
      expect(
        curveResult,
        `Curved line ${width.toFixed(2)}mm wide (component ${comp.label}) should not be thickened`,
      ).toBeNull();
    }
  });

  it("Clipper does thicken shapes at widths found in thin mackerel components", () => {
    const thinComponents = components.filter(
      (c) =>
        c.thinPixelCount >= MIN_THIN_PER_SHAPE &&
        Math.sqrt(c.maxSqDistToBg) * RASTER_RESOLUTION <= NOZZLE_DIAMETER / 2,
    );

    for (const comp of thinComponents) {
      const width = 2 * Math.sqrt(comp.maxSqDistToBg) * RASTER_RESOLUTION;
      const minHalfWidth = Math.sqrt(comp.maxSqDistInThin) * RASTER_RESOLUTION;

      const rect = makeRectangle(40, 20, width, 20);
      const shape: ShapeData = { outer: rect, holes: [] };
      const result = thickenShapeClipper(shape, NOZZLE_DIAMETER, minHalfWidth);
      expect(
        result,
        `Rectangle ${width.toFixed(2)}mm wide (thin component ${comp.label}) should be thickened`,
      ).not.toBeNull();
    }
  });
});
