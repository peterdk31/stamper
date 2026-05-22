import ClipperLib from "clipper-lib";
import { simplifyContour } from "./simplify";

export interface Point {
  x: number;
  y: number;
}

export interface ShapeData {
  outer: Point[];
  holes: Point[][];
  source?: "image" | "text";
}

export const CLIPPER_SCALE = 1000;
export const MIN_AREA_SQ = 0.01 * CLIPPER_SCALE * CLIPPER_SCALE;
export const ARC_TOLERANCE = 0.1 * CLIPPER_SCALE;
export const SIMPLIFY_TOLERANCE = 0.05;

export function toClipperPath(contour: Point[]): ClipperLib.Path {
  return contour.map((p) => ({ X: Math.round(p.x * CLIPPER_SCALE), Y: Math.round(p.y * CLIPPER_SCALE) }));
}

export function fromClipperPath(path: ClipperLib.Path): Point[] {
  return path.map((p) => ({ x: p.X / CLIPPER_SCALE, y: p.Y / CLIPPER_SCALE }));
}

export function computePathMetrics(path: ClipperLib.Path): { area: number; perimeter: number; halfWidth: number } {
  const area = Math.abs(ClipperLib.Clipper.Area(path));
  let perimeter = 0;
  for (let i = 0; i < path.length; i++) {
    const j = (i + 1) % path.length;
    const dx = path[j].X - path[i].X;
    const dy = path[j].Y - path[i].Y;
    perimeter += Math.sqrt(dx * dx + dy * dy);
  }
  const halfWidth = perimeter > 0 ? area / perimeter / CLIPPER_SCALE : 0;
  return { area, perimeter, halfWidth };
}

export function clipperOffset(paths: ClipperLib.Paths, delta: number): ClipperLib.Paths {
  const co = new ClipperLib.ClipperOffset(2, ARC_TOLERANCE);
  for (const p of paths) {
    co.AddPath(p, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
  }
  const result: ClipperLib.Paths = [];
  co.Execute(result, delta);
  return result.filter((p) => Math.abs(ClipperLib.Clipper.Area(p)) > MIN_AREA_SQ);
}

function clipperOffsetMiter(paths: ClipperLib.Paths, delta: number): ClipperLib.Paths {
  const co = new ClipperLib.ClipperOffset(2, ARC_TOLERANCE);
  for (const p of paths) {
    co.AddPath(p, ClipperLib.JoinType.jtMiter, ClipperLib.EndType.etClosedPolygon);
  }
  const result: ClipperLib.Paths = [];
  co.Execute(result, delta);
  return result.filter((p) => Math.abs(ClipperLib.Clipper.Area(p)) > MIN_AREA_SQ);
}

export function clipperBoolOp(
  subjPaths: ClipperLib.Paths,
  clipPaths: ClipperLib.Paths,
  clipType: number,
): ClipperLib.Paths {
  const clipper = new ClipperLib.Clipper();
  for (const p of subjPaths) {
    clipper.AddPath(p, ClipperLib.PolyType.ptSubject, true);
  }
  for (const p of clipPaths) {
    clipper.AddPath(p, ClipperLib.PolyType.ptClip, true);
  }
  const result: ClipperLib.Paths = [];
  clipper.Execute(
    clipType, result,
    ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero,
  );
  return result;
}

export function extractOuterAndHoles(
  paths: ClipperLib.Paths,
  holes: Point[][],
): { outer: Point[]; modified: boolean } {
  const outerPaths: ClipperLib.Paths = [];
  for (const p of paths) {
    const area = ClipperLib.Clipper.Area(p);
    if (area > MIN_AREA_SQ) {
      outerPaths.push(p);
    } else if (area < -MIN_AREA_SQ) {
      holes.push(simplifyContour(fromClipperPath(p), SIMPLIFY_TOLERANCE));
    }
  }

  let merged: ClipperLib.Paths;
  if (outerPaths.length > 1) {
    merged = clipperBoolOp(outerPaths, [], ClipperLib.ClipType.ctUnion);
  } else {
    merged = outerPaths;
  }

  let largest: ClipperLib.Path | null = null;
  let largestArea = 0;
  for (const p of merged) {
    const area = ClipperLib.Clipper.Area(p);
    if (area > MIN_AREA_SQ && area > largestArea) {
      largest = p;
      largestArea = area;
    } else if (area < -MIN_AREA_SQ) {
      holes.push(simplifyContour(fromClipperPath(p), SIMPLIFY_TOLERANCE));
    }
  }

  if (largest) {
    return { outer: simplifyContour(fromClipperPath(largest), SIMPLIFY_TOLERANCE), modified: true };
  }
  return { outer: [], modified: false };
}

export function thickenShapeClipper(
  shape: ShapeData,
  nozzleDiameter: number,
  minLocalHalfWidth: number,
): ShapeData | null {
  const maxOffset = nozzleDiameter / 2;
  const expandOffset = maxOffset - minLocalHalfWidth;
  if (expandOffset < 0.01) return null;

  let modified = false;
  let newOuter = shape.outer;
  const newHoles: Point[][] = [];

  const outerPath = toClipperPath(shape.outer);
  const outerArea = Math.abs(ClipperLib.Clipper.Area(outerPath));

  if (outerArea > MIN_AREA_SQ) {
    const erodedPaths = clipperOffset([outerPath], -maxOffset * CLIPPER_SCALE);

    if (erodedPaths.length === 0) {
      // Entire shape is thinner than nozzle — expand uniformly
      const expandedResult = clipperOffset([outerPath], expandOffset * CLIPPER_SCALE);

      if (expandedResult.length > 0) {
        const result = extractOuterAndHoles(expandedResult, newHoles);
        if (result.modified) {
          newOuter = result.outer;
          modified = true;
        }
      }
    } else {
      // Mixed thin/thick: isolate thin protrusions via morphological opening,
      // expand them, and union back with the original outline.
      // Miter joins preserve straight edges and sharp corners through the
      // erode-dilate round-trip, so only actual thin protrusions appear
      // in the difference (not edge-rounding artifacts).
      const erodedMiter = clipperOffsetMiter([outerPath], -maxOffset * CLIPPER_SCALE);
      if (erodedMiter.length > 0) {
        const openedPaths = clipperOffsetMiter(erodedMiter, maxOffset * CLIPPER_SCALE);
        if (openedPaths.length > 0) {
          const thinPaths = clipperBoolOp(
            [outerPath], openedPaths, ClipperLib.ClipType.ctDifference,
          );
          const significantThin = thinPaths.filter(
            (p) => Math.abs(ClipperLib.Clipper.Area(p)) > MIN_AREA_SQ,
          );
          if (significantThin.length > 0) {
            const expandedThin = clipperOffset(significantThin, expandOffset * CLIPPER_SCALE);
            if (expandedThin.length > 0) {
              const united = clipperBoolOp(
                [outerPath], expandedThin, ClipperLib.ClipType.ctUnion,
              );
              if (united.length > 0) {
                const result = extractOuterAndHoles(united, newHoles);
                if (result.modified) {
                  newOuter = result.outer;
                  modified = true;
                }
              }
            }
          }
        }
      }
    }
  }

  if (!modified) return null;

  for (const hole of shape.holes) {
    const holePath = toClipperPath(hole);
    const holeMetrics = computePathMetrics(holePath);

    if (holeMetrics.area < MIN_AREA_SQ * 4) {
      newHoles.push(hole);
      continue;
    }

    const cappedOffset = Math.min(maxOffset, holeMetrics.halfWidth * 0.6);

    if (cappedOffset < 0.01) {
      newHoles.push(hole);
      continue;
    }

    const co = new ClipperLib.ClipperOffset(2, ARC_TOLERANCE);
    co.AddPath(holePath, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
    const shrunk: ClipperLib.Paths = [];
    co.Execute(shrunk, -cappedOffset * CLIPPER_SCALE);

    const survived = shrunk.filter((p) => Math.abs(ClipperLib.Clipper.Area(p)) > MIN_AREA_SQ);

    if (survived.length === 0) {
      newHoles.push(hole);
    } else {
      for (const p of survived) {
        if (ClipperLib.Clipper.Area(p) > 0) {
          p.reverse();
        }
        newHoles.push(simplifyContour(fromClipperPath(p), SIMPLIFY_TOLERANCE));
      }
      modified = true;
    }
  }

  if (!modified) return null;

  return { outer: newOuter, holes: newHoles, source: shape.source };
}
