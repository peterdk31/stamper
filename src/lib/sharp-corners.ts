import ClipperLib from "clipper-lib";
import { clipperBoolOp, fromClipperPath, toClipperPath, CLIPPER_SCALE, MIN_AREA_SQ, type Point } from "./clipper-thicken";

/**
 * Sharp corners for outward offsets. A round offset rounds every convex corner
 * by the offset distance. Plain miter joins fix that but turn every small kink
 * of a traced outline into a spike, and square off thin tips into notches.
 *
 * Instead: keep the round offset, find the source's real corners (a hard turn
 * within a short arc, so tracing noise doesn't count), and add a pointed wedge
 * at each one. Thin tips stay pointed but are capped in length instead of
 * being chopped flat. Wedges are only added where the corner is exposed — not
 * where smoothing has already filled the area around it.
 */

/** Arc length over which a corner's turn is measured; smaller wiggles are noise. */
const CORNER_WINDOW = 0.5; // mm
/** Minimum turn over the window for a corner. */
const CORNER_MIN_TURN = (30 * Math.PI) / 180;
/** A tip's point reaches at most this × the offset distance from the corner. */
const TIP_LIMIT = 3;

interface Corner { p: Point; a: Point; b: Point; turn: number }

const sub = (u: Point, v: Point) => ({ x: u.x - v.x, y: u.y - v.y });
const add = (u: Point, v: Point) => ({ x: u.x + v.x, y: u.y + v.y });
const mul = (u: Point, k: number) => ({ x: u.x * k, y: u.y * k });
const norm = (u: Point) => { const l = Math.hypot(u.x, u.y) || 1; return { x: u.x / l, y: u.y / l }; };

function signedArea(ring: Point[]): number {
  let a = 0;
  for (let i = ring.length - 1, j = 0; j < ring.length; i = j++) a += ring[i].x * ring[j].y - ring[j].x * ring[i].y;
  return a / 2;
}

/** Convex corners of a ring (counter-clockwise), one per corner after non-maximum suppression. */
export function findCorners(ring: Point[], window = CORNER_WINDOW, minTurn = CORNER_MIN_TURN): Corner[] {
  const pts = signedArea(ring) < 0 ? ring.slice().reverse() : ring;
  const n = pts.length;
  const cum = [0];
  for (let i = 1; i <= n; i++) cum.push(cum[i - 1] + Math.hypot(pts[i % n].x - pts[i - 1].x, pts[i % n].y - pts[i - 1].y));
  const total = cum[n];
  if (n < 3 || total < 4 * window) return [];

  const at = (s: number): Point => {
    s = ((s % total) + total) % total;
    let lo = 0, hi = n;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= s) lo = mid; else hi = mid; }
    const seg = cum[lo + 1] - cum[lo] || 1, t = (s - cum[lo]) / seg;
    const p = pts[lo], q = pts[(lo + 1) % n];
    return { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t };
  };

  const turns = pts.map((p, i) => {
    const a = norm(sub(p, at(cum[i] - window)));
    const b = norm(sub(at(cum[i] + window), p));
    return { p, a, b, turn: Math.atan2(a.x * b.y - a.y * b.x, a.x * b.x + a.y * b.y) };
  });

  const arcDist = (i: number, j: number) => { const d = Math.abs(cum[i] - cum[j]); return Math.min(d, total - d); };
  // Keep only the sharpest vertex within a window on either side (ties: lowest index).
  const isLocalMax = (i: number) => {
    for (const dir of [1, -1]) {
      for (let k = 1; k < n; k++) {
        const j = (i + dir * k + n) % n;
        if (arcDist(i, j) >= window) break;
        if (turns[j].turn > turns[i].turn || (turns[j].turn === turns[i].turn && j < i)) return false;
      }
    }
    return true;
  };
  return turns.filter((t, i) => t.turn >= minTurn && isLocalMax(i));
}

/** The pointed piece a miter join would add at a corner, with thin tips capped at TIP_LIMIT × d. */
function wedge({ p, a, b, turn }: Corner, d: number): { path: ClipperLib.Path; probes: Point[] } {
  const n1 = { x: a.y, y: -a.x }, n2 = { x: b.y, y: -b.x }; // outward normals of a CCW ring
  const bis = norm(sub(a, b));
  const len = Math.min(d / Math.cos(turn / 2), TIP_LIMIT * d);
  const path = toClipperPath([p, add(p, mul(n1, d)), add(p, mul(bis, len)), add(p, mul(n2, d))]);
  if (ClipperLib.Clipper.Area(path) < 0) path.reverse();
  // Just beyond the round offset at the tip and on both sides of the corner.
  const probes = [bis, n1, n2].map((dir) => add(p, mul(dir, d + 0.05)));
  return { path, probes };
}

function insideAny(pt: Point, paths: ClipperLib.Paths): boolean {
  const ip = { X: Math.round(pt.x * CLIPPER_SCALE), Y: Math.round(pt.y * CLIPPER_SCALE) };
  return paths.some((path) => ClipperLib.Clipper.PointInPolygon(ip, path) !== 0);
}

/**
 * Adds sharp corner wedges to `grown`, a round offset of `source` by `d` mm
 * (possibly smoothed further). A corner gets a wedge only if the round offset
 * is exposed at its tip and on both sides — otherwise the corner sits in a
 * filled-in notch (e.g. a mouth or between finlets) and a wedge would stick out.
 */
export function sharpenCorners(grown: ClipperLib.Paths, source: ClipperLib.Paths, d: number): ClipperLib.Paths {
  if (d <= 0) return grown;
  const wedges: ClipperLib.Paths = [];
  for (const path of source) {
    for (const c of findCorners(fromClipperPath(path))) {
      const w = wedge(c, d);
      if (!w.probes.some((pt) => insideAny(pt, grown))) wedges.push(w.path);
    }
  }
  if (wedges.length === 0) return grown;
  return clipperBoolOp(grown, wedges, ClipperLib.ClipType.ctUnion).filter((p) => ClipperLib.Clipper.Area(p) > MIN_AREA_SQ);
}
