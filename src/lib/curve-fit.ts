/**
 * Potrace curve fitting (Selinger, "Potrace: a polygon-based tracing
 * algorithm", §2.3).
 *
 * Turns a traced polygon (in source-pixel units) into smooth curves without
 * shrinking it: each vertex becomes a cubic Bézier that runs from the
 * midpoint of the incoming edge to the midpoint of the outgoing edge,
 * tangent to both edges. Vertices that stick out far from their neighbors'
 * chord are kept as sharp corners (alpha ≥ alphaMax).
 */

export interface Point {
  x: number;
  y: number;
}

/** Potrace's default corner threshold: higher = fewer corners, rounder output. */
export const DEFAULT_ALPHA_MAX = 1.0;
/** Max distance between a sampled curve and its chords, in source pixels. */
const FLATNESS_PX = 0.05;
const MAX_SAMPLES_PER_CURVE = 32;

const sign = (v: number) => (v > 0 ? 1 : v < 0 ? -1 : 0);

/** Signed area of the parallelogram p0→p1, p0→p2. */
function dpara(p0: Point, p1: Point, p2: Point): number {
  return (p1.x - p0.x) * (p2.y - p0.y) - (p2.x - p0.x) * (p1.y - p0.y);
}

/** Potrace's L∞-style denominator: how far a vertex may sit from the chord p0→p2 within pixel tolerance. */
function ddenom(p0: Point, p2: Point): number {
  const ry = sign(p2.x - p0.x);
  const rx = -sign(p2.y - p0.y);
  return ry * (p2.x - p0.x) - rx * (p2.y - p0.y);
}

const lerp = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

function sampleBezier(p0: Point, p1: Point, p2: Point, p3: Point, out: Point[]): void {
  // Distance of the control points from the chord bounds the curve's deviation
  const cx = p3.x - p0.x, cy = p3.y - p0.y;
  const len = Math.hypot(cx, cy) || 1;
  const d = Math.max(
    Math.abs((p1.x - p0.x) * cy - (p1.y - p0.y) * cx),
    Math.abs((p2.x - p0.x) * cy - (p2.y - p0.y) * cx),
  ) / len;
  const n = Math.min(MAX_SAMPLES_PER_CURVE, Math.max(1, Math.ceil(Math.sqrt((0.75 * d) / FLATNESS_PX))));
  for (let s = 1; s <= n; s++) {
    const t = s / n, u = 1 - t;
    const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, e = t * t * t;
    out.push({
      x: a * p0.x + b * p1.x + c * p2.x + e * p3.x,
      y: a * p0.y + b * p1.y + c * p2.y + e * p3.y,
    });
  }
}

/**
 * Smooth a closed polygon into sampled Bézier curves. Returns a closed
 * point loop (first point not repeated). Polygons with fewer than 3
 * vertices are returned unchanged.
 */
export function fitCurves(polygon: Point[], alphaMax = DEFAULT_ALPHA_MAX): Point[] {
  const n = polygon.length;
  if (n < 3) return polygon;

  const out: Point[] = [];
  for (let j = 0; j < n; j++) {
    const vi = polygon[(j - 1 + n) % n];
    const vj = polygon[j];
    const vk = polygon[(j + 1) % n];
    const start = lerp(vi, vj, 0.5);
    const end = lerp(vj, vk, 0.5);

    const denom = ddenom(vi, vk);
    let alpha: number;
    if (denom !== 0) {
      const dd = Math.abs(dpara(vi, vj, vk) / denom);
      alpha = (dd > 1 ? 1 - 1 / dd : 0) / 0.75;
    } else {
      alpha = 4 / 3;
    }

    if (alpha >= alphaMax) {
      out.push(vj, end); // corner
    } else {
      alpha = Math.min(1, Math.max(0.55, alpha));
      const c1 = lerp(vi, vj, 0.5 + 0.5 * alpha);
      const c2 = lerp(vk, vj, 0.5 + 0.5 * alpha);
      sampleBezier(start, c1, c2, end, out);
    }
  }
  return out;
}
