import ClipperLib from "clipper-lib";
import { CLIPPER_SCALE, MIN_AREA_SQ, clipperOffset, fromClipperPath, toClipperPath, type Point } from "./clipper-thicken";
import { sharpenCorners } from "./sharp-corners";

/**
 * Cutter ring around the stamp base: inner edge = base outline + clearance,
 * outer edge = inner + wall. Straight walls and nothing narrower than the base,
 * so stamp and cutter slide past each other in both directions — and stay two
 * separate tools, so clay never gets trapped between cutting wall and relief.
 * `sharpCorners` keeps the base's sharp corners pointed in the ring too.
 */
export function cutterRing(
  outline: Point[], clearance: number, wallThickness: number, sharpCorners = false,
): { outer: Point[]; inner: Point[] } | null {
  const path = toClipperPath(outline);
  if (ClipperLib.Clipper.Area(path) < 0) path.reverse();
  const offset = (d: number) => {
    const round = clipperOffset([path], d * CLIPPER_SCALE);
    return sharpCorners ? sharpenCorners(round, [path], d) : round;
  };
  const inner = largest(offset(clearance));
  const outer = largest(offset(clearance + wallThickness));
  if (!inner || !outer) return null;
  return { outer: fromClipperPath(outer), inner: fromClipperPath(inner) };
}

/** Z range of the ring in stamp coordinates (base back at z = 0, stamp face at z = baseThickness). */
export function cutterZRange(
  baseThickness: number, gripHeight: number, clayThickness: number,
): { bottom: number; top: number } {
  return { bottom: baseThickness - Math.min(gripHeight, baseThickness), top: baseThickness + clayThickness };
}

function largest(paths: ClipperLib.Paths): ClipperLib.Path | null {
  let best: ClipperLib.Path | null = null;
  let bestArea = MIN_AREA_SQ;
  for (const p of paths) {
    const a = ClipperLib.Clipper.Area(p);
    if (a > bestArea) { best = p; bestArea = a; }
  }
  return best;
}
