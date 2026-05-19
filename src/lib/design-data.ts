import * as THREE from "three";
import type { StampPoint, StampShapeData, DesignData } from "@/types/stamp";

function signedArea(contour: StampPoint[]): number {
  let area = 0;
  for (let i = 0, j = contour.length - 1; i < contour.length; j = i++) {
    area += (contour[j].x - contour[i].x) * (contour[j].y + contour[i].y);
  }
  return area / 2;
}

function pointInContour(px: number, py: number, contour: StampPoint[]): boolean {
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

function nestContours(contours: StampPoint[][]): StampShapeData[] {
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

  const shapes: StampShapeData[] = [];
  const shapeByIndex = new Map<number, StampShapeData>();

  for (let i = 0; i < indexed.length; i++) {
    const pts = indexed[i].contour;
    if (depth[i] % 2 === 0) {
      const shape: StampShapeData = { outer: pts, holes: [] };
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

export function computeBounds(shapes: StampShapeData[]): DesignData["bounds"] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of shapes) {
    for (const p of s.outer) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  if (minX === Infinity) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return { minX, minY, maxX, maxY };
}

export function rasterToDesignData(
  rawContours: StampPoint[][],
  rawImageDims: { w: number; h: number },
  stampW: number,
  stampH: number,
): DesignData {
  const scale = Math.min(stampW / rawImageDims.w, stampH / rawImageDims.h);
  const offsetX = (stampW - rawImageDims.w * scale) / 2;
  const offsetY = (stampH - rawImageDims.h * scale) / 2;

  const scaled = rawContours.map((c) =>
    c.map((p) => ({ x: p.x * scale + offsetX, y: p.y * scale + offsetY })),
  );

  const shapes = nestContours(scaled);
  return {
    shapes,
    bounds: computeBounds(shapes),
    sourceAspectRatio: rawImageDims.w / rawImageDims.h,
  };
}

export function designDataToShapes(data: DesignData): THREE.Shape[] {
  const result: THREE.Shape[] = [];
  for (const sd of data.shapes) {
    if (sd.outer.length < 3) continue;
    const shape = new THREE.Shape();
    shape.moveTo(sd.outer[0].x, sd.outer[0].y);
    for (let i = 1; i < sd.outer.length; i++) shape.lineTo(sd.outer[i].x, sd.outer[i].y);
    shape.closePath();

    for (const hole of sd.holes) {
      if (hole.length < 3) continue;
      const path = new THREE.Path();
      path.moveTo(hole[0].x, hole[0].y);
      for (let i = 1; i < hole.length; i++) path.lineTo(hole[i].x, hole[i].y);
      shape.holes.push(path);
    }

    result.push(shape);
  }
  return result;
}

export function shapesToDesignData(shapes: THREE.Shape[]): StampShapeData[] {
  return shapes.map((s) => ({
    outer: s.getPoints(48).map((p) => ({ x: p.x, y: p.y })),
    holes: s.holes.map((h) => h.getPoints(48).map((p) => ({ x: p.x, y: p.y }))),
  }));
}
