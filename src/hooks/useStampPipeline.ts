"use client";

import { useState, useEffect, useMemo, useRef, useReducer } from "react";
import * as THREE from "three";
import type { StampSettings, StampText, DesignData } from "@/types/stamp";
import type { TraceMessage } from "@/lib/image-trace.worker";
import type { AutoFitResult } from "@/lib/auto-fit.worker";
import { rasterToDesignData, designDataToShapes } from "@/lib/design-data";
import { getFontCache } from "@/lib/font-manager";
import { computeTextBounds } from "@/lib/text-to-shapes";
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

  isTracing: boolean;
  traceProgress: number;
  traceStage: string;
  isThickening: boolean;
  isSmoothing: boolean;
  smoothProgress: number;
  isAutoFitting: boolean;
  hasDesign: boolean;

  onFindMinWidth: (() => void) | undefined;
}

// ---------------------------------------------------------------------------
// Source: image/SVG → raw contours (independent of stamp dimensions)
// ---------------------------------------------------------------------------

interface TraceState {
  rawContours: { x: number; y: number }[][] | null;
  rawImageDims: { w: number; h: number } | null;
  isTracing: boolean;
  traceProgress: number;
  traceStage: string;
}

type TraceAction =
  | { type: "loading"; stage: string }
  | { type: "progress"; progress: number; stage: string }
  | { type: "result"; contours: { x: number; y: number }[][]; imageWidth: number; imageHeight: number }
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
        rawContours: action.contours,
        rawImageDims: { w: action.imageWidth, h: action.imageHeight },
        isTracing: false, traceProgress: 1, traceStage: "",
      };
    case "error":
      return { ...state, isTracing: false };
    case "clear":
      return { rawContours: null, rawImageDims: null, isTracing: false, traceProgress: 0, traceStage: "" };
  }
}

const INITIAL_TRACE_STATE: TraceState = {
  rawContours: null, rawImageDims: null, isTracing: false, traceProgress: 0, traceStage: "",
};

interface TraceOutput {
  rawContours: { x: number; y: number }[][] | null;
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

      const canvas = document.createElement("canvas");
      canvas.width = tw;
      canvas.height = th;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, tw, th);
      const pixels = ctx.getImageData(0, 0, tw, th);

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
          dispatch({ type: "result", contours: msg.contours, imageWidth: msg.imageWidth, imageHeight: msg.imageHeight });
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

      worker.postMessage({
        width: pixels.width,
        height: pixels.height,
        data: pixels.data,
        threshold: 128,
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
    rawContours: state.rawContours,
    rawImageDims: state.rawImageDims,
    sourceAspectRatio,
    isTracing: state.isTracing,
    traceProgress: state.traceProgress,
    traceStage: state.traceStage,
  };
}

// ---------------------------------------------------------------------------
// Source: text → DesignData
// ---------------------------------------------------------------------------

function useTextSource(
  texts: StampText[],
  fontsReady: boolean,
  stampWidth: number,
  stampHeight: number,
  padding: number,
): DesignData | null {
  return useMemo(() => {
    if (!fontsReady || texts.length === 0) return null;
    return textToDesignData(texts, getFontCache(), stampWidth, stampHeight, padding);
  }, [texts, fontsReady, stampWidth, stampHeight, padding]);
}

// ---------------------------------------------------------------------------
// Effective settings (auto-size from content dimensions)
// ---------------------------------------------------------------------------

function useEffectiveSettings(
  settings: StampSettings,
  sourceAspectRatio: number | null,
  texts: StampText[],
  fontsReady: boolean,
): StampSettings {
  const effectiveHeight = useMemo(() => {
    if (!settings.autoSize) return settings.height;

    let newHeight: number | null = null;

    if (sourceAspectRatio && sourceAspectRatio > 0) {
      newHeight = settings.width / sourceAspectRatio;
    }

    if (texts.length > 0 && fontsReady) {
      const bounds = computeTextBounds(texts, getFontCache());
      if (bounds && bounds.width > 0) {
        const availWidth = settings.width - settings.padding * 2;
        const scale = availWidth / bounds.width;
        const textHeight = bounds.height * scale + settings.padding * 2;
        newHeight = newHeight ? Math.max(newHeight, textHeight) : textHeight;
      }
    }

    if (newHeight === null) return settings.height;
    const minHeight = settings.threadEnabled
      ? Math.max(10, settings.threadConfig.majorDiameter + 4)
      : 10;
    return Math.round(Math.max(minHeight, newHeight) * 10) / 10;
  }, [
    settings.autoSize, settings.height, settings.width, settings.padding,
    settings.threadEnabled, settings.threadConfig.majorDiameter,
    sourceAspectRatio, texts, fontsReady,
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
  shapes: THREE.Shape[],
  effectiveSettings: StampSettings,
  setSettings: React.Dispatch<React.SetStateAction<StampSettings>>,
) {
  const [isAutoFitting, setIsAutoFitting] = useState(false);
  const autoFitWorkerRef = useRef<Worker | null>(null);

  const onFindMinWidth = shapes.length > 0 ? () => {
    if (isAutoFitting) return;
    setIsAutoFitting(true);

    const box = new THREE.Box2();
    for (const s of shapes) {
      for (const p of s.getPoints()) box.expandByPoint(p);
      for (const h of s.holes) for (const p of h.getPoints()) box.expandByPoint(p);
    }
    const contentW = box.max.x - box.min.x;
    const contentH = box.max.y - box.min.y;
    if (contentW <= 0 || contentH <= 0) { setIsAutoFitting(false); return; }

    const serialized = shapes.map((s) => ({
      outer: s.getPoints(48).map((p) => ({ x: p.x - box.min.x, y: p.y - box.min.y })),
      holes: s.holes.map((h) => h.getPoints(48).map((p) => ({ x: p.x - box.min.x, y: p.y - box.min.y }))),
    }));

    if (autoFitWorkerRef.current) autoFitWorkerRef.current.terminate();
    const worker = new Worker(new URL("../lib/auto-fit.worker.ts", import.meta.url));
    autoFitWorkerRef.current = worker;

    worker.onmessage = (e: MessageEvent<AutoFitResult>) => {
      if (e.data.type === "result") {
        const minSize = effectiveSettings.threadEnabled
          ? Math.max(10, effectiveSettings.threadConfig.majorDiameter + 4)
          : 10;
        setSettings((s) => ({ ...s, width: Math.max(minSize, e.data.width) }));
      }
      setIsAutoFitting(false);
      worker.terminate();
      autoFitWorkerRef.current = null;
    };
    worker.onerror = () => {
      setIsAutoFitting(false);
      worker.terminate();
      autoFitWorkerRef.current = null;
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

  // 2. Effective settings (auto-size based on source aspect ratio + text bounds)
  const effectiveSettings = useEffectiveSettings(settings, trace.sourceAspectRatio, texts, fontsReady);

  // 3. Sources → DesignData (scaled to effective stamp dimensions)
  const imageData = useMemo<DesignData | null>(() => {
    if (trace.rawContours && trace.rawImageDims) {
      return rasterToDesignData(trace.rawContours, trace.rawImageDims, effectiveSettings.width, effectiveSettings.height);
    }
    return null;
  }, [trace.rawContours, trace.rawImageDims, effectiveSettings.width, effectiveSettings.height]);

  const textData = useTextSource(texts, fontsReady, effectiveSettings.width, effectiveSettings.height, effectiveSettings.padding);

  const merged = useMemo(
    () => mergeDesignData(imageData, textData),
    [imageData, textData],
  );

  // 4. Processing chain — add new steps here
  const stepFlags: StepFlags = { thickenEnabled, smoothEnabled };
  const afterThicken = usePipelineStep(thickenStep, merged, effectiveSettings, stepFlags);
  const afterSmooth = usePipelineStep(smoothStep, afterThicken.data, effectiveSettings, stepFlags);

  // 5. Output: DesignData → THREE.Shape[]
  const shapes = useMemo(
    () => afterSmooth.data ? designDataToShapes(afterSmooth.data) : [],
    [afterSmooth.data],
  );

  const rawDesignShapes = useMemo(
    () => imageData ? designDataToShapes(imageData) : [],
    [imageData],
  );

  // Auto-fit (on-demand, not a pipeline step)
  const { isAutoFitting, onFindMinWidth } = useAutoFit(shapes, effectiveSettings, setSettings);

  return {
    shapes,
    effectiveSettings,
    rawDesignShapes,
    isTracing: trace.isTracing,
    traceProgress: trace.traceProgress,
    traceStage: trace.traceStage,
    isThickening: afterThicken.isProcessing,
    isSmoothing: afterSmooth.isProcessing,
    smoothProgress: afterSmooth.progress,
    isAutoFitting,
    hasDesign: rawDesignShapes.length > 0,
    onFindMinWidth,
  };
}
