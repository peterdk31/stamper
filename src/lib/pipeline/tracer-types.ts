import type { StampShapeData } from "@/types/stamp";

export interface ImageAdjustments {
  threshold: number;
  brightness: number;
  contrast: number;
  redWeight: number;
  greenWeight: number;
  blueWeight: number;
  invert: boolean;
}

export interface TracerDefinition {
  id: string;
  label: string;
  description: string;
  maxDimension?: number;
  createWorker: () => Worker;
  buildMessage: (bitmap: ImageBitmap, adjustments: ImageAdjustments) => unknown;
  parseResult: (msg: unknown) => {
    shapes: StampShapeData[];
    imageWidth: number;
    imageHeight: number;
  } | null;
  parseProgress?: (msg: unknown) => {
    progress: number;
    stage: string;
  } | null;
}
