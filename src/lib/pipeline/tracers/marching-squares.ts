import type { TracerDefinition } from "../tracer-types";
import type { TraceMessage } from "@/lib/image-trace.worker";

export const marchingSquaresTracer: TracerDefinition = {
  id: "marching-squares",
  label: "Marching Squares",
  description: "Iso-line contour tracing with Douglas-Peucker simplification",

  createWorker: () =>
    new Worker(new URL("../../image-trace.worker.ts", import.meta.url)),

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
