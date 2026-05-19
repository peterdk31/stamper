import type { DesignData, StampSettings } from "@/types/stamp";
import type { ThickenMessage } from "@/lib/thicken.worker";
import type { WorkerStep } from "./types";

export const thickenStep: WorkerStep = {
  name: "thicken",
  type: "worker",

  enabled: (_settings: StampSettings, flags) => flags.thickenEnabled,

  createWorker: () =>
    new Worker(new URL("../thicken.worker.ts", import.meta.url)),

  buildMessage: (data: DesignData, settings: StampSettings) => ({
    shapes: data.shapes,
    stampWidth: settings.width,
    stampHeight: settings.height,
    nozzleDiameter: settings.nozzleDiameter,
  }),

  parseResult: (message: unknown, prevData: DesignData): DesignData => {
    const msg = message as ThickenMessage;
    if (msg.type === "result") {
      return {
        shapes: msg.shapes,
        bounds: msg.bounds,
        sourceAspectRatio: prevData.sourceAspectRatio,
      };
    }
    return prevData;
  },
};
