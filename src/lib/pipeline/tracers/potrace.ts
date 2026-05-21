import type { TracerDefinition } from "../tracer-types";
import type { TraceMessage } from "@/lib/potrace.worker";

export const potraceTracer: TracerDefinition = {
  id: "potrace",
  label: "Potrace",
  description: "Pixel-boundary tracing with optimal polygon decomposition",
  maxDimension: 1000,

  createWorker: () =>
    new Worker(new URL("../../potrace.worker.ts", import.meta.url)),

  buildMessage: (bitmap, threshold) => ({ bitmap, threshold }),

  parseResult: (message) => {
    const msg = message as TraceMessage;
    if (msg.type === "result") {
      return { shapes: msg.shapes, imageWidth: msg.imageWidth, imageHeight: msg.imageHeight };
    }
    return null;
  },

  parseProgress: (message) => {
    const msg = message as TraceMessage;
    if (msg.type === "progress") {
      return { progress: msg.progress, stage: msg.stage };
    }
    return null;
  },
};
