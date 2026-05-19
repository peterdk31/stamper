import * as THREE from "three";
import { SVGLoader } from "three/examples/jsm/loaders/SVGLoader.js";

interface SvgPath {
  color?: THREE.Color;
  subPaths: THREE.Path[];
  userData?: { style?: { fill?: string; stroke?: string; strokeWidth?: string } };
}

function isLightColor(color: THREE.Color): boolean {
  return 0.299 * color.r + 0.587 * color.g + 0.114 * color.b > 0.5;
}

function isStrokeOnly(path: SvgPath): boolean {
  const style = path.userData?.style;
  const noFill = style?.fill === "none" || style?.fill === "transparent";
  const hasStroke = style?.stroke && style.stroke !== "none" && style.stroke !== "transparent";
  return !!(noFill && hasStroke);
}

function isDarkPath(path: SvgPath): boolean {
  const style = path.userData?.style;
  const noFill = style?.fill === "none" || style?.fill === "transparent";
  const hasStroke = style?.stroke && style.stroke !== "none" && style.stroke !== "transparent";

  if (noFill && !hasStroke) return false;
  if (noFill && hasStroke) {
    const c = new THREE.Color(style!.stroke!);
    return !isLightColor(c);
  }
  if (path.color && isLightColor(path.color)) return false;
  return true;
}

function offsetPoints(points: THREE.Vector2[], dist: number, closed: boolean): THREE.Vector2[] {
  const n = points.length;
  const result: THREE.Vector2[] = [];

  for (let i = 0; i < n; i++) {
    const prev = closed ? points[(i - 1 + n) % n] : points[Math.max(0, i - 1)];
    const curr = points[i];
    const next = closed ? points[(i + 1) % n] : points[Math.min(n - 1, i + 1)];

    const d1x = curr.x - prev.x;
    const d1y = curr.y - prev.y;
    const len1 = Math.hypot(d1x, d1y) || 1;
    const d2x = next.x - curr.x;
    const d2y = next.y - curr.y;
    const len2 = Math.hypot(d2x, d2y) || 1;

    const n1x = -d1y / len1, n1y = d1x / len1;
    const n2x = -d2y / len2, n2y = d2x / len2;

    let nx = n1x + n2x;
    let ny = n1y + n2y;
    let nlen = Math.hypot(nx, ny);
    if (nlen < 1e-6) { nx = n1x; ny = n1y; nlen = 1; }
    else { nx /= nlen; ny /= nlen; }

    const dot = n1x * nx + n1y * ny;
    const miter = Math.min(dot > 0.15 ? 1 / dot : 1, 3);

    result.push(new THREE.Vector2(curr.x + nx * dist * miter, curr.y + ny * dist * miter));
  }

  return result;
}

function strokeToShapes(path: SvgPath): THREE.Shape[] {
  const strokeWidth = parseFloat(path.userData?.style?.strokeWidth || "1");
  const halfW = strokeWidth / 2;
  const shapes: THREE.Shape[] = [];

  for (const subPath of path.subPaths) {
    const pts = subPath.getPoints(20);
    if (pts.length < 3) continue;

    const closed = pts[0].distanceTo(pts[pts.length - 1]) < 0.5;
    const points = closed ? pts.slice(0, -1) : pts;

    const outer = offsetPoints(points, halfW, closed);
    const inner = offsetPoints(points, -halfW, closed);

    const shape = new THREE.Shape(outer);
    const hole = new THREE.Path(inner.reverse());
    shape.holes.push(hole);
    shapes.push(shape);
  }

  return shapes;
}

function shapesFromPath(path: SvgPath): THREE.Shape[] {
  if (isStrokeOnly(path)) return strokeToShapes(path);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return SVGLoader.createShapes(path as any);
}

export function getSvgAspectRatio(svgText: string): number | null {
  const loader = new SVGLoader();
  const data = loader.parse(svgText);
  const box = new THREE.Box2();

  for (const path of data.paths) {
    if (!isDarkPath(path)) continue;
    for (const shape of shapesFromPath(path)) {
      for (const p of shape.getPoints()) box.expandByPoint(p);
    }
  }

  const w = box.max.x - box.min.x;
  const h = box.max.y - box.min.y;
  if (w === 0 || h === 0) return null;
  return w / h;
}

export interface RawSvgData {
  shapes: THREE.Shape[];
  box: THREE.Box2;
}

export function parseRawSvg(svgText: string): RawSvgData | null {
  const loader = new SVGLoader();
  const data = loader.parse(svgText);
  const allShapes: THREE.Shape[] = [];
  const box = new THREE.Box2();

  for (const path of data.paths) {
    if (!isDarkPath(path)) continue;
    const pathShapes = shapesFromPath(path);
    allShapes.push(...pathShapes);
    for (const shape of pathShapes) {
      for (const p of shape.getPoints()) box.expandByPoint(p);
    }
  }

  if (allShapes.length === 0) return null;
  return { shapes: allShapes, box };
}

export function scaleRawSvgToStamp(
  raw: RawSvgData,
  targetWidth: number,
  targetHeight: number,
): THREE.Shape[] {
  const svgWidth = raw.box.max.x - raw.box.min.x;
  const svgHeight = raw.box.max.y - raw.box.min.y;
  if (svgWidth === 0 || svgHeight === 0) return raw.shapes;

  const scale = Math.min(targetWidth / svgWidth, targetHeight / svgHeight);
  const margin = (targetHeight - svgHeight * scale) / 2;
  const offsetX = -raw.box.min.x * scale + (targetWidth - svgWidth * scale) / 2;
  const offsetY = raw.box.max.y * scale + margin;

  function transformPoints(pts: THREE.Vector2[]): THREE.Vector2[] {
    return pts.map((p) => new THREE.Vector2(p.x * scale + offsetX, -p.y * scale + offsetY));
  }

  return raw.shapes.map((original) => {
    const points = original.getPoints();
    if (points.length === 0) return new THREE.Shape();

    const transformed = transformPoints(points);
    const shape = new THREE.Shape(transformed);

    for (const hole of original.holes) {
      const holePoints = transformPoints(hole.getPoints());
      shape.holes.push(new THREE.Path(holePoints));
    }

    return shape;
  });
}

export function parseSvgToShapes(
  svgText: string,
  targetWidth: number,
  targetHeight: number,
): THREE.Shape[] {
  const raw = parseRawSvg(svgText);
  if (!raw) return [];
  return scaleRawSvgToStamp(raw, targetWidth, targetHeight);
}
