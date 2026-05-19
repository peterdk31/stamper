"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import dynamic from "next/dynamic";
import * as THREE from "three";
import { DEFAULT_STAMP_SETTINGS, type StampSettings, type StampText } from "@/types/stamp";
import { contoursToShapes } from "@/lib/image-trace";
import type { TraceMessage } from "@/lib/image-trace.worker";
import { parseRawSvg, scaleRawSvgToStamp, getSvgAspectRatio, type RawSvgData } from "@/lib/svg-parse";
import { loadAllBundledFonts, getFontCache, type FontEntry } from "@/lib/font-manager";
import { textEntriesToShapes, computeTextBounds } from "@/lib/text-to-shapes";
import type { AutoFitResult } from "@/lib/auto-fit.worker";
import StampSettingsPanel from "@/components/StampSettingsPanel";
import ImageUpload from "@/components/ImageUpload";
import TextEditor from "@/components/TextEditor";

const StampPreview = dynamic(() => import("@/components/StampPreview"), { ssr: false });

export default function Home() {
  const [settings, setSettings] = useState<StampSettings>(DEFAULT_STAMP_SETTINGS);
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [imageName, setImageName] = useState<string | null>(null);
  const [svgText, setSvgText] = useState<string | null>(null);
  const [texts, setTexts] = useState<StampText[]>([]);
  const [rawContours, setRawContours] = useState<{ x: number; y: number }[][] | null>(null);
  const [rawImageDims, setRawImageDims] = useState<{ w: number; h: number } | null>(null);
  const [availableFonts, setAvailableFonts] = useState<string[]>([]);
  const [fontsReady, setFontsReady] = useState(false);
  const [imageAspectRatio, setImageAspectRatio] = useState<number | null>(null);

  useEffect(() => {
    loadAllBundledFonts().then((entries) => {
      setAvailableFonts(entries.map((e) => e.name));
      setFontsReady(true);
    });
  }, []);

  const handleFontLoaded = useCallback((entry: FontEntry) => {
    setAvailableFonts((prev) =>
      prev.includes(entry.name) ? prev : [...prev, entry.name],
    );
  }, []);

  // Derive stamp height from content when auto-size is on
  const effectiveHeight = useMemo(() => {
    if (!settings.autoSize) return settings.height;

    let newHeight: number | null = null;

    const aspectRatio = svgText ? getSvgAspectRatio(svgText) : imageAspectRatio;
    if (aspectRatio && aspectRatio > 0) {
      newHeight = settings.width / aspectRatio;
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
    const minHeight = settings.threadEnabled ? Math.max(10, settings.threadConfig.majorDiameter + 4) : 10;
    return Math.round(Math.max(minHeight, newHeight) * 10) / 10;
  }, [settings.autoSize, settings.height, settings.width, settings.padding, settings.threadEnabled, settings.threadConfig.majorDiameter, svgText, imageAspectRatio, texts, fontsReady]);

  const effectiveSettings = useMemo(() =>
    effectiveHeight !== settings.height ? { ...settings, height: effectiveHeight } : settings,
    [settings, effectiveHeight],
  );

  const [isAutoFitting, setIsAutoFitting] = useState(false);
  const autoFitWorkerRef = useRef<Worker | null>(null);

  const [isTracing, setIsTracing] = useState(false);
  const [traceProgress, setTraceProgress] = useState(0);
  const [traceStage, setTraceStage] = useState("");
  const [loadedPixels, setLoadedPixels] = useState<ImageData | null>(null);
  const workerRef = useRef<Worker | null>(null);

  const terminateWorker = useCallback(() => {
    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return terminateWorker;
  }, [terminateWorker]);

  // Phase 1: Load and decode raster image (sets aspect ratio + pixel data).
  // This is separated from tracing so setImageAspectRatio doesn't kill
  // the worker via an effectiveSettings → useEffect re-trigger loop.
  useEffect(() => {
    setLoadedPixels(null);

    if (!imageDataUrl) {
      setImageAspectRatio(null);
      return;
    }

    setIsTracing(true);
    setTraceProgress(0);
    setTraceStage("Loading image…");

    const img = new window.Image();
    img.onerror = () => setIsTracing(false);
    img.onload = () => {
      setImageAspectRatio(img.width / img.height);

      const MAX_TRACE_DIM = 800;
      const scale = Math.min(1, MAX_TRACE_DIM / Math.max(img.width, img.height));
      const tw = Math.round(img.width * scale);
      const th = Math.round(img.height * scale);

      const canvas = document.createElement("canvas");
      canvas.width = tw;
      canvas.height = th;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, tw, th);
      setLoadedPixels(ctx.getImageData(0, 0, tw, th));
    };
    img.src = imageDataUrl;
  }, [imageDataUrl]);

  // Phase 2: Trace contours in pixel space (no dependency on stamp dimensions).
  useEffect(() => {
    if (svgText || !loadedPixels) {
      terminateWorker();
      if (!imageDataUrl && !svgText) {
        setIsTracing(false);
        setRawContours(null);
        setRawImageDims(null);
      }
      return;
    }

    terminateWorker();
    setIsTracing(true);
    setTraceProgress(0);
    setTraceStage("Starting…");

    const worker = new Worker(
      new URL("../lib/image-trace.worker.ts", import.meta.url),
    );
    workerRef.current = worker;

    worker.onmessage = (e: MessageEvent<TraceMessage>) => {
      const msg = e.data;
      if (msg.type === "progress") {
        setTraceProgress(msg.progress);
        setTraceStage(msg.stage);
      } else if (msg.type === "result") {
        setRawContours(msg.contours);
        setRawImageDims({ w: msg.imageWidth, h: msg.imageHeight });
        setIsTracing(false);
        terminateWorker();
      }
    };

    worker.onerror = () => {
      setIsTracing(false);
      terminateWorker();
    };

    worker.postMessage({
      width: loadedPixels.width,
      height: loadedPixels.height,
      data: loadedPixels.data,
      threshold: 128,
    });
  }, [svgText, loadedPixels, imageDataUrl, terminateWorker]);

  // SVG: parse once, scale is handled in the useMemo below.
  const rawSvgData = useMemo<RawSvgData | null>(() => {
    if (!svgText) return null;
    return parseRawSvg(svgText);
  }, [svgText]);

  // Scale raw design data to current stamp dimensions (instant, no re-trace).
  const designShapes = useMemo(() => {
    if (rawSvgData) {
      return scaleRawSvgToStamp(rawSvgData, effectiveSettings.width, effectiveSettings.height);
    }
    if (rawContours && rawImageDims) {
      const scale = Math.min(
        effectiveSettings.width / rawImageDims.w,
        effectiveSettings.height / rawImageDims.h,
      );
      const offsetX = (effectiveSettings.width - rawImageDims.w * scale) / 2;
      const offsetY = (effectiveSettings.height - rawImageDims.h * scale) / 2;
      const scaled = rawContours.map((c) =>
        c.map((p) => ({ x: p.x * scale + offsetX, y: p.y * scale + offsetY })),
      );
      return contoursToShapes(scaled);
    }
    return [];
  }, [rawSvgData, rawContours, rawImageDims, effectiveSettings.width, effectiveSettings.height]);

  const textShapes = useMemo(() => {
    if (!fontsReady) return [];
    return textEntriesToShapes(texts, getFontCache(), effectiveSettings.width, effectiveSettings.height, 0, effectiveSettings.padding);
  }, [texts, fontsReady, effectiveSettings.width, effectiveSettings.height, effectiveSettings.padding]);

  const handleImageChange = useCallback((dataUrl: string | null, fileName?: string) => {
    setImageDataUrl(dataUrl);
    setImageName(dataUrl ? (fileName ?? null) : null);
  }, []);

  const exportName = useMemo(() => {
    const parts: string[] = [];
    if (imageName) parts.push(imageName);
    const textContent = texts.map((t) => t.content.trim()).filter(Boolean).join("-");
    if (textContent) parts.push(textContent);
    if (parts.length === 0) return "stamp";
    return parts.join("-").replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase();
  }, [imageName, texts]);

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="bg-amber-800 text-white px-6 py-4">
        <h1 className="text-xl font-bold">Ceramic Stamps</h1>
        <p className="text-amber-200 text-sm">Design and export 3D-printable ceramic stamps</p>
      </header>

      <div className="max-w-7xl mx-auto p-6 grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6">
        <aside className="space-y-4">
          <ImageUpload
            imageDataUrl={imageDataUrl}
            svgText={svgText}
            onImageChange={handleImageChange}
            onSvgChange={setSvgText}
            isProcessing={isTracing}
            progress={traceProgress}
            progressStage={traceStage}
          />
          <TextEditor
            texts={texts}
            availableFonts={availableFonts}
            stampWidth={effectiveSettings.width}
            stampHeight={effectiveSettings.height}
            onChange={setTexts}
            onFontLoaded={handleFontLoaded}
          />
          <StampSettingsPanel settings={effectiveSettings} onChange={setSettings}
            isAutoFitting={isAutoFitting}
            onFindMinWidth={designShapes.length > 0 || textShapes.length > 0 ? () => {
              if (isAutoFitting) return;
              setIsAutoFitting(true);

              const allShapes = [...designShapes, ...textShapes];
              const box = new THREE.Box2();
              for (const s of allShapes) {
                for (const p of s.getPoints()) box.expandByPoint(p);
                for (const h of s.holes) for (const p of h.getPoints()) box.expandByPoint(p);
              }
              const contentW = box.max.x - box.min.x;
              const contentH = box.max.y - box.min.y;
              if (contentW <= 0 || contentH <= 0) { setIsAutoFitting(false); return; }

              const serialized = allShapes.map((s) => ({
                points: s.getPoints().map((p) => ({ x: p.x - box.min.x, y: p.y - box.min.y })),
                holes: s.holes.map((h) => h.getPoints().map((p) => ({ x: p.x - box.min.x, y: p.y - box.min.y }))),
              }));

              if (autoFitWorkerRef.current) autoFitWorkerRef.current.terminate();
              const worker = new Worker(new URL("../lib/auto-fit.worker.ts", import.meta.url));
              autoFitWorkerRef.current = worker;

              worker.onmessage = (e: MessageEvent<AutoFitResult>) => {
                if (e.data.type === "result") {
                  const minSize = effectiveSettings.threadEnabled ? Math.max(10, effectiveSettings.threadConfig.majorDiameter + 4) : 10;
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
            } : undefined}
          />
        </aside>

        <section>
          <StampPreview settings={effectiveSettings} designShapes={designShapes} textShapes={textShapes} exportName={exportName} />
        </section>
      </div>
    </main>
  );
}
