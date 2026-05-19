"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import dynamic from "next/dynamic";
import * as THREE from "three";
import { DEFAULT_STAMP_SETTINGS, type StampSettings, type StampText } from "@/types/stamp";
import { contoursToShapes } from "@/lib/image-trace";
import type { TraceRequest, TraceMessage } from "@/lib/image-trace.worker";
import { parseSvgToShapes, getSvgAspectRatio } from "@/lib/svg-parse";
import { loadAllBundledFonts, getFontCache, type FontEntry } from "@/lib/font-manager";
import { textEntriesToShapes, computeTextBounds } from "@/lib/text-to-shapes";
import StampSettingsPanel from "@/components/StampSettingsPanel";
import ImageUpload from "@/components/ImageUpload";
import TextEditor from "@/components/TextEditor";

const StampPreview = dynamic(() => import("@/components/StampPreview"), { ssr: false });

export default function Home() {
  const [settings, setSettings] = useState<StampSettings>(DEFAULT_STAMP_SETTINGS);
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [svgText, setSvgText] = useState<string | null>(null);
  const [texts, setTexts] = useState<StampText[]>([]);
  const [designShapes, setDesignShapes] = useState<THREE.Shape[]>([]);
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
    return Math.round(Math.max(10, newHeight) * 10) / 10;
  }, [settings.autoSize, settings.height, settings.width, settings.padding, svgText, imageAspectRatio, texts, fontsReady]);

  const effectiveSettings = useMemo(() =>
    effectiveHeight !== settings.height ? { ...settings, height: effectiveHeight } : settings,
    [settings, effectiveHeight],
  );

  const [isTracing, setIsTracing] = useState(false);
  const [traceProgress, setTraceProgress] = useState(0);
  const [traceStage, setTraceStage] = useState("");
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

  const processRasterImage = useCallback(
    (dataUrl: string) => {
      const img = new window.Image();
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
        const imageData = ctx.getImageData(0, 0, tw, th);

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
            setDesignShapes(contoursToShapes(msg.contours));
            setIsTracing(false);
            terminateWorker();
          }
        };

        worker.onerror = () => {
          setIsTracing(false);
          terminateWorker();
        };

        const req: TraceRequest = {
          width: imageData.width,
          height: imageData.height,
          data: imageData.data,
          targetWidth: effectiveSettings.width,
          targetHeight: effectiveSettings.height,
          simplification: effectiveSettings.simplification,
          threshold: 128,
        };
        worker.postMessage(req);
      };
      img.src = dataUrl;
    },
    [effectiveSettings.width, effectiveSettings.height, effectiveSettings.simplification, terminateWorker],
  );

  useEffect(() => {
    if (svgText) {
      terminateWorker();
      setIsTracing(false);
      const shapes = parseSvgToShapes(svgText, effectiveSettings.width, effectiveSettings.height);
      setDesignShapes(shapes);
    } else if (imageDataUrl) {
      processRasterImage(imageDataUrl);
    } else {
      terminateWorker();
      setIsTracing(false);
      setDesignShapes([]);
      setImageAspectRatio(null);
    }
  }, [svgText, imageDataUrl, effectiveSettings.width, effectiveSettings.height, effectiveSettings.simplification, processRasterImage, terminateWorker]);

  const textShapes = useMemo(() => {
    if (!fontsReady) return [];
    return textEntriesToShapes(texts, getFontCache(), effectiveSettings.width, effectiveSettings.height, 0, effectiveSettings.padding);
  }, [texts, fontsReady, effectiveSettings.width, effectiveSettings.height, effectiveSettings.padding]);

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
            simplification={effectiveSettings.simplification}
            onImageChange={setImageDataUrl}
            onSvgChange={setSvgText}
            onSimplificationChange={(v) => setSettings((s) => ({ ...s, simplification: v }))}
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
          <StampSettingsPanel settings={effectiveSettings} onChange={setSettings} />
        </aside>

        <section>
          <StampPreview settings={effectiveSettings} designShapes={designShapes} textShapes={textShapes} />
        </section>
      </div>
    </main>
  );
}
