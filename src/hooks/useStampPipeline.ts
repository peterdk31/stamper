"use client";

import { useState, useEffect, useMemo, useRef, useReducer } from "react";
import * as THREE from "three";
import type { StampSettings, StampText, DesignData, ThinFeatureMap } from "@/types/stamp";
import type { StampShapeData } from "@/types/stamp";
import type { TraceMessage } from "@/lib/image-trace.worker";
import type { AutoFitResult } from "@/lib/auto-fit.worker";
import { rasterToDesignData, designDataToShapes } from "@/lib/design-data";
import { getFontCache } from "@/lib/font-manager";
import { computeRequiredHeight } from "@/lib/text-to-shapes";
import { textToDesignData } from "@/lib/pipeline/text";
import { mergeDesignData } from "@/lib/pipeline/merge";
import { thickenStep } from "@/lib/pipeline/thicken";
import { smoothStep } from "@/lib/pipeline/smooth";
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
  isAutoFitting: boolean;
  isProcessing: boolean;
  pipelineProgress: number;
  pipelineStage: string;
  hasDesign: boolean;

  onFindMinWidth: (() => void) | undefined;
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
  imageDataUrl: string | null,
  svgText: string | null,
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

      createImageBitmap(img, { resizeWidth: tw, resizeHeight: th }).then((bitmap) => {
        if (cancelled) { bitmap.close(); return; }

        if (workerRef.current) {
          workerRef.current.terminate();
        }

        dispatch({ type: "loading", stage: "Starting…" });

        const worker = new Worker(
          new URL("../lib/image-trace.worker.ts", import.meta.url),
        );
        workerRef.current = worker;

        worker.onmessage = (e: MessageEvent<TraceMessage>) => {
          if (cancelled || workerRef.current !== worker) return;
          const msg = e.data;
          if (msg.type === "progress") {
            dispatch({ type: "progress", progress: msg.progress, stage: msg.stage });
          } else if (msg.type === "result") {
            dispatch({ type: "result", shapes: msg.shapes, imageWidth: msg.imageWidth, imageHeight: msg.imageHeight });
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

        worker.postMessage({ bitmap, threshold: 128 }, [bitmap]);
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
  }, [imageDataUrl, svgText]);

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
  const effectiveHeight = useMemo(() => {
    if (!settings.autoSize) return settings.height;

    const hasTexts = texts.length > 0 && fontsReady;

    if (!hasTexts && !sourceAspectRatio) return settings.height;

    const required = hasTexts
      ? computeRequiredHeight(texts, getFontCache(), settings.width, settings.padding, hasImage, sourceAspectRatio)
      : null;

    if (required !== null) {
      const minHeight = settings.threadEnabled
        ? Math.max(10, settings.threadConfig.majorDiameter + 4)
        : 10;
      return Math.round(Math.max(minHeight, required) * 10) / 10;
    }

    if (sourceAspectRatio && sourceAspectRatio > 0) {
      const h = settings.width / sourceAspectRatio;
      const minHeight = settings.threadEnabled
        ? Math.max(10, settings.threadConfig.majorDiameter + 4)
        : 10;
      return Math.round(Math.max(minHeight, h) * 10) / 10;
    }

    return settings.height;
  }, [
    settings.autoSize, settings.height, settings.width, settings.padding,
    settings.threadEnabled, settings.threadConfig.majorDiameter,
    sourceAspectRatio, texts, fontsReady, hasImage,
  ]);

  return useMemo(
    () => effectiveHeight !== settings.height ? { ...settings, height: effectiveHeight } : settings,
    [settings, effectiveHeight],
  );
}

// ---------------------------------------------------------------------------
// Auto-fit width (on-demand worker, not a pipeline step)
// ---------------------------------------------------------------------------

function useAutoFit(
  rawDesignShapes: THREE.Shape[],
  effectiveSettings: StampSettings,
  setSettings: React.Dispatch<React.SetStateAction<StampSettings>>,
) {
  const [isAutoFitting, setIsAutoFitting] = useState(false);
  const workerRef = useRef<Worker | null>(null);

  const onFindMinWidth = rawDesignShapes.length > 0 ? () => {
    if (isAutoFitting) return;
    setIsAutoFitting(true);

    const box = new THREE.Box2();
    for (const s of rawDesignShapes) {
      for (const p of s.getPoints()) box.expandByPoint(p);
      for (const h of s.holes) for (const p of h.getPoints()) box.expandByPoint(p);
    }
    const contentW = box.max.x - box.min.x;
    const contentH = box.max.y - box.min.y;
    if (contentW <= 0 || contentH <= 0) { setIsAutoFitting(false); return; }

    const serialized = rawDesignShapes.map((s) => ({
      outer: s.getPoints(48).map((p) => ({ x: p.x - box.min.x, y: p.y - box.min.y })),
      holes: s.holes.map((h) => h.getPoints(48).map((p) => ({ x: p.x - box.min.x, y: p.y - box.min.y }))),
    }));

    if (workerRef.current) workerRef.current.terminate();
    const worker = new Worker(new URL("../lib/auto-fit.worker.ts", import.meta.url));
    workerRef.current = worker;

    worker.onmessage = (e: MessageEvent<AutoFitResult>) => {
      if (e.data.type === "result") {
        const minSize = effectiveSettings.threadEnabled
          ? Math.max(10, effectiveSettings.threadConfig.majorDiameter + 4)
          : 10;
        setSettings((s) => ({ ...s, width: Math.max(minSize, e.data.width) }));
      }
      setIsAutoFitting(false);
      worker.terminate();
      workerRef.current = null;
    };
    worker.onerror = () => {
      setIsAutoFitting(false);
      worker.terminate();
      workerRef.current = null;
    };

    worker.postMessage({
      shapes: serialized,
      contentW,
      contentH,
      nozzleDiameter: effectiveSettings.nozzleDiameter,
    });
  } : undefined;

  return { isAutoFitting, onFindMinWidth };
}

// ---------------------------------------------------------------------------
// Full pipeline composition
// ---------------------------------------------------------------------------

export function useStampPipeline(inputs: PipelineInputs): PipelineOutputs {
  const { settings, setSettings, imageDataUrl, svgText, texts, fontsReady, thickenEnabled, smoothEnabled } = inputs;

  // 1. Trace image (produces raw contours, independent of stamp dimensions)
  const trace = useImageTrace(imageDataUrl, svgText);

  const hasImage = !!(trace.rawShapes && trace.rawImageDims);

  // 2. Effective settings (auto-size based on stacked layout)
  const effectiveSettings = useEffectiveSettings(settings, trace.sourceAspectRatio, texts, fontsReady, hasImage);

  // 3. Text layout → produces text DesignData and image zone
  const textLayout = useMemo(() => {
    if (!fontsReady || texts.length === 0) {
      return {
        textData: null as DesignData | null,
        imageZone: { yMin: effectiveSettings.padding, yMax: effectiveSettings.height - effectiveSettings.padding },
      };
    }
    return textToDesignData(
      texts, getFontCache(),
      effectiveSettings.width, effectiveSettings.height, effectiveSettings.padding,
      hasImage,
    );
  }, [texts, fontsReady, effectiveSettings.width, effectiveSettings.height, effectiveSettings.padding, hasImage]);

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
  const stepFlags: StepFlags = { thickenEnabled, smoothEnabled };
  const afterSmooth = usePipelineStep(smoothStep, imageData, effectiveSettings, stepFlags);

  // 6. Merge sources (smoothed image + raw text)
  const merged = useMemo(
    () => mergeDesignData(afterSmooth.data, textLayout.textData),
    [afterSmooth.data, textLayout.textData],
  );

  // 7. Processing chain (post-merge)
  const afterThicken = usePipelineStep(thickenStep, merged, effectiveSettings, stepFlags);

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

  // Auto-fit (on-demand, uses pre-pipeline shapes for idempotency)
  const { isAutoFitting, onFindMinWidth } = useAutoFit(rawDesignShapes, effectiveSettings, setSettings);

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
    isAutoFitting,
    isProcessing,
    pipelineProgress,
    pipelineStage,
    hasDesign: rawDesignShapes.length > 0,
    onFindMinWidth,
  };
}
