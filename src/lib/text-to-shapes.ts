import * as THREE from "three";
import type { Font } from "three/examples/jsm/loaders/FontLoader.js";
import type { StampText } from "@/types/stamp";

function rotatePoint(x: number, y: number, cx: number, cy: number, angle: number): [number, number] {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dx = x - cx;
  const dy = y - cy;
  return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos];
}

function layoutEntry(
  entry: StampText,
  font: Font,
  letterSpacingExtra: number,
): { textW: number; textH: number; charShapes: { shapes: THREE.Shape[]; box: THREE.Box2 }[] } | null {
  const charShapes: { shapes: THREE.Shape[]; box: THREE.Box2 }[] = [];
  let cursor = 0;

  for (let ci = 0; ci < entry.content.length; ci++) {
    const char = entry.content[ci];
    const spacing = letterSpacingExtra + (entry.letterSpacing ?? 0);
    if (char === " ") {
      cursor += entry.fontSize * 0.3 + spacing;
      continue;
    }
    const shapes = font.generateShapes(char, entry.fontSize);
    if (shapes.length === 0) continue;

    const charBox = new THREE.Box2();
    for (const s of shapes) for (const p of s.getPoints(48)) charBox.expandByPoint(p);

    const shiftX = cursor - charBox.min.x;
    const shifted = shapes.map((s) => {
      const ns = new THREE.Shape();
      const pts = s.getPoints(48);
      if (pts.length === 0) return ns;
      ns.moveTo(pts[0].x + shiftX, pts[0].y);
      for (let i = 1; i < pts.length; i++) ns.lineTo(pts[i].x + shiftX, pts[i].y);
      ns.closePath();
      for (const hole of s.holes) {
        const hp = new THREE.Path();
        const hpts = hole.getPoints(48);
        if (hpts.length === 0) continue;
        hp.moveTo(hpts[0].x + shiftX, hpts[0].y);
        for (let i = 1; i < hpts.length; i++) hp.lineTo(hpts[i].x + shiftX, hpts[i].y);
        ns.holes.push(hp);
      }
      return ns;
    });

    cursor += (charBox.max.x - charBox.min.x) + spacing;

    const shiftedBox = new THREE.Box2();
    for (const s of shifted) for (const p of s.getPoints(48)) shiftedBox.expandByPoint(p);
    charShapes.push({ shapes: shifted, box: shiftedBox });
  }

  if (charShapes.length === 0) return null;

  const box = new THREE.Box2();
  for (const cs of charShapes) box.union(cs.box);

  return { textW: box.max.x - box.min.x, textH: box.max.y - box.min.y, charShapes };
}

export function computeTextBounds(
  texts: StampText[],
  fontCache: Map<string, Font>,
  minFeatureWidth = 0,
): { width: number; height: number } | null {
  const letterSpacingExtra = minFeatureWidth;
  const totalBox = new THREE.Box2();

  for (const entry of texts) {
    if (!entry.content) continue;
    const font = fontCache.get(entry.fontFamily);
    if (!font) continue;

    const result = layoutEntry(entry, font, letterSpacingExtra);
    if (!result) continue;

    const { textW, textH } = result;
    const rotRad = (entry.rotation * Math.PI) / 180;

    const corners: [number, number][] = [
      [entry.x - textW / 2, entry.y - textH / 2],
      [entry.x + textW / 2, entry.y - textH / 2],
      [entry.x + textW / 2, entry.y + textH / 2],
      [entry.x - textW / 2, entry.y + textH / 2],
    ];

    for (const [cx, cy] of corners) {
      if (rotRad !== 0) {
        const [rx, ry] = rotatePoint(cx, cy, 0, 0, rotRad);
        totalBox.expandByPoint(new THREE.Vector2(rx, ry));
      } else {
        totalBox.expandByPoint(new THREE.Vector2(cx, cy));
      }
    }
  }

  if (totalBox.isEmpty()) return null;
  return {
    width: totalBox.max.x - totalBox.min.x,
    height: totalBox.max.y - totalBox.min.y,
  };
}

export function textEntriesToShapes(
  texts: StampText[],
  fontCache: Map<string, Font>,
  stampWidth: number,
  stampHeight: number,
  minFeatureWidth = 0,
  padding = 0,
): THREE.Shape[] {
  const letterSpacingExtra = minFeatureWidth;

  // Phase 1: generate raw shapes in content space (origin = content center)
  interface RawShape {
    points: THREE.Vector2[];
    holes: THREE.Vector2[][];
  }
  const rawShapes: RawShape[] = [];

  for (const entry of texts) {
    if (!entry.content) continue;
    const font = fontCache.get(entry.fontFamily);
    if (!font) continue;

    const result = layoutEntry(entry, font, letterSpacingExtra);
    if (!result) continue;

    const { textW, textH, charShapes } = result;

    const box = new THREE.Box2();
    for (const cs of charShapes) box.union(cs.box);

    const offsetX = -textW / 2 - box.min.x + entry.x;
    const offsetY = -textH / 2 - box.min.y + entry.y;
    const rotRad = (entry.rotation * Math.PI) / 180;

    for (const original of charShapes.flatMap(cs => cs.shapes)) {
      const points = original.getPoints(48).map(p => {
        let x = p.x + offsetX;
        let y = p.y + offsetY;
        if (rotRad !== 0) [x, y] = rotatePoint(x, y, 0, 0, rotRad);
        return new THREE.Vector2(x, y);
      });

      const holes: THREE.Vector2[][] = [];
      for (const hole of original.holes) {
        holes.push(hole.getPoints(48).map(p => {
          let x = p.x + offsetX;
          let y = p.y + offsetY;
          if (rotRad !== 0) [x, y] = rotatePoint(x, y, 0, 0, rotRad);
          return new THREE.Vector2(x, y);
        }));
      }

      rawShapes.push({ points, holes });
    }
  }

  if (rawShapes.length === 0) return [];

  // Phase 2: compute bounds, scale to fill stamp, center
  const totalBox = new THREE.Box2();
  for (const rs of rawShapes) for (const p of rs.points) totalBox.expandByPoint(p);

  const totalW = totalBox.max.x - totalBox.min.x;
  const totalH = totalBox.max.y - totalBox.min.y;
  const contentCenterX = (totalBox.min.x + totalBox.max.x) / 2;
  const contentCenterY = (totalBox.min.y + totalBox.max.y) / 2;

  const availW = stampWidth - padding * 2;
  const availH = stampHeight - padding * 2;
  const scale = totalW > 0 && totalH > 0
    ? Math.min(availW / totalW, availH / totalH)
    : 1;

  const stampCenterX = stampWidth / 2;
  const stampCenterY = stampHeight / 2;

  const allShapes: THREE.Shape[] = [];
  for (const rs of rawShapes) {
    const transformed = rs.points.map(p => new THREE.Vector2(
      (p.x - contentCenterX) * scale + stampCenterX,
      (p.y - contentCenterY) * scale + stampCenterY,
    ));

    if (transformed.length === 0) continue;
    const shape = new THREE.Shape();
    shape.moveTo(transformed[0].x, transformed[0].y);
    for (let i = 1; i < transformed.length; i++) shape.lineTo(transformed[i].x, transformed[i].y);
    shape.closePath();

    for (const holePoints of rs.holes) {
      const th = holePoints.map(p => new THREE.Vector2(
        (p.x - contentCenterX) * scale + stampCenterX,
        (p.y - contentCenterY) * scale + stampCenterY,
      ));
      if (th.length === 0) continue;
      const holePath = new THREE.Path();
      holePath.moveTo(th[0].x, th[0].y);
      for (let i = 1; i < th.length; i++) holePath.lineTo(th[i].x, th[i].y);
      shape.holes.push(holePath);
    }

    allShapes.push(shape);
  }

  return allShapes;
}
