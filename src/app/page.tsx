"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import dynamic from "next/dynamic";
import * as THREE from "three";
import { DEFAULT_STAMP_SETTINGS, type StampSettings, type StampText, type DesignData } from "@/types/stamp";
import type { TraceMessage } from "@/lib/image-trace.worker";
import { rasterToDesignData, designDataToShapes } from "@/lib/design-data";
import { loadAllBundledFonts, getFontCache, type FontEntry } from "@/lib/font-manager";
import { textEntriesToShapes, computeTextBounds } from "@/lib/text-to-shapes";
import type { AutoFitResult } from "@/lib/auto-fit.worker";
import type { ThickenMessage } from "@/lib/thicken.worker";
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

  const sourceAspectRatio = useMemo(() => {
    if (rawImageDims) return rawImageDims.w / rawImageDims.h;
    return null;
  }, [rawImageDims]);

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
    const minHeight = settings.threadEnabled ? Math.max(10, settings.threadConfig.majorDiameter + 4) : 10;
    return Math.round(Math.max(minHeight, newHeight) * 10) / 10;
  }, [settings.autoSize, settings.height, settings.width, settings.padding, settings.threadEnabled, settings.threadConfig.majorDiameter, sourceAspectRatio, texts, fontsReady]);

  const effectiveSettings = useMemo(() =>
    effectiveHeight !== settings.height ? { ...settings, height: effectiveHeight } : settings,
    [settings, effectiveHeight],
  );

  const [isAutoFitting, setIsAutoFitting] = useState(false);
  const autoFitWorkerRef = useRef<Worker | null>(null);

  const [thickenEnabled, setThickenEnabled] = useState(false);
  const [thickenedData, setThickenedData] = useState<DesignData | null>(null);
  const [isThickening, setIsThickening] = useState(false);

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

  useEffect(() => {
    setLoadedPixels(null);

    const src = imageDataUrl
      ?? (svgText ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText)}` : null);
    if (!src) return;

    setIsTracing(true);
    setTraceProgress(0);
    setTraceStage(svgText ? "Rendering SVG…" : "Loading image…");

    let cancelled = false;
    const img = new window.Image();
    img.onerror = () => { if (!cancelled) setIsTracing(false); };
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
      setLoadedPixels(ctx.getImageData(0, 0, tw, th));
    };
    img.src = src;

    return () => { cancelled = true; };
  }, [imageDataUrl, svgText]);

  useEffect(() => {
    if (!loadedPixels) {
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
      if (workerRef.current !== worker) return;
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
      if (workerRef.current !== worker) return;
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

  const designData = useMemo<DesignData | null>(() => {
    if (rawContours && rawImageDims) {
      return rasterToDesignData(rawContours, rawImageDims, effectiveSettings.width, effectiveSettings.height);
    }
    return null;
  }, [rawContours, rawImageDims, effectiveSettings.width, effectiveSettings.height]);

  const rawDesignShapes = useMemo(() => {
    if (!designData) return [];
    return designDataToShapes(designData);
  }, [designData]);

  useEffect(() => {
    if (!thickenEnabled || !designData || designData.shapes.length === 0) {
      setThickenedData(null);
      setIsThickening(false);
      return;
    }

    setIsThickening(true);
    setThickenedData(null);

    const worker = new Worker(new URL("../lib/thicken.worker.ts", import.meta.url));

    worker.onmessage = (e: MessageEvent<ThickenMessage>) => {
      if (e.data.type === "result") {
        setThickenedData({
          shapes: e.data.shapes,
          bounds: e.data.bounds,
          sourceAspectRatio: designData.sourceAspectRatio,
        });
        setIsThickening(false);
      }
    };

    worker.onerror = () => {
      setIsThickening(false);
    };

    worker.postMessage({
      shapes: designData.shapes,
      stampWidth: effectiveSettings.width,
      stampHeight: effectiveSettings.height,
      nozzleDiameter: effectiveSettings.nozzleDiameter,
    });

    return () => {
      worker.terminate();
    };
  }, [thickenEnabled, designData, effectiveSettings.nozzleDiameter, effectiveSettings.width, effectiveSettings.height]);

  const designShapes = useMemo(() =>
    thickenedData ? designDataToShapes(thickenedData) : rawDesignShapes,
    [thickenedData, rawDesignShapes],
  );

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
            thickenEnabled={thickenEnabled}
            isThickening={isThickening}
            hasDesign={rawDesignShapes.length > 0}
            onThickenToggle={() => setThickenEnabled((v) => !v)}
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
                outer: s.getPoints(48).map((p) => ({ x: p.x - box.min.x, y: p.y - box.min.y })),
                holes: s.holes.map((h) => h.getPoints(48).map((p) => ({ x: p.x - box.min.x, y: p.y - box.min.y }))),
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
