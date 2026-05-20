import type { DesignData, StampSettings } from "@/types/stamp";
import type { ThickenMessage } from "@/lib/thicken.worker";
import type { WorkerStep, StepFlags } from "./types";

export const thickenStep: WorkerStep = {
  name: "thicken",
  type: "worker",

  enabled: () => true,

  createWorker: () =>
    new Worker(new URL("../thicken.worker.ts", import.meta.url)),

  buildMessage: (data: DesignData, settings: StampSettings, flags: StepFlags) => ({
    shapes: data.shapes,
    stampWidth: settings.width,
    stampHeight: settings.height,
    nozzleDiameter: settings.nozzleDiameter,
    thickenEnabled: flags.thickenEnabled,
    smoothEnabled: flags.smoothEnabled,
  }),

  parseResult: (message: unknown, prevData: DesignData) => {
    const msg = message as ThickenMessage;
    if (msg.type === "result") {
      if (msg.shapesModified) {
        return {
          shapes: msg.shapes,
          bounds: msg.bounds,
          sourceAspectRatio: prevData.sourceAspectRatio,
          thinFeatureMap: msg.thinFeatureMap,
        };
      }
      return { ...prevData, thinFeatureMap: msg.thinFeatureMap };
    }
    return null;
  },

  parseProgress: (message: unknown): number | null => {
    const msg = message as ThickenMessage;
    if (msg.type === "progress") return msg.progress;
    return null;
  },
};
