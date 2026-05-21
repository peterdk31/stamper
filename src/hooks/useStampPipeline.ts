"use client";

import { useState, useEffect, useMemo, useRef, useReducer } from "react";
import * as THREE from "three";
import type { StampSettings, StampText, DesignData, ThinFeatureMap } from "@/types/stamp";
import type { StampShapeData } from "@/types/stamp";
import { rasterToDesignData, designDataToShapes } from "@/lib/design-data";
import { getFontCache } from "@/lib/font-manager";
import { computeRequiredHeight, computeRequiredWidth } from "@/lib/text-to-shapes";
import { textToDesignData } from "@/lib/pipeline/text";
import { mergeDesignData } from "@/lib/pipeline/merge";
import { smoothStep } from "@/lib/pipeline/smooth";
import { getTracer, getStepVariant } from "@/lib/pipeline/registry";
import type { TracerDefinition } from "@/lib/pipeline/tracer-types";
import type { StepFlags } from "@/lib/pipeline/types";
import { usePipelineStep } from "./usePipelineStep";

// ---------------------------------------------------------------------------
// Input / output types
// ---------------------------------------------------------------------------

export interface PipelineInputs {
  settings: StampSettings;
  setSettings: React.Dispatch<React.SetStateAction<StampSettings>>;
  imageDataUrl: string | null;
  svgText: string | null;
  texts: StampText[];
  fontsReady: boolean;
  thickenEnabled: boolean;
  smoothEnabled: boolean;
  tracerAlgorithm: string;
  thickenAlgorithm: string;
}

export interface PipelineOutputs {
  shapes: THREE.Shape[];
  effectiveSettings: StampSettings;
  rawDesignShapes: THREE.Shape[];
  thinFeatureMap: ThinFeatureMap | null;

  isTracing: boolean;
  traceProgress: number;
  traceStage: string;
  isThickening: boolean;
  isSmoothing: boolean;
  isProcessing: boolean;
  pipelineProgress: number;
  pipelineStage: string;
  hasDesign: boolean;

  sourceAspectRatio: number | null;
}

// ---------------------------------------------------------------------------
// Source: image/SVG → raw contours (independent of stamp dimensions)
// ---------------------------------------------------------------------------

interface TraceState {
  rawShapes: StampShapeData[] | null;
  rawImageDims: { w: number; h: number } | null;
  isTracing: boolean;
  traceProgress: number;
  traceStage: string;
}

type TraceAction =
  | { type: "loading"; stage: string }
  | { type: "progress"; progress: number; stage: string }
  | { type: "result"; shapes: StampShapeData[]; imageWidth: number; imageHeight: number }
  | { type: "error" }
  | { type: "clear" };

function traceReducer(state: TraceState, action: TraceAction): TraceState {
  switch (action.type) {
    case "loading":
      return { ...state, isTracing: true, traceProgress: 0, traceStage: action.stage };
    case "progress":
      return { ...state, traceProgress: action.progress, traceStage: action.stage };
    case "result":
      return {
        rawShapes: action.shapes,
        rawImageDims: { w: action.imageWidth, h: action.imageHeight },
        isTracing: false, traceProgress: 1, traceStage: "",
      };
    case "error":
      return { ...state, isTracing: false };
    case "clear":
      return { rawShapes: null, rawImageDims: null, isTracing: false, traceProgress: 0, traceStage: "" };
  }
}

const INITIAL_TRACE_STATE: TraceState = {
  rawShapes: null, rawImageDims: null, isTracing: false, traceProgress: 0, traceStage: "",
};

interface TraceOutput {
  rawShapes: StampShapeData[] | null;
  rawImageDims: { w: number; h: number } | null;
  sourceAspectRatio: number | null;
  isTracing: boolean;
  traceProgress: number;
  traceStage: string;
}

function useImageTrace(
  tracer: TracerDefinition,
  imageDataUrl: string | null,
  svgText: string | null,
  threshold: number,
): TraceOutput {
  const [state, dispatch] = useReducer(traceReducer, INITIAL_TRACE_STATE);
  const workerRef = useRef<Worker | null>(null);

  useEffect(() => {
    const src = imageDataUrl
      ?? (svgText ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText)}` : null);

    if (!src) {
      dispatch({ type: "clear" });
      if (workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
      }
      return;
    }

    dispatch({ type: "loading", stage: svgText ? "Rendering SVG…" : "Loading image…" });

    let cancelled = false;
    const img = new window.Image();

    img.onerror = () => {
      if (!cancelled) dispatch({ type: "error" });
    };

    img.onload = () => {
      if (cancelled) return;
      const MAX_TRACE_DIM = 2000;
      const scale = svgText
        ? MAX_TRACE_DIM / Math.max(img.width, img.height)
        : Math.min(1, MAX_TRACE_DIM / Math.max(img.width, img.height));
      const tw = Math.round(img.width * scale);
      const th = Math.round(img.height * scale);

      dispatch({ type: "loading", stage: "Preparing…" });

      // SVGs must be drawn to a canvas at the target size so the browser's
      // SVG renderer rasterizes at full resolution. createImageBitmap with
      // resize options rasterizes at the intrinsic size first, producing a
      // blurry or empty bitmap for SVGs.
      const bitmapPromise = svgText
        ? (() => {
            const c = document.createElement("canvas");
            c.width = tw;
            c.height = th;
            const ctx = c.getContext("2d")!;
            ctx.drawImage(img, 0, 0, tw, th);
            return createImageBitmap(c);
          })()
        : createImageBitmap(img, { resizeWidth: tw, resizeHeight: th });

      bitmapPromise.then((bitmap) => {
        if (cancelled) { bitmap.close(); return; }

        if (workerRef.current) {
          workerRef.current.terminate();
        }

        dispatch({ type: "loading", stage: "Starting…" });

        const worker = tracer.createWorker();
        workerRef.current = worker;

        worker.onmessage = (e: MessageEvent) => {
          if (cancelled || workerRef.current !== worker) return;

          if (tracer.parseProgress) {
            const p = tracer.parseProgress(e.data);
            if (p) {
              dispatch({ type: "progress", progress: p.progress, stage: p.stage });
              return;
            }
          }

          const result = tracer.parseResult(e.data);
          if (result) {
            dispatch({ type: "result", shapes: result.shapes, imageWidth: result.imageWidth, imageHeight: result.imageHeight });
            worker.terminate();
            if (workerRef.current === worker) workerRef.current = null;
          }
        };

        worker.onerror = () => {
          if (cancelled || workerRef.current !== worker) return;
          dispatch({ type: "error" });
          worker.terminate();
          if (workerRef.current === worker) workerRef.current = null;
        };

        const msg = tracer.buildMessage(bitmap, threshold);
        worker.postMessage(msg, [bitmap]);
      }).catch(() => {
        if (!cancelled) dispatch({ type: "error" });
      });
    };

    img.src = src;

    return () => {
      cancelled = true;
      if (workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
      }
    };
  }, [imageDataUrl, svgText, threshold, tracer]);

  const sourceAspectRatio = useMemo(() => {
    if (state.rawImageDims) return state.rawImageDims.w / state.rawImageDims.h;
    return null;
  }, [state.rawImageDims]);

  return {
    rawShapes: state.rawShapes,
    rawImageDims: state.rawImageDims,
    sourceAspectRatio,
    isTracing: state.isTracing,
    traceProgress: state.traceProgress,
    traceStage: state.traceStage,
  };
}

// ---------------------------------------------------------------------------
// Effective settings (auto-size from content dimensions)
// ---------------------------------------------------------------------------

function useEffectiveSettings(
  settings: StampSettings,
  sourceAspectRatio: number | null,
  texts: StampText[],
  fontsReady: boolean,
  hasImage: boolean,
): StampSettings {
  const minDim = settings.threadEnabled
    ? Math.max(10, settings.threadConfig.majorDiameter + 4)
    : 10;

  const effectiveDims = useMemo(() => {
    if (settings.fitDimension === "off") return { width: settings.width, height: settings.height };

    const hasTexts = texts.length > 0 && fontsReady;
    if (!hasTexts && !sourceAspectRatio) return { width: settings.width, height: settings.height };

    if (settings.fitDimension === "height") {
      if (hasTexts) {
        const w = computeRequiredWidth(texts, getFontCache(), settings.height, hasImage, sourceAspectRatio);
        if (w !== null) {
          return { width: Math.round(Math.max(minDim, w) * 10) / 10, height: settings.height };
        }
      } else if (sourceAspectRatio && sourceAspectRatio > 0) {
        const w = settings.height * sourceAspectRatio;
        return { width: Math.round(Math.max(minDim, w) * 10) / 10, height: settings.height };
      }
      return { width: settings.width, height: settings.height };
    }

    const required = hasTexts
      ? computeRequiredHeight(texts, getFontCache(), settings.width, hasImage, sourceAspectRatio)
      : null;

    if (required !== null) {
      return { width: settings.width, height: Math.round(Math.max(minDim, required) * 10) / 10 };
    }

    if (sourceAspectRatio && sourceAspectRatio > 0) {
      const h = settings.width / sourceAspectRatio;
      return { width: settings.width, height: Math.round(Math.max(minDim, h) * 10) / 10 };
    }

    return { width: settings.width, height: settings.height };
  }, [
    settings.fitDimension, settings.height, settings.width,
    minDim, sourceAspectRatio, texts, fontsReady, hasImage,
  ]);

  return useMemo(
    () => (effectiveDims.width !== settings.width || effectiveDims.height !== settings.height)
      ? { ...settings, width: effectiveDims.width, height: effectiveDims.height }
      : settings,
    [settings, effectiveDims.width, effectiveDims.height],
  );
}

// ---------------------------------------------------------------------------
// Full pipeline composition
// ---------------------------------------------------------------------------

export function useStampPipeline(inputs: PipelineInputs): PipelineOutputs {
  const { settings, setSettings, imageDataUrl, svgText, texts, fontsReady, thickenEnabled, smoothEnabled, tracerAlgorithm, thickenAlgorithm } = inputs;

  // 1. Trace image (produces raw contours, independent of stamp dimensions)
  const tracer = useMemo(() => getTracer(tracerAlgorithm), [tracerAlgorithm]);
  const trace = useImageTrace(tracer, imageDataUrl, svgText, settings.threshold);

  const hasImage = !!(trace.rawShapes && trace.rawImageDims);

  // 2. Effective settings (auto-size based on stacked layout)
  const effectiveSettings = useEffectiveSettings(settings, trace.sourceAspectRatio, texts, fontsReady, hasImage);

  // 3. Text layout → produces text DesignData and image zone
  const textLayout = useMemo(() => {
    if (!fontsReady || texts.length === 0) {
      return {
        textData: null as DesignData | null,
        imageZone: { yMin: 0, yMax: effectiveSettings.height },
      };
    }
    return textToDesignData(
      texts, getFontCache(),
      effectiveSettings.width, effectiveSettings.height,
      hasImage,
    );
  }, [texts, fontsReady, effectiveSettings.width, effectiveSettings.height, hasImage]);

  // 4. Image → DesignData (rendered within computed image zone)
  const imageData = useMemo<DesignData | null>(() => {
    if (trace.rawShapes && trace.rawImageDims) {
      const hasText = textLayout.textData !== null;
      return rasterToDesignData(
        trace.rawShapes, trace.rawImageDims,
        effectiveSettings.width, effectiveSettings.height,
        hasText ? textLayout.imageZone : undefined,
      );
    }
    return null;
  }, [trace.rawShapes, trace.rawImageDims, effectiveSettings.width, effectiveSettings.height, textLayout.imageZone, textLayout.textData]);

  // 5. Smooth image data (before merge — smoothing should not apply to text)
  const stepFlags: StepFlags = { thickenEnabled, smoothEnabled, tracerAlgorithm, thickenAlgorithm };
  const afterSmooth = usePipelineStep(smoothStep, imageData, effectiveSettings, stepFlags);

  // 6. Merge sources (smoothed image + raw text)
  const merged = useMemo(
    () => mergeDesignData(afterSmooth.data, textLayout.textData),
    [afterSmooth.data, textLayout.textData],
  );

  // 7. Processing chain (post-merge) — thicken step resolved from registry
  const resolvedThickenStep = useMemo(() => getStepVariant("thicken", thickenAlgorithm), [thickenAlgorithm]);
  const afterThicken = usePipelineStep(resolvedThickenStep, merged, effectiveSettings, stepFlags);

  // 8. Output: DesignData → THREE.Shape[]
  const shapes = useMemo(
    () => afterThicken.data ? designDataToShapes(afterThicken.data) : [],
    [afterThicken.data],
  );

  const thinFeatureMap = afterThicken.data?.thinFeatureMap ?? null;

  const rawDesignShapes = useMemo(
    () => imageData ? designDataToShapes(imageData) : [],
    [imageData],
  );

  const isProcessing = trace.isTracing || afterThicken.isProcessing || afterSmooth.isProcessing;

  // Combined pipeline progress
  const { pipelineProgress, pipelineStage } = useMemo(() => {
    const steps: { active: boolean; progress: number; label: string }[] = [];
    if (trace.isTracing) steps.push({ active: true, progress: trace.traceProgress, label: trace.traceStage || "Tracing…" });
    if (afterThicken.isProcessing) steps.push({ active: true, progress: afterThicken.progress, label: thickenEnabled ? "Thickening…" : "Checking features…" });
    if (smoothEnabled && merged) steps.push({ active: afterSmooth.isProcessing, progress: afterSmooth.isProcessing ? afterSmooth.progress : 1, label: "Smoothing…" });
    if (steps.length === 0) return { pipelineProgress: 0, pipelineStage: "" };
    const total = steps.reduce((sum, s) => sum + s.progress, 0) / steps.length;
    const current = steps.find((s) => s.active);
    return { pipelineProgress: total, pipelineStage: current?.label ?? "" };
  }, [trace.isTracing, trace.traceProgress, trace.traceStage, thickenEnabled, smoothEnabled, merged, afterThicken.isProcessing, afterThicken.progress, afterSmooth.isProcessing, afterSmooth.progress]);

  return {
    shapes,
    effectiveSettings,
    rawDesignShapes,
    thinFeatureMap,
    isTracing: trace.isTracing,
    traceProgress: trace.traceProgress,
    traceStage: trace.traceStage,
    isThickening: afterThicken.isProcessing,
    isSmoothing: afterSmooth.isProcessing,
    isProcessing,
    pipelineProgress,
    pipelineStage,
    hasDesign: rawDesignShapes.length > 0,
    sourceAspectRatio: trace.sourceAspectRatio,
  };
}
