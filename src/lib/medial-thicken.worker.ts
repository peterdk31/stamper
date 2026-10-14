import { medialThicken, type FeatureOverlay } from "./medial-thicken";
import type { ShapeData } from "./clipper-thicken";

export interface MedialThickenRequest {
  shapes: ShapeData[];
  stampWidth: number;
  stampHeight: number;
  targetWidth: number;
  minFeatureSize: number;
  thickenEnabled: boolean;
}

export type MedialThickenMessage =
  | { type: "progress"; progress: number; stage: string }
  | { type: "result"; shapesModified: boolean; shapes: ShapeData[]; overlay: FeatureOverlay };

self.onmessage = (e: MessageEvent<MedialThickenRequest>) => {
  const { shapes, stampWidth, stampHeight, targetWidth, minFeatureSize, thickenEnabled } = e.data;
  const post = (msg: MedialThickenMessage, transfer?: Transferable[]) => self.postMessage(msg, { transfer });

  const result = medialThicken(shapes, stampWidth, stampHeight, {
    targetWidth,
    minFeatureSize,
    thicken: thickenEnabled,
    onProgress: (progress, stage) => post({ type: "progress", progress, stage }),
  });

  post({ type: "progress", progress: 1, stage: "Done" });
  post(
    { type: "result", shapesModified: result.modified, shapes: result.modified ? result.shapes : [], overlay: result.overlay },
    [result.overlay.pixels.buffer],
  );
};
