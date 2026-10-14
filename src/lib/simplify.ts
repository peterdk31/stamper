import { ringsCross } from "./contour-utils";

interface Point {
  x: number;
  y: number;
}

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

const MAX_SAFE_RETRIES = 4; // tolerance halvings before keeping the outline as is

/**
 * Simplifies a shape's outer and holes without letting any edges cross.
 *
 * Douglas-Peucker on each ring alone can fold a narrow wedge (e.g. the gap
 * between two fin rays meeting at a point) into a bow-tie, or move a hole
 * across the outer. Triangulation then fills the hole. Where that happens the
 * tolerance is halved and the shape simplified again; if it still crosses,
 * the unsimplified rings are kept. Rings simplified below 3 points are dropped.
 */
export function simplifyShape(
  outer: Point[], holes: Point[][], tolerance: number,
): { outer: Point[]; holes: Point[][] } | null {
  for (let attempt = 0, tol = tolerance; attempt <= MAX_SAFE_RETRIES; attempt++, tol /= 2) {
    const o = simplifyContour(outer, tol);
    if (o.length < 3) return null;
    const hs = holes.map((h) => simplifyContour(h, tol)).filter((h) => h.length >= 3);
    if (!ringsCross([o, ...hs])) return { outer: o, holes: hs };
  }
  return { outer, holes: holes.filter((h) => h.length >= 3) };
}

export function simplifyContour(points: Point[], tolerance: number): Point[] {
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
