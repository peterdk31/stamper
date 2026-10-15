import { Shape, Path, ExtrudeGeometry } from "three";
import type { CutterConfig, ThreadConfig } from "@/types/stamp";
import { simplifyShape } from "./simplify";
import { createRoundedRectShape } from "./stamp-geometry";
import { createFemaleThreadGeometry } from "./thread-geometry";
import { computeBaseOutline } from "./base-outline";
import { cutterRing, cutterZRange } from "./cutter-geometry";

interface PointData { x: number; y: number }
interface ShapeInput { outer: PointData[]; holes: PointData[][] }

interface GeometryRequest {
  shapes: ShapeInput[];
  width: number;
  height: number;
  margin: number;
  baseThickness: number;
  impressionDepth: number;
  cornerRadius: number;
  threadEnabled: boolean;
  threadConfig: ThreadConfig;
  /** Cutter mode: the base follows the design and a cutter ring is built. */
  cutter: CutterConfig | null;
}

export interface SerializedMesh {
  name: string;
  position: Float32Array;
  normal: Float32Array;
  index: Uint32Array | null;
  color: number;
  px: number; py: number; pz: number;
  rx: number; ry: number; rz: number;
}

export type StampGeoMessage = {
  type: "result";
  meshes: SerializedMesh[];
  /** Cutter ring, in stamp coordinates (it fits around the base as built). Empty without cutter mode. */
  cutterMeshes: SerializedMesh[];
  normalColor: number;
};

function mirrorShapes(shapes: Shape[], width: number): Shape[] {
  return shapes.map((original) => {
    const mirrored = new Shape();
    const points = original.getPoints();
    if (points.length > 0) {
      mirrored.moveTo(width - points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) {
        mirrored.lineTo(width - points[i].x, points[i].y);
      }
      mirrored.closePath();
    }
    for (const hole of original.holes) {
      const holePath = new Path();
      const holePoints = hole.getPoints();
      if (holePoints.length === 0) continue;
      holePath.moveTo(width - holePoints[0].x, holePoints[0].y);
      for (let i = 1; i < holePoints.length; i++) {
        holePath.lineTo(width - holePoints[i].x, holePoints[i].y);
      }
      mirrored.holes.push(holePath);
    }
    return mirrored;
  });
}

const SIMPLIFY_TOLERANCE = 0.05;

function pointsToShape(outer: PointData[], holes: PointData[][] = []): Shape {
  const shape = new Shape();
  shape.moveTo(outer[0].x, outer[0].y);
  for (let i = 1; i < outer.length; i++) shape.lineTo(outer[i].x, outer[i].y);
  shape.closePath();
  for (const h of holes) {
    const path = new Path();
    path.moveTo(h[0].x, h[0].y);
    for (let i = 1; i < h.length; i++) path.lineTo(h[i].x, h[i].y);
    shape.holes.push(path);
  }
  return shape;
}

function toShapes(data: ShapeInput[]): Shape[] {
  return data.filter(sd => sd.outer.length >= 3).map(sd => {
    const simplified = simplifyShape(sd.outer, sd.holes, SIMPLIFY_TOLERANCE);
    if (!simplified) return null;
    return pointsToShape(simplified.outer, simplified.holes);
  }).filter((s): s is Shape => s !== null);
}

function serializeGeo(
  geo: ExtrudeGeometry,
  name: string, color: number,
  px = 0, py = 0, pz = 0,
  rx = 0, ry = 0, rz = 0,
): SerializedMesh {
  const posAttr = geo.getAttribute("position");
  const normAttr = geo.getAttribute("normal");
  return {
    name, color,
    position: new Float32Array(posAttr.array),
    normal: normAttr ? new Float32Array(normAttr.array) : new Float32Array(0),
    index: geo.index ? new Uint32Array(geo.index.array) : null,
    px, py, pz, rx, ry, rz,
  };
}

const OVERLAP = 0.01;

self.onmessage = (e: MessageEvent<GeometryRequest>) => {
  const { shapes: shapeData, width, height, margin, baseThickness, impressionDepth, cornerRadius, threadEnabled, threadConfig, cutter } = e.data;

  const physW = width + margin * 2;
  const physH = height + margin * 2;

  const baseColor = 0xd4a373;
  const meshes: SerializedMesh[] = [];

  const shapes = toShapes(shapeData);
  const mirrored = shapes.length > 0 ? mirrorShapes(shapes, width) : [];
  let normalColor = 0;

  const baseBottomDepth = baseThickness;

  // Cutter mode: base outline follows the design. Computed unmirrored in
  // design-area coordinates, mirrored and placed here like the design.
  const outline = cutter ? computeBaseOutline({
    shapes: shapeData, width, height, offset: cutter.offset, fidelity: cutter.fidelity,
    threadDiameter: threadEnabled ? threadConfig.majorDiameter : null,
  }) : null;
  const mirroredOutline = outline?.map(p => ({ x: margin + width - p.x, y: margin + p.y })) ?? null;
  const baseShape = () => mirroredOutline
    ? pointsToShape(mirroredOutline)
    : createRoundedRectShape(physW, physH, cornerRadius);

  if (threadEnabled) {
    const majorR = threadConfig.majorDiameter / 2;
    const threadDepth = Math.min(threadConfig.height, baseBottomDepth);

    const holedShape = baseShape();
    const holePath = new Path();
    holePath.absarc(physW / 2, physH / 2, majorR, 0, Math.PI * 2, true);
    holedShape.holes.push(holePath);

    const backGeo = new ExtrudeGeometry(holedShape, {
      depth: threadDepth, bevelEnabled: false, curveSegments: threadConfig.segments,
    });
    meshes.push(serializeGeo(backGeo, "base-back", baseColor));

    if (threadDepth < baseBottomDepth) {
      const frontShape = baseShape();
      const frontGeo = new ExtrudeGeometry(frontShape, {
        depth: baseBottomDepth - threadDepth + OVERLAP,
        bevelEnabled: false,
      });
      meshes.push(serializeGeo(frontGeo, "base-front", baseColor, 0, 0, threadDepth - OVERLAP));
    }
  } else {
    const baseGeo = new ExtrudeGeometry(baseShape(), { depth: baseBottomDepth, bevelEnabled: false });
    meshes.push(serializeGeo(baseGeo, "base", baseColor));
  }

  if (mirrored.length > 0) {
    normalColor = 0x8b5e3c;
    const geo = new ExtrudeGeometry(mirrored, {
      depth: impressionDepth + OVERLAP,
      bevelEnabled: false,
    });
    meshes.push(serializeGeo(geo, "design", normalColor, margin, margin, baseThickness - OVERLAP));
  }

  if (threadEnabled) {
    const threadGeo = createFemaleThreadGeometry(threadConfig);
    const normAttr = threadGeo.getAttribute("normal");
    meshes.push({
      name: "thread",
      color: 0x6b4226,
      position: new Float32Array(threadGeo.getAttribute("position").array),
      normal: normAttr ? new Float32Array(normAttr.array) : new Float32Array(0),
      index: threadGeo.index ? new Uint32Array(threadGeo.index.array) : null,
      px: physW / 2, py: physH / 2, pz: threadConfig.height,
      rx: Math.PI, ry: 0, rz: 0,
    });
  }

  const cutterMeshes: SerializedMesh[] = [];
  if (cutter) {
    const ringOutline = mirroredOutline
      ?? createRoundedRectShape(physW, physH, cornerRadius).getPoints().map(p => ({ x: p.x, y: p.y }));
    const ring = cutterRing(ringOutline, cutter.clearance, cutter.wallThickness);
    if (ring) {
      const { bottom, top } = cutterZRange(baseThickness, cutter.gripHeight, cutter.clayThickness);
      const geo = new ExtrudeGeometry(pointsToShape(ring.outer, [ring.inner]), { depth: top - bottom, bevelEnabled: false });
      cutterMeshes.push(serializeGeo(geo, "cutter", 0xc4521a, 0, 0, bottom));
    }
  }

  const transferable: Transferable[] = [];
  for (const m of [...meshes, ...cutterMeshes]) {
    transferable.push(m.position.buffer as ArrayBuffer);
    transferable.push(m.normal.buffer as ArrayBuffer);
    if (m.index) transferable.push(m.index.buffer as ArrayBuffer);
  }

  postMessage({ type: "result", meshes, cutterMeshes, normalColor } satisfies StampGeoMessage, { transfer: transferable });
};
