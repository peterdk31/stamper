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

/**
 * Whether any two edges of the closed rings cross, within a ring or between
 * rings. Edges are bucketed on a uniform grid, so large shapes stay fast.
 */
export function ringsCross(rings: Pt[][]): boolean {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, count = 0;
  for (const ring of rings) {
    for (const p of ring) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    count += ring.length;
  }
  if (count < 4) return false;
  const cell = Math.max((maxX - minX) || 1, (maxY - minY) || 1) / Math.max(1, Math.sqrt(count));
  const ix = (v: number, min: number) => Math.floor((v - min) / cell);

  // Edge e of ring r goes from ring[e] to ring[e + 1]
  const ringOf: number[] = [], edgeOf: number[] = [];
  const buckets = new Map<number, number[]>();
  const cols = ix(maxX, minX) + 1;
  rings.forEach((ring, r) => {
    for (let e = 0; e < ring.length; e++) {
      const a = ring[e], b = ring[(e + 1) % ring.length];
      const id = ringOf.length;
      ringOf.push(r);
      edgeOf.push(e);
      const x1 = ix(Math.max(a.x, b.x), minX), y1 = ix(Math.max(a.y, b.y), minY);
      for (let y = ix(Math.min(a.y, b.y), minY); y <= y1; y++) {
        for (let x = ix(Math.min(a.x, b.x), minX); x <= x1; x++) {
          const key = y * cols + x;
          let list = buckets.get(key);
          if (!list) { list = []; buckets.set(key, list); }
          list.push(id);
        }
      }
    }
  });

  for (const list of buckets.values()) {
    for (let i = 0; i < list.length; i++) {
      const ri = ringOf[list[i]], ei = edgeOf[list[i]], ring = rings[ri];
      const a = ring[ei], b = ring[(ei + 1) % ring.length];
      for (let j = i + 1; j < list.length; j++) {
        const rj = ringOf[list[j]], ej = edgeOf[list[j]];
        // Neighbouring edges of one ring share a vertex, which isn't a crossing
        if (ri === rj && ((ej - ei + ring.length) % ring.length <= 1 || (ei - ej + ring.length) % ring.length <= 1)) continue;
        const other = rings[rj];
        const c = other[ej], d = other[(ej + 1) % other.length];
        if (segmentsIntersect(a.x, a.y, b.x, b.y, c.x, c.y, d.x, d.y)) return true;
      }
    }
  }
  return false;
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
