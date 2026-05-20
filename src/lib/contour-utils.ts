interface Pt {
  x: number;
  y: number;
}

function segmentsIntersect(
  ax: number, ay: number, bx: number, by: number,
  cx: number, cy: number, dx: number, dy: number,
): boolean {
  const dABx = bx - ax, dABy = by - ay;
  const dCDx = dx - cx, dCDy = dy - cy;
  const denom = dABx * dCDy - dABy * dCDx;
  if (Math.abs(denom) < 1e-10) return false;
  const dACx = cx - ax, dACy = cy - ay;
  const t = (dACx * dCDy - dACy * dCDx) / denom;
  const u = (dACx * dABy - dACy * dABx) / denom;
  return t > 1e-6 && t < 1 - 1e-6 && u > 1e-6 && u < 1 - 1e-6;
}

export function hasSelfIntersection(points: Pt[]): boolean {
  const n = points.length;
  if (n < 4) return false;
  for (let i = 0; i < n; i++) {
    const ni = (i + 1) % n;
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const nj = (j + 1) % n;
      if (segmentsIntersect(
        points[i].x, points[i].y, points[ni].x, points[ni].y,
        points[j].x, points[j].y, points[nj].x, points[nj].y,
      )) return true;
    }
  }
  return false;
}
