import * as THREE from "three";
import type { StampPoint, StampShapeData, DesignData } from "@/types/stamp";

export function computeBounds(shapes: StampShapeData[]): DesignData["bounds"] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of shapes) {
    for (const p of s.outer) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  if (minX === Infinity) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return { minX, minY, maxX, maxY };
}

export function rasterToDesignData(
  rawShapes: StampShapeData[],
  rawImageDims: { w: number; h: number },
  stampW: number,
  stampH: number,
  region?: { yMin: number; yMax: number },
): DesignData {
  const regionH = region ? (region.yMax - region.yMin) : stampH;
  const regionY = region ? region.yMin : 0;

  const scale = Math.min(stampW / rawImageDims.w, regionH / rawImageDims.h);
  const offsetX = (stampW - rawImageDims.w * scale) / 2;
  const offsetY = regionY + (regionH - rawImageDims.h * scale) / 2;

  const scalePoint = (p: StampPoint) => ({ x: p.x * scale + offsetX, y: p.y * scale + offsetY });

  const shapes: StampShapeData[] = rawShapes.map((s) => ({
    outer: s.outer.map(scalePoint),
    holes: s.holes.map((h) => h.map(scalePoint)),
  }));

  return {
    shapes,
    bounds: computeBounds(shapes),
    sourceAspectRatio: rawImageDims.w / rawImageDims.h,
  };
}

export function designDataToShapes(data: DesignData): THREE.Shape[] {
  const result: THREE.Shape[] = [];
  for (const sd of data.shapes) {
    if (sd.outer.length < 3) continue;
    const shape = new THREE.Shape();
    shape.moveTo(sd.outer[0].x, sd.outer[0].y);
    for (let i = 1; i < sd.outer.length; i++) shape.lineTo(sd.outer[i].x, sd.outer[i].y);
    shape.closePath();

    for (const hole of sd.holes) {
      if (hole.length < 3) continue;
      const path = new THREE.Path();
      path.moveTo(hole[0].x, hole[0].y);
      for (let i = 1; i < hole.length; i++) path.lineTo(hole[i].x, hole[i].y);
      shape.holes.push(path);
    }

    result.push(shape);
  }
  return result;
}

export function shapesToDesignData(shapes: THREE.Shape[]): StampShapeData[] {
  return shapes.map((s) => ({
    outer: s.getPoints(48).map((p) => ({ x: p.x, y: p.y })),
    holes: s.holes.map((h) => h.getPoints(48).map((p) => ({ x: p.x, y: p.y }))),
  }));
}
