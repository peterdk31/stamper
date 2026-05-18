import * as THREE from "three";

/**
 * Offsets a shape's outline outward by the given distance.
 * Uses vertex normals (average of adjacent edge normals) to push each point outward.
 * Positive offset = outward (thickens features).
 *
 * The 90° CCW rotation of edge direction gives outward normals for CW winding
 * and inward normals for CCW winding. We detect the actual winding direction
 * to ensure outer boundaries expand and holes shrink regardless of convention.
 */
export function offsetShape(shape: THREE.Shape, offset: number): THREE.Shape {
  if (offset <= 0) return shape;

  const result = new THREE.Shape();
  const rawOuter = shape.getPoints();
  const outerCW = THREE.ShapeUtils.isClockWise(rawOuter);
  const outerOffset = outerCW ? offset : -offset;
  const outerPoints = offsetPoints(rawOuter, outerOffset);
  if (outerPoints.length === 0) return shape;

  result.moveTo(outerPoints[0].x, outerPoints[0].y);
  for (let i = 1; i < outerPoints.length; i++) {
    result.lineTo(outerPoints[i].x, outerPoints[i].y);
  }
  result.closePath();

  for (const hole of shape.holes) {
    const holePath = new THREE.Path();
    const rawHole = hole.getPoints();
    const holeCW = THREE.ShapeUtils.isClockWise(rawHole);
    const holeOffset = holeCW ? -offset : offset;
    const holePoints = offsetPoints(rawHole, holeOffset);
    if (holePoints.length === 0) continue;
    holePath.moveTo(holePoints[0].x, holePoints[0].y);
    for (let i = 1; i < holePoints.length; i++) {
      holePath.lineTo(holePoints[i].x, holePoints[i].y);
    }
    result.holes.push(holePath);
  }

  return result;
}

function offsetPoints(points: THREE.Vector2[], offset: number): THREE.Vector2[] {
  const n = points.length;
  if (n < 3) return points;

  const result: THREE.Vector2[] = [];

  for (let i = 0; i < n; i++) {
    const prev = points[(i - 1 + n) % n];
    const curr = points[i];
    const next = points[(i + 1) % n];

    const e1x = curr.x - prev.x;
    const e1y = curr.y - prev.y;
    const e2x = next.x - curr.x;
    const e2y = next.y - curr.y;

    // Outward normals (rotate edge direction 90° CCW)
    const len1 = Math.sqrt(e1x * e1x + e1y * e1y) || 1;
    const len2 = Math.sqrt(e2x * e2x + e2y * e2y) || 1;
    const n1x = -e1y / len1;
    const n1y = e1x / len1;
    const n2x = -e2y / len2;
    const n2y = e2x / len2;

    // Average normal
    let nx = n1x + n2x;
    let ny = n1y + n2y;
    const nLen = Math.sqrt(nx * nx + ny * ny) || 1;
    nx /= nLen;
    ny /= nLen;

    // Scale to maintain offset distance at the bisector
    const dot = nx * n1x + ny * n1y;
    const scale = dot > 0.1 ? offset / dot : offset;
    const maxMag = Math.abs(offset) * 3;
    const clampedScale = Math.sign(offset) * Math.min(Math.abs(scale), maxMag);

    result.push(new THREE.Vector2(
      curr.x + nx * clampedScale,
      curr.y + ny * clampedScale,
    ));
  }

  return result;
}

export function offsetShapes(shapes: THREE.Shape[], offset: number): THREE.Shape[] {
  if (offset <= 0) return shapes;
  return shapes.map((s) => offsetShape(s, offset));
}
