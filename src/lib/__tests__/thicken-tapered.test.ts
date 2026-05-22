import { describe, it, expect } from "vitest";
import { squaredEDT, initEDT, detectThinPixels } from "../edt";
import { thickenShapeClipper, type Point, type ShapeData } from "../clipper-thicken";

const NOZZLE_DIAMETER = 0.4;
const RASTER_RESOLUTION = 0.05;

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
      let inside = false;
      for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const xi = polygon[i].x, yi = polygon[i].y;
        const xj = polygon[j].x, yj = polygon[j].y;
        if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
          inside = !inside;
        }
      }
      if (inside) mask[gy * gridW + gx] = 1;
    }
  }
  return mask;
}

describe("hole shrinking on mixed thin/thick shapes", () => {
  // A body-like shape: wide rectangle with a narrow hole.
  // The outer is thick (1.0mm wide) and should NOT be expanded.
  // The hole should also NOT be shrunk — shrinking holes when the outer
  // is unchanged makes the features between holes appear wider.
  it("does NOT shrink holes when the outer has a thick core", () => {
    const outer: Point[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 1.0 },
      { x: 0, y: 1.0 },
    ];
    const hole: Point[] = [
      { x: 2, y: 0.3 },
      { x: 8, y: 0.3 },
      { x: 8, y: 0.7 },
      { x: 2, y: 0.7 },
    ];
    const shape: ShapeData = { outer, holes: [hole] };

    // minLocalHalfWidth = 0.15mm means there are thin features somewhere,
    // but the outer is thick enough to survive erosion.
    const result = thickenShapeClipper(shape, NOZZLE_DIAMETER, 0.15);
    expect(
      result,
      "Shape with thick outer should not be modified at all (outer or holes)",
    ).toBeNull();
  });

  it("DOES shrink holes when the outer is expanded (entirely thin shape)", () => {
    // A thin rectangle (0.30mm) with a small hole
    const outer: Point[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 0.30 },
      { x: 0, y: 0.30 },
    ];
    const hole: Point[] = [
      { x: 3, y: 0.05 },
      { x: 7, y: 0.05 },
      { x: 7, y: 0.25 },
      { x: 3, y: 0.25 },
    ];
    const shape: ShapeData = { outer, holes: [hole] };
    const result = thickenShapeClipper(shape, NOZZLE_DIAMETER, 0.10);
    expect(result, "Thin shape should be thickened").not.toBeNull();
  });
});

describe("mackerel body shape: thick outer with holes", () => {
  it("body-like shape with multiple holes is not modified", () => {
    // Simulate the mackerel body: a wide outer contour with internal
    // line-shaped holes (center line, fin lines, markings).
    const outer: Point[] = [
      { x: 0, y: 0 },
      { x: 80, y: 0 },
      { x: 80, y: 20 },
      { x: 0, y: 20 },
    ];
    const centerLineHole: Point[] = [
      { x: 10, y: 9.75 },
      { x: 70, y: 9.75 },
      { x: 70, y: 10.25 },
      { x: 10, y: 10.25 },
    ];
    const finHole: Point[] = [
      { x: 60, y: 3 },
      { x: 75, y: 3 },
      { x: 75, y: 3.5 },
      { x: 60, y: 3.5 },
    ];
    const shape: ShapeData = { outer, holes: [centerLineHole, finHole] };

    // The body has thin features (fin edges) but the outer is thick.
    // minLocalHalfWidth from thin pixels would be small (~0.15mm).
    const result = thickenShapeClipper(shape, NOZZLE_DIAMETER, 0.15);
    expect(
      result,
      "Body shape with thick outer should not be modified — holes should not shrink",
    ).toBeNull();
  });

  it("verifies hole shrinking was the cause of visible expansion", () => {
    // A 2mm wide body with a 0.5mm wide center line hole.
    // Without the fix: the outer is not expanded (thick core), but the
    // hole gets shrunk, making the gap between body and hole narrower
    // → visible "expansion."
    const outer: Point[] = [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 2.0 },
      { x: 0, y: 2.0 },
    ];
    const hole: Point[] = [
      { x: 2, y: 0.75 },
      { x: 18, y: 0.75 },
      { x: 18, y: 1.25 },
      { x: 2, y: 1.25 },
    ];
    const shape: ShapeData = { outer, holes: [hole] };

    const result = thickenShapeClipper(shape, NOZZLE_DIAMETER, 0.18);
    expect(result).toBeNull();
  });
});

describe("mixed thin/thick shape thickening", () => {
  it("thickens a thin fin protruding from a thick body", () => {
    // T-shape: wide body (2mm tall) with a thin fin (0.15mm wide, 3mm long)
    const outer: Point[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 2 },
      // thin fin protrusion
      { x: 5.075, y: 2 },
      { x: 5.075, y: 5 },
      { x: 4.925, y: 5 },
      { x: 4.925, y: 2 },
      { x: 0, y: 2 },
    ];
    const shape: ShapeData = { outer, holes: [] };
    const result = thickenShapeClipper(shape, NOZZLE_DIAMETER, 0.075);
    expect(result, "Mixed shape with thin protrusion should be thickened").not.toBeNull();

    // The thickened fin should be wider than the original 0.15mm
    const finPoints = result!.outer.filter((p) => p.y > 2.5);
    const finXs = finPoints.map((p) => p.x);
    const finWidth = Math.max(...finXs) - Math.min(...finXs);
    expect(finWidth).toBeGreaterThan(0.15);
    expect(finWidth).toBeGreaterThanOrEqual(NOZZLE_DIAMETER * 0.8);
  });

  it("does not distort the thick body of a mixed shape", () => {
    const outer: Point[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 2 },
      { x: 5.075, y: 2 },
      { x: 5.075, y: 5 },
      { x: 4.925, y: 5 },
      { x: 4.925, y: 2 },
      { x: 0, y: 2 },
    ];
    const shape: ShapeData = { outer, holes: [] };
    const result = thickenShapeClipper(shape, NOZZLE_DIAMETER, 0.075);
    expect(result).not.toBeNull();

    // Body corners should be within 0.25mm of original positions
    const bodyBottomLeft = result!.outer.find(
      (p) => p.x < 0.5 && p.y < 0.5,
    );
    expect(bodyBottomLeft).toBeDefined();
    expect(Math.abs(bodyBottomLeft!.x)).toBeLessThan(0.25);
    expect(Math.abs(bodyBottomLeft!.y)).toBeLessThan(0.25);
  });
});
