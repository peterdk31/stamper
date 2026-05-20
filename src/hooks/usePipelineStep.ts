import { useEffect, useMemo, useRef, useReducer } from "react";
import type { StampSettings, DesignData } from "@/types/stamp";
import type { PipelineStep, StepFlags, StepResult } from "@/lib/pipeline/types";

type WorkerState = {
  data: DesignData | null;
  isProcessing: boolean;
  progress: number;
};

type WorkerAction =
  | { type: "start" }
  | { type: "progress"; progress: number }
  | { type: "done"; data: DesignData }
  | { type: "error" }
  | { type: "reset" };

function workerReducer(state: WorkerState, action: WorkerAction): WorkerState {
  switch (action.type) {
    case "start":
      return { data: null, isProcessing: true, progress: 0 };
    case "progress":
      return { ...state, progress: action.progress };
    case "done":
      return { data: action.data, isProcessing: false, progress: 1 };
    case "error":
      return { data: null, isProcessing: false, progress: 0 };
    case "reset":
      return { data: null, isProcessing: false, progress: 0 };
  }
}

export function usePipelineStep(
  step: PipelineStep,
  input: DesignData | null,
  settings: StampSettings,
  flags: StepFlags,
): StepResult {
  const [workerState, dispatch] = useReducer(workerReducer, { data: null, isProcessing: false, progress: 0 });
  const workerRef = useRef<Worker | null>(null);

  const enabled = input !== null && input.shapes.length > 0 && step.enabled(settings, flags);

  const syncResult = useMemo(() => {
    if (!enabled || step.type !== "sync" || !input) return null;
    return step.process(input, settings);
  }, [enabled, step, input, settings]);

  useEffect(() => {
    if (step.type !== "worker") return;

    if (!enabled || !input) {
      if (workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
      }
      dispatch({ type: "reset" });
      return;
    }

    dispatch({ type: "start" });

    if (workerRef.current) {
      workerRef.current.terminate();
    }

    const worker = step.createWorker();
    workerRef.current = worker;

    worker.onmessage = (e: MessageEvent) => {
      if (workerRef.current !== worker) return;

      if (step.parseProgress) {
        const p = step.parseProgress(e.data);
        if (p !== null) {
          dispatch({ type: "progress", progress: p });
        }
      }

      const parsed = step.parseResult(e.data, input);
      if (parsed !== null) {
        dispatch({ type: "done", data: parsed });
      }
    };

    worker.onerror = () => {
      if (workerRef.current !== worker) return;
      dispatch({ type: "error" });
    };

    worker.postMessage(step.buildMessage(input, settings, flags));

    return () => {
      worker.terminate();
      if (workerRef.current === worker) workerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, input, settings.width, settings.height, settings.nozzleDiameter, step, flags.thickenEnabled, flags.smoothEnabled]);

  if (!enabled) return { data: input, isProcessing: false, progress: 0 };
  if (step.type === "sync") return { data: syncResult ?? input, isProcessing: false, progress: 0 };
  return { data: workerState.data ?? input, isProcessing: workerState.isProcessing, progress: workerState.progress };
}
