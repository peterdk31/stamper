import type { DesignData } from "@/types/stamp";
import { computeBounds } from "@/lib/design-data";

export function mergeDesignData(...sources: (DesignData | null)[]): DesignData | null {
  const allShapes = sources.flatMap((s) => s?.shapes ?? []);
  if (allShapes.length === 0) return null;
  return {
    shapes: allShapes,
    bounds: computeBounds(allShapes),
    sourceAspectRatio: sources.find((s) => s?.sourceAspectRatio != null)?.sourceAspectRatio ?? null,
  };
}
