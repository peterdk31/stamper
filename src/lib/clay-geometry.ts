import ClipperLib from "clipper-lib";
import { MIN_AREA_SQ, fromClipperPath, toClipperPath, type Point } from "./clipper-thicken";

/**
 * Clay impression preview: what the pressed tile looks like. The tile is a
 * solid slab whose top `impressionDepth` is the tile outline minus the design,
 * so the design shows as pockets. Built from the *unmirrored* shapes — the
 * clay reads the right way round, the stamp is its mirror image.
 */

export interface ClayShape { outer: Point[]; holes: Point[][] }

/**
 * Tile outline minus the design: the top layer of the clay, as outers with
 * holes. Design shapes may overlap each other (text over an image); they are
 * unioned first, and their own holes (the inside of an "O") stay as clay.
 */
export function clayTopShapes(tile: Point[], design: { outer: Point[]; holes: Point[][] }[]): ClayShape[] {
  const oriented = (ring: Point[], ccw: boolean) => {
    const path = toClipperPath(ring);
    if ((ClipperLib.Clipper.Area(path) > 0) !== ccw) path.reverse();
    return path;
  };
  const c = new ClipperLib.Clipper();
  c.AddPath(oriented(tile, true), ClipperLib.PolyType.ptSubject, true);
  for (const s of design) {
    if (s.outer.length < 3) continue;
    // Outers CCW and holes CW, so non-zero fill unions overlapping shapes without losing their holes
    c.AddPath(oriented(s.outer, true), ClipperLib.PolyType.ptClip, true);
    for (const h of s.holes) if (h.length >= 3) c.AddPath(oriented(h, false), ClipperLib.PolyType.ptClip, true);
  }
  const tree = new ClipperLib.PolyTree();
  c.Execute(ClipperLib.ClipType.ctDifference, tree, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);

  const out: ClayShape[] = [];
  const walk = (node: ClipperLib.PolyNode) => {
    for (const outerNode of node.Childs()) {
      const holes: Point[][] = [];
      for (const holeNode of outerNode.Childs()) {
        if (Math.abs(ClipperLib.Clipper.Area(holeNode.Contour())) >= MIN_AREA_SQ) holes.push(fromClipperPath(holeNode.Contour()));
        walk(holeNode); // clay islands inside a pocket
      }
      if (Math.abs(ClipperLib.Clipper.Area(outerNode.Contour())) >= MIN_AREA_SQ) {
        out.push({ outer: fromClipperPath(outerNode.Contour()), holes });
      }
    }
  };
  walk(tree);
  return out;
}
