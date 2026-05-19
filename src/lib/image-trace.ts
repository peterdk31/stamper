import * as THREE from "three";
import { simplifyContour } from "./simplify";

interface Point {
  x: number;
  y: number;
}

export function contoursToShapes(contours: Point[][]): THREE.Shape[] {
  return contours.map((contour) => {
    const shape = new THREE.Shape();
    shape.moveTo(contour[0].x, contour[0].y);
    for (let i = 1; i < contour.length; i++) {
      shape.lineTo(contour[i].x, contour[i].y);
    }
    shape.closePath();
    return shape;
  });
}

export function traceImageToShapes(
  imageData: ImageData,
  targetWidth: number,
  targetHeight: number,
  simplification = 0.5,
  threshold = 128,
): THREE.Shape[] {
  const { width, height, data } = imageData;

  // Build binary grid: true = "ink" (dark pixel)
  const grid: boolean[] = new Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    const a = data[i * 4 + 3];
    const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
    grid[i] = a > 128 && luminance < threshold;
  }

  let contours = traceContours(grid, width, height);

  if (simplification > 0) {
    const tolerance = simplification * 5;
    contours = contours
      .map((c) => simplifyContour(c, tolerance))
      .filter((c) => c.length >= 3);
  }

  const scaleX = targetWidth / width;
  const scaleY = targetHeight / height;

  return contours.map((contour) => {
    const shape = new THREE.Shape();
    const first = contour[0];
    shape.moveTo(first.x * scaleX, (height - first.y) * scaleY);
    for (let i = 1; i < contour.length; i++) {
      shape.lineTo(contour[i].x * scaleX, (height - contour[i].y) * scaleY);
    }
    shape.closePath();
    return shape;
  });
}

interface Point {
  x: number;
  y: number;
}

function traceContours(grid: boolean[], width: number, height: number): Point[][] {
  const visited = new Set<string>();
  const contours: Point[][] = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!grid[y * width + x]) continue;

      const isEdge =
        x === 0 || y === 0 || x === width - 1 || y === height - 1 ||
        !grid[y * width + (x - 1)] ||
        !grid[y * width + (x + 1)] ||
        !grid[(y - 1) * width + x] ||
        !grid[(y + 1) * width + x];

      if (!isEdge) continue;

      const key = `${x},${y}`;
      if (visited.has(key)) continue;

      const contour = followContour(grid, width, height, x, y, visited);
      if (contour.length >= 3) {
        contours.push(contour);
      }
    }
  }

  return contours;
}

const DIRECTIONS = [
  { dx: 1, dy: 0 },
  { dx: 1, dy: 1 },
  { dx: 0, dy: 1 },
  { dx: -1, dy: 1 },
  { dx: -1, dy: 0 },
  { dx: -1, dy: -1 },
  { dx: 0, dy: -1 },
  { dx: 1, dy: -1 },
];

function followContour(
  grid: boolean[],
  width: number,
  height: number,
  startX: number,
  startY: number,
  visited: Set<string>,
): Point[] {
  const contour: Point[] = [];
  let x = startX;
  let y = startY;
  let dir = 0;

  do {
    const key = `${x},${y}`;
    if (!visited.has(key)) {
      visited.add(key);
      contour.push({ x, y });
    }

    let found = false;
    for (let i = 0; i < DIRECTIONS.length; i++) {
      const tryDir = (dir + DIRECTIONS.length - 1 + i) % DIRECTIONS.length;
      const nx = x + DIRECTIONS[tryDir].dx;
      const ny = y + DIRECTIONS[tryDir].dy;

      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      if (!grid[ny * width + nx]) continue;

      const isEdge =
        nx === 0 || ny === 0 || nx === width - 1 || ny === height - 1 ||
        !grid[ny * width + (nx - 1)] ||
        !grid[ny * width + (nx + 1)] ||
        !grid[(ny - 1) * width + nx] ||
        !grid[(ny + 1) * width + nx];

      if (!isEdge) continue;

      x = nx;
      y = ny;
      dir = tryDir;
      found = true;
      break;
    }

    if (!found) break;
  } while (x !== startX || y !== startY);

  return contour;
}
