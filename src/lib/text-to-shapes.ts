import * as THREE from "three";
import type { Font } from "three/examples/jsm/loaders/FontLoader.js";
import type { StampText } from "@/types/stamp";

// ---------------------------------------------------------------------------
// Single-line character layout (unchanged core logic from before)
// ---------------------------------------------------------------------------

interface CharShape {
  shapes: THREE.Shape[];
  box: THREE.Box2;
}

function layoutLine(
  text: string,
  fontSize: number,
  font: Font,
  letterSpacing: number,
): { charShapes: CharShape[]; width: number; height: number; box: THREE.Box2 } | null {
  const charShapes: CharShape[] = [];
  let cursor = 0;

  for (const char of text) {
    if (char === " ") {
      cursor += fontSize * 0.3 + letterSpacing;
      continue;
    }
    const shapes = font.generateShapes(char, fontSize);
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

    cursor += (charBox.max.x - charBox.min.x) + letterSpacing;

    const shiftedBox = new THREE.Box2();
    for (const s of shifted) for (const p of s.getPoints(48)) shiftedBox.expandByPoint(p);
    charShapes.push({ shapes: shifted, box: shiftedBox });
  }

  if (charShapes.length === 0) return null;

  const box = new THREE.Box2();
  for (const cs of charShapes) box.union(cs.box);

  return {
    charShapes,
    width: box.max.x - box.min.x,
    height: box.max.y - box.min.y,
    box,
  };
}

// ---------------------------------------------------------------------------
// Multiline entry measurement
// ---------------------------------------------------------------------------

interface LineMeasurement {
  layout: ReturnType<typeof layoutLine>;
  height: number;
}

export interface EntryMeasurement {
  lines: LineMeasurement[];
  maxLineWidth: number;
  totalHeight: number;
  lineGap: number;
}

export function measureEntry(entry: StampText, font: Font): EntryMeasurement | null {
  const lineTexts = entry.content.split("\n");
  if (lineTexts.length === 0) return null;

  const lines: LineMeasurement[] = [];
  let maxWidth = 0;
  const lineGap = entry.fontSize * 0.4;
  let totalH = 0;

  for (let i = 0; i < lineTexts.length; i++) {
    const text = lineTexts[i].trim();
    if (!text) {
      const h = entry.fontSize * 0.6;
      lines.push({ layout: null, height: h });
      totalH += h;
    } else {
      const layout = layoutLine(text, entry.fontSize, font, entry.letterSpacing);
      const h = layout ? layout.height : entry.fontSize * 0.6;
      lines.push({ layout, height: h });
      if (layout) maxWidth = Math.max(maxWidth, layout.width);
      totalH += h;
    }
    if (i < lineTexts.length - 1) totalH += lineGap;
  }

  if (maxWidth === 0) return null;

  return { lines, maxLineWidth: maxWidth, totalHeight: totalH, lineGap };
}

// ---------------------------------------------------------------------------
// Layout computation — positions entries in vertical zones
// ---------------------------------------------------------------------------

export interface TextPlacement {
  measurement: EntryMeasurement;
  yTop: number;
  scale: number;
}

export interface TextLayoutResult {
  placements: TextPlacement[];
  imageZone: { yMin: number; yMax: number };
  totalTextHeight: number;
}

const ELEMENT_GAP = 1.5; // mm between text zones and image

export function computeTextLayout(
  texts: StampText[],
  fontCache: Map<string, Font>,
  stampWidth: number,
  stampHeight: number,
  hasImage: boolean,
): TextLayoutResult {
  const availW = stampWidth;

  const measured: { entry: StampText; measurement: EntryMeasurement; displayH: number; scale: number }[] = [];
  for (const entry of texts) {
    if (!entry.content.trim()) continue;
    const font = fontCache.get(entry.fontFamily);
    if (!font) continue;
    const m = measureEntry(entry, font);
    if (!m) continue;
    const scale = m.maxLineWidth > 0 ? Math.min(1, availW / m.maxLineWidth) : 1;
    measured.push({ entry, measurement: m, displayH: m.totalHeight * scale, scale });
  }

  if (!hasImage || measured.length === 0) {
    const gaps = measured.length > 1 ? ELEMENT_GAP * (measured.length - 1) : 0;
    const totalH = measured.reduce((s, m) => s + m.displayH, 0) + gaps;

    let y = stampHeight / 2 + totalH / 2;
    const placements: TextPlacement[] = [];
    for (const m of measured) {
      placements.push({ measurement: m.measurement, yTop: y, scale: m.scale });
      y -= m.displayH + ELEMENT_GAP;
    }

    return {
      placements,
      imageZone: { yMin: 0, yMax: stampHeight },
      totalTextHeight: totalH,
    };
  }

  // With image: split into top/bottom zones
  const topEntries = measured.filter((m) => m.entry.align === "top");
  const bottomEntries = measured.filter((m) => m.entry.align === "bottom");

  const topInternalGaps = topEntries.length > 1 ? ELEMENT_GAP * (topEntries.length - 1) : 0;
  const bottomInternalGaps = bottomEntries.length > 1 ? ELEMENT_GAP * (bottomEntries.length - 1) : 0;

  const topH = topEntries.reduce((s, m) => s + m.displayH, 0) + topInternalGaps;
  const bottomH = bottomEntries.reduce((s, m) => s + m.displayH, 0) + bottomInternalGaps;

  const topGap = topEntries.length > 0 ? ELEMENT_GAP : 0;
  const bottomGap = bottomEntries.length > 0 ? ELEMENT_GAP : 0;

  const imageYMax = stampHeight - topH - topGap;
  const imageYMin = bottomH + bottomGap;

  const placements: TextPlacement[] = [];

  // Top entries: stack downward from stamp top
  let y = stampHeight;
  for (const m of topEntries) {
    placements.push({ measurement: m.measurement, yTop: y, scale: m.scale });
    y -= m.displayH + ELEMENT_GAP;
  }

  // Bottom entries: stack upward from stamp bottom
  y = 0;
  for (let i = bottomEntries.length - 1; i >= 0; i--) {
    const m = bottomEntries[i];
    placements.push({ measurement: m.measurement, yTop: y + m.displayH, scale: m.scale });
    y += m.displayH + ELEMENT_GAP;
  }

  return {
    placements,
    imageZone: { yMin: Math.max(0, imageYMin), yMax: Math.min(stampHeight, imageYMax) },
    totalTextHeight: topH + bottomH,
  };
}

// ---------------------------------------------------------------------------
// Compute required stamp height for auto-sizing
// ---------------------------------------------------------------------------

export function computeRequiredHeight(
  texts: StampText[],
  fontCache: Map<string, Font>,
  stampWidth: number,
  hasImage: boolean,
  imageAspectRatio: number | null,
): number | null {
  const measured: { entry: StampText; displayH: number }[] = [];
  for (const entry of texts) {
    if (!entry.content.trim()) continue;
    const font = fontCache.get(entry.fontFamily);
    if (!font) continue;
    const m = measureEntry(entry, font);
    if (!m) continue;
    const scale = m.maxLineWidth > 0 ? Math.min(1, stampWidth / m.maxLineWidth) : 1;
    measured.push({ entry, displayH: m.totalHeight * scale });
  }

  if (measured.length === 0 && !hasImage) return null;

  if (!hasImage) {
    const gaps = measured.length > 1 ? ELEMENT_GAP * (measured.length - 1) : 0;
    return measured.reduce((s, m) => s + m.displayH, 0) + gaps;
  }

  const topEntries = measured.filter((m) => m.entry.align === "top");
  const bottomEntries = measured.filter((m) => m.entry.align === "bottom");

  const topGaps = topEntries.length > 0 ? ELEMENT_GAP + (topEntries.length > 1 ? ELEMENT_GAP * (topEntries.length - 1) : 0) : 0;
  const bottomGaps = bottomEntries.length > 0 ? ELEMENT_GAP + (bottomEntries.length > 1 ? ELEMENT_GAP * (bottomEntries.length - 1) : 0) : 0;

  const topH = topEntries.reduce((s, m) => s + m.displayH, 0);
  const bottomH = bottomEntries.reduce((s, m) => s + m.displayH, 0);

  const imageH = imageAspectRatio && imageAspectRatio > 0
    ? stampWidth / imageAspectRatio
    : 0;

  return topH + topGaps + imageH + bottomGaps + bottomH;
}

export function computeRequiredWidth(
  texts: StampText[],
  fontCache: Map<string, Font>,
  targetHeight: number,
  hasImage: boolean,
  imageAspectRatio: number | null,
): number | null {
  const hasTexts = texts.some((t) => t.content.trim() && fontCache.has(t.fontFamily));

  if (!hasTexts) {
    if (hasImage && imageAspectRatio && imageAspectRatio > 0) {
      return targetHeight * imageAspectRatio;
    }
    return null;
  }

  const lo = 10;
  const hi = 200;
  const hLo = computeRequiredHeight(texts, fontCache, lo, hasImage, imageAspectRatio);
  const hHi = computeRequiredHeight(texts, fontCache, hi, hasImage, imageAspectRatio);
  if (hLo === null || hHi === null) return null;
  if (hLo >= targetHeight) return lo;
  if (hHi <= targetHeight) return hi;

  let a = lo, b = hi;
  for (let i = 0; i < 30; i++) {
    const mid = (a + b) / 2;
    const h = computeRequiredHeight(texts, fontCache, mid, hasImage, imageAspectRatio);
    if (h === null) return null;
    if (h < targetHeight) a = mid; else b = mid;
  }
  return Math.round((a + b) / 2 * 10) / 10;
}

// ---------------------------------------------------------------------------
// Render placements to THREE.Shape[]
// ---------------------------------------------------------------------------

export function renderTextPlacements(
  placements: TextPlacement[],
  stampWidth: number,
): THREE.Shape[] {
  const allShapes: THREE.Shape[] = [];
  const stampCenterX = stampWidth / 2;

  for (const { measurement, yTop, scale } of placements) {
    let lineY = yTop;

    for (const { layout, height } of measurement.lines) {
      if (!layout) {
        lineY -= height * scale + measurement.lineGap * scale;
        continue;
      }

      const lineCenterX = (layout.box.min.x + layout.box.max.x) / 2;
      const offsetX = stampCenterX - lineCenterX * scale;
      const offsetY = lineY - layout.box.max.y * scale;

      for (const cs of layout.charShapes) {
        for (const shape of cs.shapes) {
          const pts = shape.getPoints(48);
          if (pts.length === 0) continue;

          const ns = new THREE.Shape();
          ns.moveTo(pts[0].x * scale + offsetX, pts[0].y * scale + offsetY);
          for (let i = 1; i < pts.length; i++) {
            ns.lineTo(pts[i].x * scale + offsetX, pts[i].y * scale + offsetY);
          }
          ns.closePath();

          for (const hole of shape.holes) {
            const hpts = hole.getPoints(48);
            if (hpts.length === 0) continue;
            const hp = new THREE.Path();
            hp.moveTo(hpts[0].x * scale + offsetX, hpts[0].y * scale + offsetY);
            for (let i = 1; i < hpts.length; i++) {
              hp.lineTo(hpts[i].x * scale + offsetX, hpts[i].y * scale + offsetY);
            }
            ns.holes.push(hp);
          }

          allShapes.push(ns);
        }
      }

      lineY -= height * scale + measurement.lineGap * scale;
    }
  }

  return allShapes;
}
