import type { StampShapeData } from "@/types/stamp";

export interface TracerDefinition {
  id: string;
  label: string;
  description: string;
  createWorker: () => Worker;
  buildMessage: (bitmap: ImageBitmap, threshold: number) => unknown;
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
