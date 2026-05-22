import { describe, it, expect } from "vitest";
import { squaredEDT, initEDT, detectThinPixels } from "../edt";
import { thickenShapeClipper, type Point, type ShapeData } from "../clipper-thicken";

const NOZZLE_DIAMETER = 0.4; // mm
const RASTER_RESOLUTION = 0.05; // mm per pixel

/**
 * Generate a curved line (annular arc sector) as a polygon.
 * The line follows a circular arc with uniform width = lineWidth.
 * Center of the arc is at (cx, cy), radius to centerline = radius.
 * Arc sweeps from startAngle to endAngle (radians).
 */
function generateCurvedLine(
  cx: number,
  cy: number,
  radius: number,
  lineWidth: number,
  startAngle: number,
  endAngle: number,
  segments: number,
): Point[] {
  const innerR = radius - lineWidth / 2;
  const outerR = radius + lineWidth / 2;
  const points: Point[] = [];

  // Outer edge: startAngle → endAngle
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const angle = startAngle + (endAngle - startAngle) * t;
    points.push({ x: cx + outerR * Math.cos(angle), y: cy + outerR * Math.sin(angle) });
  }

  // Inner edge: endAngle → startAngle (reverse)
  for (let i = segments; i >= 0; i--) {
    const t = i / segments;
    const angle = startAngle + (endAngle - startAngle) * t;
    points.push({ x: cx + innerR * Math.cos(angle), y: cy + innerR * Math.sin(angle) });
  }

  return points;
}

/**
 * Rasterize a polygon into a binary mask using point-in-polygon (ray casting).
 */
function rasterizePolygon(
  polygon: Point[],
  gridW: number,
  gridH: number,
  resolution: number,
  offsetX: number,
  offsetY: number,
): Uint8Array {
  const mask = new Uint8Array(gridW * gridH);

  for (let gy = 0; gy < gridH; gy++) {
    const py = offsetY + gy * resolution;
    for (let gx = 0; gx < gridW; gx++) {
      const px = offsetX + gx * resolution;

      // Ray casting point-in-polygon
      let inside = false;
      for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const xi = polygon[i].x, yi = polygon[i].y;
        const xj = polygon[j].x, yj = polygon[j].y;
        if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
          inside = !inside;
        }
      }

      if (inside) {
        mask[gy * gridW + gx] = 1;
      }
    }
  }

  return mask;
}

/**
 * Compute the polygon area using the shoelace formula.
 */
function polygonArea(points: Point[]): number {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    area += points[i].x * points[j].y - points[j].x * points[i].y;
  }
  return Math.abs(area) / 2;
}

describe("thickening at nozzle width", () => {
  // Curved line: 90° arc, radius 5mm, width = nozzleDiameter
  const cx = 6, cy = 6;
  const radius = 5;
  const lineWidth = NOZZLE_DIAMETER;
  const arcOuter = generateCurvedLine(cx, cy, radius, lineWidth, 0, Math.PI / 2, 120);

  const shape: ShapeData = { outer: arcOuter, holes: [] };

  // Compute bounding box for rasterization
  const allX = arcOuter.map((p) => p.x);
  const allY = arcOuter.map((p) => p.y);
  const minX = Math.min(...allX);
  const minY = Math.min(...allY);
  const maxX = Math.max(...allX);
  const maxY = Math.max(...allY);
  const margin = NOZZLE_DIAMETER;
  const gridW = Math.ceil((maxX - minX + 2 * margin) / RASTER_RESOLUTION);
  const gridH = Math.ceil((maxY - minY + 2 * margin) / RASTER_RESOLUTION);
  const offsetX = minX - margin;
  const offsetY = minY - margin;

  it("EDT does not detect thin features in a nozzle-width curved line", () => {
    const mask = rasterizePolygon(arcOuter, gridW, gridH, RASTER_RESOLUTION, offsetX, offsetY);
    const n = gridW * gridH;

    let fgCount = 0;
    for (let i = 0; i < n; i++) if (mask[i]) fgCount++;
    expect(fgCount).toBeGreaterThan(0);

    const sqDistToBg = squaredEDT(initEDT(mask, n, false), gridW, gridH);
    const radiusPx = NOZZLE_DIAMETER / 2 / RASTER_RESOLUTION;
    const radiusSq = radiusPx * radiusPx;
    const thin = detectThinPixels(mask, sqDistToBg, gridW, gridH, radiusSq);

    let thinCount = 0;
    for (let i = 0; i < n; i++) if (thin[i]) thinCount++;

    // Should have zero or negligible thin pixels (< 10, the per-shape threshold)
    expect(thinCount).toBeLessThan(10);
  });

  it("Clipper does not thicken a nozzle-width curved line", () => {
    // minLocalHalfWidth = nozzleDiameter / 2 means the line is exactly nozzle width
    const result = thickenShapeClipper(shape, NOZZLE_DIAMETER, NOZZLE_DIAMETER / 2);
    expect(result).toBeNull();
  });

  it("Clipper does not thicken a line wider than nozzle diameter", () => {
    const widerLine = generateCurvedLine(cx, cy, radius, NOZZLE_DIAMETER * 1.5, 0, Math.PI / 2, 120);
    const widerShape: ShapeData = { outer: widerLine, holes: [] };
    const result = thickenShapeClipper(widerShape, NOZZLE_DIAMETER, NOZZLE_DIAMETER * 0.75);
    expect(result).toBeNull();
  });

  it("Clipper does thicken a line thinner than nozzle diameter", () => {
    const thinWidth = NOZZLE_DIAMETER * 0.5;
    const thinLine = generateCurvedLine(cx, cy, radius, thinWidth, 0, Math.PI / 2, 120);
    const thinShape: ShapeData = { outer: thinLine, holes: [] };
    const result = thickenShapeClipper(thinShape, NOZZLE_DIAMETER, thinWidth / 2);
    expect(result).not.toBeNull();

    // Verify the thickened shape is larger but not excessively so
    const originalArea = polygonArea(thinLine);
    const thickenedArea = polygonArea(result!.outer);
    expect(thickenedArea).toBeGreaterThan(originalArea);

    // Should not exceed ~2x the original area (nozzle width is 2x the thin width)
    expect(thickenedArea).toBeLessThan(originalArea * 3);
  });

  it("EDT detects thin features in a line thinner than nozzle diameter", () => {
    const thinWidth = NOZZLE_DIAMETER * 0.5;
    const thinLine = generateCurvedLine(cx, cy, radius, thinWidth, 0, Math.PI / 2, 120);

    const thinAllX = thinLine.map((p) => p.x);
    const thinAllY = thinLine.map((p) => p.y);
    const tMinX = Math.min(...thinAllX);
    const tMinY = Math.min(...thinAllY);
    const tMaxX = Math.max(...thinAllX);
    const tMaxY = Math.max(...thinAllY);
    const tGridW = Math.ceil((tMaxX - tMinX + 2 * margin) / RASTER_RESOLUTION);
    const tGridH = Math.ceil((tMaxY - tMinY + 2 * margin) / RASTER_RESOLUTION);
    const tOffsetX = tMinX - margin;
    const tOffsetY = tMinY - margin;

    const mask = rasterizePolygon(thinLine, tGridW, tGridH, RASTER_RESOLUTION, tOffsetX, tOffsetY);
    const n = tGridW * tGridH;

    const sqDistToBg = squaredEDT(initEDT(mask, n, false), tGridW, tGridH);
    const radiusPx = NOZZLE_DIAMETER / 2 / RASTER_RESOLUTION;
    const radiusSq = radiusPx * radiusPx;
    const thin = detectThinPixels(mask, sqDistToBg, tGridW, tGridH, radiusSq);

    let thinCount = 0;
    for (let i = 0; i < n; i++) if (thin[i]) thinCount++;

    // Should detect many thin pixels
    expect(thinCount).toBeGreaterThan(10);
  });
});
