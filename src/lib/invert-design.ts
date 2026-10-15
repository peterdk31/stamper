import ClipperLib from "clipper-lib";
import type { StampPoint, StampShapeData, DesignData } from "@/types/stamp";
import { MIN_AREA_SQ, toClipperPath, fromClipperPath } from "./clipper-thicken";
import { computeBounds } from "./design-data";

/**
 * Invert the design inside its own silhouette: what was relief becomes a
 * channel and what was enclosed becomes relief. Unlike the pixel invert, the
 * background outside the design stays empty, so the cutter base still follows
 * the subject. Silhouette = union of every outer ring (holes ignored); the
 * result is silhouette minus the design (even-odd, so islands count).
 */
export function invertWithinSilhouette(data: DesignData): DesignData {
  const outers = data.shapes.map((s) => s.outer).filter((r) => r.length >= 3);
  if (outers.length === 0) return data;
  const designRings = data.shapes.flatMap((s) => [s.outer, ...s.holes]).filter((r) => r.length >= 3);

  const c = new ClipperLib.Clipper();
  c.AddPaths(outers.map(toClipperPath), ClipperLib.PolyType.ptSubject, true);
  c.AddPaths(designRings.map(toClipperPath), ClipperLib.PolyType.ptClip, true);
  const tree = new ClipperLib.PolyTree();
  c.Execute(ClipperLib.ClipType.ctDifference, tree, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftEvenOdd);

  const source = data.shapes[0]?.source;
  const shapes: StampShapeData[] = [];
  const walk = (node: ClipperLib.PolyNode) => {
    for (const outerNode of node.Childs()) {
      const holes: StampPoint[][] = [];
      for (const holeNode of outerNode.Childs()) {
        if (Math.abs(ClipperLib.Clipper.Area(holeNode.Contour())) >= MIN_AREA_SQ) holes.push(fromClipperPath(holeNode.Contour()));
        walk(holeNode); // islands inside the hole
      }
      if (Math.abs(ClipperLib.Clipper.Area(outerNode.Contour())) >= MIN_AREA_SQ) {
        shapes.push({ outer: fromClipperPath(outerNode.Contour()), holes, ...(source && { source }) });
      }
    }
  };
  walk(tree);

  return { ...data, shapes, bounds: computeBounds(shapes) };
}
