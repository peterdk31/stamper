import * as THREE from "three";

interface Point {
  x: number;
  y: number;
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

export function contoursToShapes(contours: Point[][]): THREE.Shape[] {
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

  const shapes: THREE.Shape[] = [];
  const shapeByIndex = new Map<number, THREE.Shape>();

  for (let i = 0; i < indexed.length; i++) {
    const pts = indexed[i].contour;
    if (depth[i] % 2 === 0) {
      const shape = new THREE.Shape();
      shape.moveTo(pts[0].x, pts[0].y);
      for (let k = 1; k < pts.length; k++) shape.lineTo(pts[k].x, pts[k].y);
      shape.closePath();
      shapes.push(shape);
      shapeByIndex.set(i, shape);
    } else {
      const parentShape = shapeByIndex.get(parent[i]);
      if (parentShape) {
        const hole = new THREE.Path();
        hole.moveTo(pts[0].x, pts[0].y);
        for (let k = 1; k < pts.length; k++) hole.lineTo(pts[k].x, pts[k].y);
        parentShape.holes.push(hole);
      }
    }
  }

  return shapes;
}

// The old traceImageToShapes / traceContours / followContour code has been
// replaced by the marching-squares Web Worker (image-trace.worker.ts).
// Only contoursToShapes above is still used by the main thread.
