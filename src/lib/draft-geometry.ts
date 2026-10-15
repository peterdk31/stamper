import ClipperLib from "clipper-lib";
import { CLIPPER_SCALE, MIN_AREA_SQ, fromClipperPath, toClipperPath, type ShapeData } from "./clipper-thicken";

/**
 * Draft angle on the relief: the face keeps the exact design outline and the
 * walls flare outward toward the base, so the stamp releases from clay.
 *
 * Built as a stack of thin layers, each the design grown by the draft at the
 * layer's top. Every layer is inside the one below it, so the stamp prints
 * face-up without overhangs.
 */

export interface DraftLayer {
  /** Layer bottom and top, measured up from the relief's base. */
  z0: number;
  z1: number;
  shapes: ShapeData[];
}

/** Layer height of the stack, mm. Finer than any print layer, so the steps never show. */
export const DRAFT_STEP = 0.1;
const MAX_LAYERS = 40;
/** Miter length cap (× offset): corners stay sharp, as on a true taper, but needle tips don't spike. */
const MITER_LIMIT = 4;

export function draftLayers(shapes: ShapeData[], depth: number, angleDeg: number): DraftLayer[] {
  if (angleDeg <= 0 || depth <= 0) return [{ z0: 0, z1: depth, shapes }];

  // Even-odd union normalizes ring orientation (outers positive, holes negative) for the offset
  const c = new ClipperLib.Clipper();
  for (const s of shapes) {
    for (const ring of [s.outer, ...s.holes]) {
      if (ring.length >= 3) c.AddPath(toClipperPath(ring), ClipperLib.PolyType.ptSubject, true);
    }
  }
  const design: ClipperLib.Paths = [];
  c.Execute(ClipperLib.ClipType.ctUnion, design, ClipperLib.PolyFillType.pftEvenOdd, ClipperLib.PolyFillType.pftEvenOdd);

  const n = Math.min(MAX_LAYERS, Math.max(1, Math.ceil(depth / DRAFT_STEP)));
  const h = depth / n;
  const tan = Math.tan((angleDeg * Math.PI) / 180);
  const layers: DraftLayer[] = [];
  for (let i = 0; i < n; i++) {
    const z1 = (i + 1) * h;
    const grow = (depth - z1) * tan;
    layers.push({ z0: i * h, z1, shapes: i === n - 1 ? shapes : grownShapes(design, grow) });
  }
  return layers;
}

function grownShapes(design: ClipperLib.Paths, mm: number): ShapeData[] {
  const co = new ClipperLib.ClipperOffset(MITER_LIMIT);
  co.AddPaths(design, ClipperLib.JoinType.jtMiter, ClipperLib.EndType.etClosedPolygon);
  const tree = new ClipperLib.PolyTree();
  co.Execute(tree, mm * CLIPPER_SCALE);

  const out: ShapeData[] = [];
  const walk = (node: ClipperLib.PolyNode) => {
    for (const outerNode of node.Childs()) {
      const holes = outerNode.Childs()
        .filter((holeNode) => Math.abs(ClipperLib.Clipper.Area(holeNode.Contour())) >= MIN_AREA_SQ)
        .map((holeNode) => fromClipperPath(holeNode.Contour()));
      if (Math.abs(ClipperLib.Clipper.Area(outerNode.Contour())) >= MIN_AREA_SQ) {
        out.push({ outer: fromClipperPath(outerNode.Contour()), holes });
      }
      for (const holeNode of outerNode.Childs()) walk(holeNode); // islands inside holes
    }
  };
  walk(tree);
  return out;
}
