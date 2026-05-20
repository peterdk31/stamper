import type { Font } from "three/examples/jsm/loaders/FontLoader.js";
import type { StampText, DesignData } from "@/types/stamp";
import { computeTextLayout, renderTextPlacements } from "@/lib/text-to-shapes";
import { shapesToDesignData, computeBounds } from "@/lib/design-data";

export interface TextLayoutOutput {
  textData: DesignData | null;
  imageZone: { yMin: number; yMax: number };
}

export function textToDesignData(
  texts: StampText[],
  fontCache: Map<string, Font>,
  stampWidth: number,
  stampHeight: number,
  hasImage: boolean,
): TextLayoutOutput {
  const layout = computeTextLayout(texts, fontCache, stampWidth, stampHeight, hasImage);

  if (layout.placements.length === 0) {
    return {
      textData: null,
      imageZone: layout.imageZone,
    };
  }

  const shapes = renderTextPlacements(layout.placements, stampWidth);
  if (shapes.length === 0) {
    return { textData: null, imageZone: layout.imageZone };
  }

  const shapeData = shapesToDesignData(shapes, "text");
  return {
    textData: {
      shapes: shapeData,
      bounds: computeBounds(shapeData),
      sourceAspectRatio: null,
    },
    imageZone: layout.imageZone,
  };
}
