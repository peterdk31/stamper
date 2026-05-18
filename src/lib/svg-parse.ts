import * as THREE from "three";
import { SVGLoader } from "three/examples/jsm/loaders/SVGLoader.js";

function isDarkPath(path: { color?: THREE.Color; userData?: { style?: { fill?: string } } }): boolean {
  const style = path.userData?.style;
  if (style?.fill === "none" || style?.fill === "transparent") return false;
  if (path.color) {
    const lum = 0.299 * path.color.r + 0.587 * path.color.g + 0.114 * path.color.b;
    if (lum > 0.5) return false;
  }
  return true;
}

export function getSvgAspectRatio(svgText: string): number | null {
  const loader = new SVGLoader();
  const data = loader.parse(svgText);
  const box = new THREE.Box2();

  for (const path of data.paths) {
    if (!isDarkPath(path)) continue;
    const shapes = SVGLoader.createShapes(path);
    for (const shape of shapes) {
      for (const p of shape.getPoints()) box.expandByPoint(p);
    }
  }

  const w = box.max.x - box.min.x;
  const h = box.max.y - box.min.y;
  if (w === 0 || h === 0) return null;
  return w / h;
}

export function parseSvgToShapes(
  svgText: string,
  targetWidth: number,
  targetHeight: number,
): THREE.Shape[] {
  const loader = new SVGLoader();
  const data = loader.parse(svgText);
  const allShapes: THREE.Shape[] = [];

  for (const path of data.paths) {
    if (!isDarkPath(path)) continue;
    const shapes = SVGLoader.createShapes(path);
    allShapes.push(...shapes);
  }

  if (allShapes.length === 0) return [];

  const box = new THREE.Box2();
  for (const shape of allShapes) {
    const pts = shape.getPoints();
    for (const p of pts) {
      box.expandByPoint(p);
    }
  }

  const svgWidth = box.max.x - box.min.x;
  const svgHeight = box.max.y - box.min.y;
  if (svgWidth === 0 || svgHeight === 0) return allShapes;

  const scale = Math.min(targetWidth / svgWidth, targetHeight / svgHeight);
  const margin = (targetHeight - svgHeight * scale) / 2;
  const offsetX = -box.min.x * scale + (targetWidth - svgWidth * scale) / 2;
  const offsetY = box.max.y * scale + margin;

  return allShapes.map((original) => {
    const shape = new THREE.Shape();
    const points = original.getPoints();
    if (points.length === 0) return shape;

    shape.moveTo(
      points[0].x * scale + offsetX,
      -points[0].y * scale + offsetY,
    );
    for (let i = 1; i < points.length; i++) {
      shape.lineTo(
        points[i].x * scale + offsetX,
        -points[i].y * scale + offsetY,
      );
    }
    shape.closePath();
    return shape;
  });
}
