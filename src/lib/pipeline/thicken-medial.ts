import type { DesignData, StampSettings, ThinFeatureMap } from "@/types/stamp";
import type { MedialThickenMessage, MedialThickenRequest } from "@/lib/medial-thicken.worker";
import { computeBounds } from "@/lib/design-data";
import type { WorkerStep, StepFlags } from "./types";

export const medialThickenStep: WorkerStep = {
  name: "thicken-medial",
  type: "worker",

  enabled: () => true,

  createWorker: () =>
    new Worker(new URL("../medial-thicken.worker.ts", import.meta.url)),

  buildMessage: (data: DesignData, settings: StampSettings, flags: StepFlags): MedialThickenRequest => ({
    shapes: data.shapes,
    stampWidth: settings.width,
    stampHeight: settings.height,
    targetWidth: (settings.nozzleDiameter * settings.minPerimeterWidthPct) / 100,
    minFeatureSize: (settings.nozzleDiameter * settings.minFeatureSizePct) / 100,
    thickenEnabled: flags.thickenEnabled,
  }),

  parseResult: (message: unknown, prevData: DesignData) => {
    const msg = message as MedialThickenMessage;
    if (msg.type !== "result") return null;

    const { overlay } = msg;
    const thinFeatureMap: ThinFeatureMap = {
      // After thickening nothing should be thin; anything left is flagged as a bug
      hasThinFeatures: overlay.residual,
      pixels: overlay.pixels,
      gridW: overlay.gridW,
      gridH: overlay.gridH,
      changes: {
        thickened: msg.shapesModified,
        widened: overlay.widened,
        rescued: overlay.rescued,
        targetWidth: overlay.targetWidth,
        minFeatureSize: overlay.minFeatureSize,
      },
    };

    if (msg.shapesModified) {
      return {
        shapes: msg.shapes,
        bounds: computeBounds(msg.shapes),
        sourceAspectRatio: prevData.sourceAspectRatio,
        thinFeatureMap,
      };
    }
    return { ...prevData, thinFeatureMap };
  },

  parseProgress: (message: unknown): number | null => {
    const msg = message as MedialThickenMessage;
    if (msg.type === "progress") return msg.progress;
    return null;
  },
};
