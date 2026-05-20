import {
  Shape, Path, ExtrudeGeometry, BufferGeometry, Float32BufferAttribute,
} from "three";

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

const STEPS_PER_PITCH = 32;
const WALL_OVERLAP = 2;

function isoMetricDimensions(majorDiameter: number, pitch: number) {
  const H = (Math.sqrt(3) / 2) * pitch;
  const threadDepth = (5 * H) / 8;
  const majorR = majorDiameter / 2;
  const minorR = majorR - threadDepth;
  return { threadDepth, majorR, minorR };
}

function threadProfile(phase: number): number {
  const p = ((phase % 1) + 1) % 1;
  const crestHalf = 1 / 16;
  const flank = 5 / 16;
  const rootFlat = 1 / 4;
  if (p < crestHalf) return 1;
  if (p < crestHalf + flank) return 1 - (p - crestHalf) / flank;
  if (p < crestHalf + flank + rootFlat) return 0;
  if (p < crestHalf + flank + rootFlat + flank) return (p - crestHalf - flank - rootFlat) / flank;
  return 1;
}

function createFemaleThreadGeometry(config: GeometryRequest["threadConfig"]): BufferGeometry {
  const { majorDiameter, pitch, height, segments } = config;
  const { threadDepth, majorR } = isoMetricDimensions(majorDiameter, pitch);
  const outerR = majorR + WALL_OVERLAP;
  const revolutions = height / pitch;
  const totalZSteps = Math.ceil(revolutions * STEPS_PER_PITCH);
  const vertices: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= totalZSteps; i++) {
    const z = (i / totalZSteps) * height;
    for (let j = 0; j <= segments; j++) {
      const circumAngle = (j / segments) * Math.PI * 2;
      const helixPhase = z / pitch + circumAngle / (Math.PI * 2);
      const profile = threadProfile(helixPhase);
      const distFromEntry = height - z;
      const taper = Math.min(distFromEntry / pitch, 1);
      const r = majorR - profile * threadDepth * taper;
      vertices.push(Math.cos(circumAngle) * r, Math.sin(circumAngle) * r, z);
      vertices.push(Math.cos(circumAngle) * outerR, Math.sin(circumAngle) * outerR, z);
    }
  }
  const ringSize = (segments + 1) * 2;
  for (let i = 0; i < totalZSteps; i++) {
    for (let j = 0; j < segments; j++) {
      const curr = i * ringSize + j * 2;
      const next = curr + ringSize;
      indices.push(curr, next, next + 2);
      indices.push(curr, next + 2, curr + 2);
      indices.push(curr + 1, curr + 3, next + 3);
      indices.push(curr + 1, next + 3, next + 1);
    }
  }
  const bottomCenter = vertices.length / 3;
  vertices.push(0, 0, 0);
  for (let j = 0; j <= segments; j++) {
    const segAngle = (j / segments) * Math.PI * 2;
    vertices.push(Math.cos(segAngle) * outerR, Math.sin(segAngle) * outerR, 0);
  }
  for (let j = 0; j < segments; j++) {
    indices.push(bottomCenter, bottomCenter + 1 + ((j + 1) % (segments + 1)), bottomCenter + 1 + j);
  }
  const geo = new BufferGeometry();
  geo.setAttribute("position", new Float32BufferAttribute(vertices, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

const OVERLAP = 0.01;

self.onmessage = (e: MessageEvent<GeometryRequest>) => {
  const { shapes: shapeData, width, height, margin, baseThickness, impressionDepth, cornerRadius, threadEnabled, threadConfig } = e.data;

  const physW = width + margin * 2;
  const physH = height + margin * 2;

  const baseColor = 0xd4a373;
  const meshes: SerializedMesh[] = [];

  const shapes = toShapes(shapeData);
  const mirrored = shapes.length > 0 ? mirrorShapes(shapes, width) : [];
  let normalColor = 0;

  const baseBottomDepth = baseThickness;

  if (threadEnabled) {
    const majorR = threadConfig.majorDiameter / 2;
    const threadDepth = Math.min(threadConfig.height, baseBottomDepth);

    const holedShape = createRoundedRectShape(physW, physH, cornerRadius);
    const holePath = new Path();
    holePath.absarc(physW / 2, physH / 2, majorR, 0, Math.PI * 2, true);
    holedShape.holes.push(holePath);

    const backGeo = new ExtrudeGeometry(holedShape, {
      depth: threadDepth, bevelEnabled: false, curveSegments: threadConfig.segments,
    });
    meshes.push(serializeGeo(backGeo, "base-back", baseColor));

    if (threadDepth < baseBottomDepth) {
      const frontShape = createRoundedRectShape(physW, physH, cornerRadius);
      const frontGeo = new ExtrudeGeometry(frontShape, {
        depth: baseBottomDepth - threadDepth + OVERLAP,
        bevelEnabled: false,
      });
      meshes.push(serializeGeo(frontGeo, "base-front", baseColor, 0, 0, threadDepth - OVERLAP));
    }
  } else {
    const baseShape = createRoundedRectShape(physW, physH, cornerRadius);
    const baseGeo = new ExtrudeGeometry(baseShape, { depth: baseBottomDepth, bevelEnabled: false });
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

  const transferable: Transferable[] = [];
  for (const m of meshes) {
    transferable.push(m.position.buffer as ArrayBuffer);
    transferable.push(m.normal.buffer as ArrayBuffer);
    if (m.index) transferable.push(m.index.buffer as ArrayBuffer);
  }

  postMessage({ type: "result", meshes, normalColor } satisfies StampGeoMessage, { transfer: transferable });
};
