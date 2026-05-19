import type { Font } from "three/examples/jsm/loaders/FontLoader.js";
import type { StampText, DesignData } from "@/types/stamp";
import { textEntriesToShapes } from "@/lib/text-to-shapes";
import { shapesToDesignData, computeBounds } from "@/lib/design-data";

export function textToDesignData(
  texts: StampText[],
  fontCache: Map<string, Font>,
  stampWidth: number,
  stampHeight: number,
  padding: number,
): DesignData | null {
  const shapes = textEntriesToShapes(texts, fontCache, stampWidth, stampHeight, 0, padding);
  if (shapes.length === 0) return null;
  const shapeData = shapesToDesignData(shapes);
  return {
    shapes: shapeData,
    bounds: computeBounds(shapeData),
    sourceAspectRatio: null,
  };
}
