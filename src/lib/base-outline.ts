import ClipperLib from "clipper-lib";
import {
  CLIPPER_SCALE, MIN_AREA_SQ, clipperBoolOp, clipperOffset, fromClipperPath, toClipperPath, type Point,
} from "./clipper-thicken";
import { simplifyShape } from "./simplify";

/**
 * Stamp base outline for cutter mode: the design's silhouette, grown by
 * `offset` and smoothed by `fidelity`. Always a single ring without holes, so
 * the cutter (a straight ring around it) can slide over the stamp from either
 * side.
 *
 * The offset uses miter joins, so the design's corners stay sharp; only
 * fidelity smooths the outline.
 * fidelity 100 → 50: morphological closing (grow by r, shrink by r) with a
 *   growing r, filling concavities; at 50 it is the convex hull. Closing
 *   never rounds convex corners.
 * fidelity 50 → 0: Minkowski blend of the convex hull and the design-area
 *   rectangle; at 0 the outline is the design-area rectangle grown by the offset.
 * Islands are always bridged, using the smallest closing radius that joins them.
 */

export interface BaseOutlineInput {
  /** Design shapes in design-area coordinates, unmirrored. Holes are ignored. */
  shapes: { outer: Point[]; holes: Point[][] }[];
  /** Design area (Width × Height sliders). */
  width: number;
  height: number;
  /** How far the base reaches beyond the design, mm. */
  offset: number;
  fidelity: number;
  /** Major diameter of the handle thread, or null without a handle mount. */
  threadDiameter: number | null;
}

/** Base kept around the thread hole, per side — matches the panel's minimum size (major diameter + 4). */
export const THREAD_WALL = 2;
const SIMPLIFY_TOLERANCE = 0.05;
const DISC_SEGMENTS = 64;

type Paths = ClipperLib.Paths;

/** Miter length cap (× offset): tips sharper than ~29° are squared off about one offset out instead of growing into long spikes. */
const MITER_LIMIT = 4;

/** Outward offset by `mm` with miter joins: straight edges move out parallel, corners stay sharp. */
export function miterOffset(paths: Paths, mm: number): Paths {
  if (mm <= 0) return paths;
  const co = new ClipperLib.ClipperOffset(MITER_LIMIT);
  for (const p of paths) co.AddPath(p, ClipperLib.JoinType.jtMiter, ClipperLib.EndType.etClosedPolygon);
  const result: Paths = [];
  co.Execute(result, mm * CLIPPER_SCALE);
  return outersOnly(result);
}

/** Round-join offset by `mm` (negative shrinks), outer rings only. */
function offset(paths: Paths, mm: number): Paths {
  return outersOnly(clipperOffset(paths, mm * CLIPPER_SCALE));
}

function outersOnly(paths: Paths): Paths {
  return paths.filter((p) => ClipperLib.Clipper.Area(p) > MIN_AREA_SQ);
}

function largestOuter(paths: Paths): ClipperLib.Path | null {
  let best: ClipperLib.Path | null = null;
  let bestArea = MIN_AREA_SQ;
  for (const p of paths) {
    const a = ClipperLib.Clipper.Area(p);
    if (a > bestArea) { best = p; bestArea = a; }
  }
  return best;
}

/** Union of the outer rings, each oriented positive so the union fills them. */
function silhouette(shapes: BaseOutlineInput["shapes"]): Paths {
  const paths: Paths = [];
  for (const s of shapes) {
    if (s.outer.length < 3) continue;
    const p = toClipperPath(s.outer);
    if (ClipperLib.Clipper.Area(p) < 0) p.reverse();
    paths.push(p);
  }
  return outersOnly(clipperBoolOp(paths, [], ClipperLib.ClipType.ctUnion));
}

function closing(paths: Paths, r: number): Paths {
  if (r <= 0) return paths;
  return offset(offset(paths, r), -r);
}

function bboxSize(paths: Paths): number {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of paths) for (const q of p) {
    x0 = Math.min(x0, q.X); x1 = Math.max(x1, q.X); y0 = Math.min(y0, q.Y); y1 = Math.max(y1, q.Y);
  }
  return Math.max(x1 - x0, y1 - y0) / CLIPPER_SCALE;
}

/** Smallest closing that leaves a single piece (binary search to ~0.05 mm). */
function mergeIslands(paths: Paths): { paths: Paths; radius: number } {
  if (paths.length <= 1) return { paths, radius: 0 };
  let hi = Math.max(bboxSize(paths) / 2, 1);
  let closed = closing(paths, hi);
  for (let i = 0; closed.length > 1 && i < 4; i++) { hi *= 2; closed = closing(paths, hi); }
  if (closed.length > 1) return { paths: [hullPath(paths)], radius: hi };
  let lo = 0;
  while (hi - lo > 0.05) {
    const mid = (lo + hi) / 2;
    const c = closing(paths, mid);
    if (c.length === 1) { hi = mid; closed = c; } else lo = mid;
  }
  return { paths: closed, radius: hi };
}

function convexHull(pts: Point[]): Point[] {
  const sorted = pts.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Point[] = [], upper: Point[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

function toPositivePath(pts: Point[]): ClipperLib.Path {
  const p = toClipperPath(pts);
  if (ClipperLib.Clipper.Area(p) < 0) p.reverse();
  return p;
}

function hullPoints(paths: Paths): Point[] {
  return convexHull(paths.flatMap(fromClipperPath));
}

function hullPath(paths: Paths): ClipperLib.Path {
  return toPositivePath(hullPoints(paths));
}

/** (1 − t)·rect ⊕ t·hull — the Minkowski sum of two convex shapes is the hull of all pairwise sums. */
function blendHullToRect(hull: Point[], width: number, height: number, t: number): ClipperLib.Path {
  const rect = [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: height }, { x: 0, y: height }];
  const pts: Point[] = [];
  for (const a of rect) for (const b of hull) pts.push({ x: (1 - t) * a.x + t * b.x, y: (1 - t) * a.y + t * b.y });
  return toPositivePath(convexHull(pts));
}

const MIN_CLOSING = 0.25; // mm — sets how fast the exponential starts

/**
 * Closing radius for fidelity in (50, 100]: rMerge at 100, growing
 * exponentially to 2 × the design size just above 50 (≈ convex hull), so each
 * step of the slider fills visibly bigger concavities. For a 40 mm design:
 * ~0.5 mm at 90, ~4 mm at 75, ~25 mm at 60.
 */
export function closingRadius(fidelity: number, mergeRadius: number, size: number): number {
  const s = (100 - fidelity) / 50;
  const k = 1 + (2 * size) / MIN_CLOSING;
  return mergeRadius + MIN_CLOSING * (Math.pow(k, s) - 1);
}

/**
 * Silhouette grown by the offset, then smoothed. The closing runs after the
 * offset: a closing narrower than the offset done before it would vanish (the
 * offset re-sharpens filled concave corners). Hull and rectangle blend commute
 * with the offset, so they can be blended first and grown after.
 */
function smoothAndGrow(sil: Paths, input: BaseOutlineInput): Paths {
  const f = Math.min(100, Math.max(0, input.fidelity));

  if (f <= 50) {
    return miterOffset([blendHullToRect(hullPoints(sil), input.width, input.height, f / 50)], input.offset);
  }
  const grown = miterOffset(sil, input.offset);
  const merged = mergeIslands(grown);
  if (f >= 100) return merged.paths;
  const size = Math.max(input.width, input.height) + 2 * input.offset;
  return mergeIslands(closing(grown, closingRadius(f, merged.radius, size))).paths;
}

function disc(cx: number, cy: number, r: number): ClipperLib.Path {
  const pts: Point[] = [];
  for (let i = 0; i < DISC_SEGMENTS; i++) {
    const a = (i / DISC_SEGMENTS) * Math.PI * 2;
    pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return toPositivePath(pts);
}

/**
 * Returns the base outline in design-area coordinates (it reaches `offset`
 * beyond the design, so it can go negative), unmirrored, or null when there is no design (callers fall back to the
 * rounded-rect plate).
 */
export function computeBaseOutline(input: BaseOutlineInput): Point[] | null {
  const sil = silhouette(input.shapes);
  if (sil.length === 0) return null;

  let base = smoothAndGrow(sil, input);
  if (input.threadDiameter != null) {
    const d = disc(input.width / 2, input.height / 2, input.threadDiameter / 2 + THREAD_WALL);
    base = outersOnly(clipperBoolOp(base, [d], ClipperLib.ClipType.ctUnion));
  }
  const outer = largestOuter(mergeIslands(base).paths);
  if (!outer) return null;

  const ring = fromClipperPath(outer);
  return simplifyShape(ring, [], SIMPLIFY_TOLERANCE)?.outer ?? ring;
}
