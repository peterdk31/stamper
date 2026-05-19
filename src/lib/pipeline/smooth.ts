import type { DesignData, StampSettings } from "@/types/stamp";
import type { SmoothMessage } from "@/lib/smooth.worker";
import type { WorkerStep } from "./types";

export const smoothStep: WorkerStep = {
  name: "smooth",
  type: "worker",

  enabled: (_settings: StampSettings, flags) => flags.smoothEnabled,

  createWorker: () =>
    new Worker(new URL("../smooth.worker.ts", import.meta.url)),

  buildMessage: (data: DesignData) => ({
    shapes: data.shapes,
  }),

  parseResult: (message: unknown, prevData: DesignData): DesignData => {
    const msg = message as SmoothMessage;
    if (msg.type === "result") {
      return {
        shapes: msg.shapes,
        bounds: msg.bounds,
        sourceAspectRatio: prevData.sourceAspectRatio,
      };
    }
    return prevData;
  },

  parseProgress: (message: unknown): number | null => {
    const msg = message as SmoothMessage;
    if (msg.type === "progress") return msg.progress;
    return null;
  },
};
