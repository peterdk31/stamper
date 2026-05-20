interface Point {
  x: number;
  y: number;
}

interface ShapeData {
  outer: Point[];
  holes: Point[][];
  source?: "image" | "text";
}

interface BoundsData {
  minX: number; minY: number; maxX: number; maxY: number;
}

export interface SmoothRequest {
  shapes: ShapeData[];
  iterations: number;
}

export type SmoothMessage =
  | { type: "progress"; progress: number }
  | { type: "result"; shapes: ShapeData[]; bounds: BoundsData };

const ITERATIONS = 6;

function chaikinSmooth(points: Point[]): Point[] {
  if (points.length < 3) return points;
  const result: Point[] = [];
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const p0 = points[i];
    const p1 = points[(i + 1) % n];
    result.push(
      { x: 0.6 * p0.x + 0.4 * p1.x, y: 0.6 * p0.y + 0.4 * p1.y },
      { x: 0.4 * p0.x + 0.6 * p1.x, y: 0.4 * p0.y + 0.6 * p1.y },
    );
  }
  return result;
}

self.onmessage = (e: MessageEvent<SmoothRequest>) => {
  const { shapes } = e.data;
  const post = self.postMessage.bind(self);

  const imageShapes = shapes.filter((s) => s.source !== "text");
  const textShapes = shapes.filter((s) => s.source === "text");

  let current = imageShapes;

  for (let iter = 0; iter < ITERATIONS; iter++) {
    post({ type: "progress", progress: iter / ITERATIONS } as SmoothMessage);

    current = current.map((shape) => ({
      outer: chaikinSmooth(shape.outer),
      holes: shape.holes.map((h) => chaikinSmooth(h)),
      source: shape.source,
    }));
  }

  current = [...current, ...textShapes];

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of current) {
    for (const p of s.outer) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }

  const bounds: BoundsData = minX === Infinity
    ? { minX: 0, minY: 0, maxX: 0, maxY: 0 }
    : { minX, minY, maxX, maxY };

  post({ type: "progress", progress: 1 } as SmoothMessage);
  post({ type: "result", shapes: current, bounds } as SmoothMessage);
};
