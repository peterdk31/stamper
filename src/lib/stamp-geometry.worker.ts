import {
  Shape, Path, ExtrudeGeometry,
} from "three";
import { createFemaleThreadGeometry } from "./thread-geometry";

interface PointData { x: number; y: number }
interface ShapeInput { outer: PointData[]; holes: PointData[][] }

interface GeometryRequest {
  shapes: ShapeInput[];
  width: number;
  height: number;
  baseThickness: number;
  impressionDepth: number;
  cornerRadius: number;
  designMode: "raised" | "recessed";
  threadEnabled: boolean;
  threadConfig: {
    majorDiameter: number;
    pitch: number;
    height: number;
    tolerance: number;
    segments: number;
  };
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
  normalColor: number;
};

function createRoundedRectShape(width: number, height: number, radius: number): Shape {
  const r = Math.min(radius, width / 2, height / 2);
  const shape = new Shape();
  shape.moveTo(r, 0);
  shape.lineTo(width - r, 0);
  shape.quadraticCurveTo(width, 0, width, r);
  shape.lineTo(width, height - r);
  shape.quadraticCurveTo(width, height, width - r, height);
  shape.lineTo(r, height);
  shape.quadraticCurveTo(0, height, 0, height - r);
  shape.lineTo(0, r);
  shape.quadraticCurveTo(0, 0, r, 0);
  return shape;
}

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

function toShapes(data: ShapeInput[]): Shape[] {
  return data.filter(sd => sd.outer.length >= 3).map(sd => {
    const shape = new Shape();
    shape.moveTo(sd.outer[0].x, sd.outer[0].y);
    for (let i = 1; i < sd.outer.length; i++) shape.lineTo(sd.outer[i].x, sd.outer[i].y);
    shape.closePath();
    for (const hole of sd.holes) {
      if (hole.length < 3) continue;
      const path = new Path();
      path.moveTo(hole[0].x, hole[0].y);
      for (let i = 1; i < hole.length; i++) path.lineTo(hole[i].x, hole[i].y);
      shape.holes.push(path);
    }
    return shape;
  });
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

self.onmessage = (e: MessageEvent<GeometryRequest>) => {
  const { shapes: shapeData, width, height, baseThickness, impressionDepth, cornerRadius, designMode, threadEnabled, threadConfig } = e.data;

  const totalHeight = baseThickness + impressionDepth;
  const isRaised = designMode === "raised";
  const baseDepth = isRaised ? baseThickness : totalHeight;
  const baseColor = 0xd4a373;
  const meshes: SerializedMesh[] = [];

  if (threadEnabled) {
    const majorR = threadConfig.majorDiameter / 2;
    const threadDepth = Math.min(threadConfig.height, baseDepth);

    const holedShape = createRoundedRectShape(width, height, cornerRadius);
    const holePath = new Path();
    holePath.absarc(width / 2, height / 2, majorR, 0, Math.PI * 2, true);
    holedShape.holes.push(holePath);

    const backGeo = new ExtrudeGeometry(holedShape, {
      depth: threadDepth, bevelEnabled: false, curveSegments: threadConfig.segments,
    });
    meshes.push(serializeGeo(backGeo, "base-back", baseColor));

    if (threadDepth < baseDepth) {
      const frontShape = createRoundedRectShape(width, height, cornerRadius);
      const frontGeo = new ExtrudeGeometry(frontShape, { depth: baseDepth - threadDepth, bevelEnabled: false });
      meshes.push(serializeGeo(frontGeo, "base-front", baseColor, 0, 0, threadDepth));
    }
  } else {
    const baseShape = createRoundedRectShape(width, height, cornerRadius);
    const baseGeo = new ExtrudeGeometry(baseShape, { depth: baseDepth, bevelEnabled: false });
    meshes.push(serializeGeo(baseGeo, "base", baseColor));
  }

  const shapes = toShapes(shapeData);
  let normalColor = 0;
  if (shapes.length > 0) {
    const mirrored = mirrorShapes(shapes, width);
    normalColor = isRaised ? 0x8b5e3c : 0x6b4226;
    const geo = new ExtrudeGeometry(mirrored, { depth: impressionDepth, bevelEnabled: false });
    const z = isRaised ? baseThickness : totalHeight - impressionDepth;
    meshes.push(serializeGeo(geo, "design", normalColor, 0, 0, z));
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
      px: width / 2, py: height / 2, pz: threadConfig.height,
      rx: Math.PI, ry: 0, rz: 0,
    });
  }

  const transferable: Transferable[] = [];
  for (const m of meshes) {
    transferable.push(m.position.buffer as ArrayBuffer);
    transferable.push(m.normal.buffer as ArrayBuffer);
    if (m.index) transferable.push(m.index.buffer as ArrayBuffer);
  }

  postMessage({ type: "result", meshes, normalColor } satisfies StampGeoMessage, { transfer: transferable });
};
